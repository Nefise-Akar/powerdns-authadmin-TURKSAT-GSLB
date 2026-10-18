/**
 * lib/gslb/region-sync.ts
 *
 * Write ordering between the app DB (source of truth for regions) and
 * PowerGSLB's views, ADR-0024 §4. The DB side is injected as callbacks so this
 * module stays a DB-free adapter and the ordering + rollback is unit-testable.
 *
 *   create: DB insert → remote push; a failed push deletes the DB row again.
 *           DB first so the (backend, slug) unique index rejects a duplicate
 *           before anything reaches PowerGSLB.
 *   update: remote push → DB update. If the DB write then fails, the remote is
 *           ahead; the drift check shows it and Resync rewrites it from the DB.
 *   delete: remote delete (refused while GSLB records use the view) → DB delete.
 *   resync: remote push from the stored row.
 *
 * The remote call never runs inside a DB transaction: the SQLite transaction
 * runner assumes callbacks only await DB work (lib/db/sqlite-transaction.ts).
 *
 * Every write for one backend is serialized through the per-key async mutex
 * from `lib/pdns/backend-lock.ts` (keyed `gslb:<backendId>`), because
 * PowerGSLB has no row versions and its unique-rule check is read-then-write
 * here. The lock is in-process: a multi-replica deployment needs a shared
 * (e.g. Redis) lock - tracked as a follow-up.
 */

import "server-only";
import { withBackendLock } from "@/lib/pdns/backend-lock";
import type { GslbClient } from "./client";
import { deleteOwnedView, ownedViewName, pushOwnedView, type GslbView } from "./views";

interface RegionLike {
  slug: string;
  rules: readonly string[];
}

/** Run `fn` holding the write lock for one GSLB backend. */
export function withGslbBackendLock<T>(backendId: string, fn: () => Promise<T>): Promise<T> {
  return withBackendLock(`gslb:${backendId}`, fn);
}

function ruleOf(region: RegionLike): string {
  return region.rules.join(" ");
}

/**
 * Insert locally, then push. On a failed push the local row is removed and the
 * push error re-thrown.
 */
export async function createRegionSynced<R extends RegionLike>(args: {
  backendId: string;
  client: GslbClient;
  insertLocal: () => Promise<R>;
  removeLocal: (row: R) => Promise<void>;
}): Promise<{ row: R; view: GslbView }> {
  return withGslbBackendLock(args.backendId, async () => {
    const row = await args.insertLocal();
    try {
      const view = await pushOwnedView(args.client, ownedViewName(row.slug), ruleOf(row));
      return { row, view };
    } catch (err) {
      await args.removeLocal(row);
      throw err;
    }
  });
}

/** Push the new rules first, then persist locally. */
export async function updateRegionSynced<R extends RegionLike>(args: {
  backendId: string;
  client: GslbClient;
  next: RegionLike;
  updateLocal: () => Promise<R>;
}): Promise<{ row: R; view: GslbView }> {
  return withGslbBackendLock(args.backendId, async () => {
    const view = await pushOwnedView(args.client, ownedViewName(args.next.slug), ruleOf(args.next));
    const row = await args.updateLocal();
    return { row, view };
  });
}

/**
 * Delete remotely first, then locally. Returns whether a remote view existed.
 *
 * @throws {GslbViewInUseError} when GSLB records still use the view - nothing
 *   is deleted on either side.
 */
export async function deleteRegionSynced(args: {
  backendId: string;
  client: GslbClient;
  region: RegionLike;
  deleteLocal: () => Promise<void>;
}): Promise<{ remoteDeleted: boolean }> {
  return withGslbBackendLock(args.backendId, async () => {
    const remoteDeleted = await deleteOwnedView(args.client, ownedViewName(args.region.slug));
    await args.deleteLocal();
    return { remoteDeleted };
  });
}

/** Rewrite the remote view from the stored region. */
export async function resyncRegion(args: {
  backendId: string;
  client: GslbClient;
  region: RegionLike;
}): Promise<GslbView> {
  return withGslbBackendLock(args.backendId, () =>
    pushOwnedView(args.client, ownedViewName(args.region.slug), ruleOf(args.region)),
  );
}
