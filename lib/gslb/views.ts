/**
 * lib/gslb/views.ts
 *
 * PowerGSLB view helpers for the panel-owned views that back GSLB regions
 * (ADR-0024 §4). Pure protocol logic over `GslbClient` - no DB, RBAC or audit.
 *
 * Ownership: the panel only ever reads, writes or deletes views whose name
 * starts with `GSLB_OWNED_VIEW_PREFIX`. Hand-made views (including the seed
 * `Public` catch-all) are never touched.
 *
 * Constraints from PowerGSLB's schema that shape these helpers:
 *   - `views.view` AND `views.rule` are both UNIQUE, and a violation comes
 *     back only as a generic "internal error" - so `pushOwnedView` checks for a
 *     rule clash first and reports which view holds it.
 *   - `save-record` returns no id, so an insert is read back by name.
 *   - `records.view_id` is a FK without cascade; deleting a view still in use
 *     fails with the same generic error - so `deleteOwnedView` counts first.
 */

import "server-only";
import { z } from "zod";
import { canonicalRule } from "@/lib/validators/gslb-region-rules";
import { GSLB_OWNED_PREFIX } from "./model";
import type { GslbClient } from "./client";
import { GslbError } from "./errors";

export const GSLB_OWNED_VIEW_PREFIX = GSLB_OWNED_PREFIX;

export interface GslbView {
  recid: number;
  view: string;
  rule: string;
}

const viewRowSchema = z.looseObject({
  recid: z.number().int(),
  view: z.string(),
  rule: z.string(),
});

/** Remote view name for a region slug. */
export function ownedViewName(regionSlug: string): string {
  return `${GSLB_OWNED_VIEW_PREFIX}${regionSlug}`;
}

/** MySQL `_ci` collation: names collide case-insensitively in PowerGSLB. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function toViews(rows: readonly unknown[]): GslbView[] {
  return rows.map((row) => {
    const parsed = viewRowSchema.safeParse(row);
    if (!parsed.success) throw new GslbError("protocol", "views row has an unknown shape.");
    return { recid: parsed.data.recid, view: parsed.data.view, rule: parsed.data.rule };
  });
}

/**
 * Find a view by exact name.
 *
 * @throws {GslbError}
 */
export async function findViewByName(client: GslbClient, name: string): Promise<GslbView | null> {
  const page = await client.getRecords("views", {
    search: [{ field: "view", operator: "is", value: name }],
  });
  return toViews(page.records).find((v) => sameName(v.view, name)) ?? null;
}

/**
 * Every view the panel owns on this backend.
 *
 * @throws {GslbError}
 */
export async function listOwnedViews(client: GslbClient): Promise<GslbView[]> {
  const page = await client.getRecords("views", {
    search: [{ field: "view", operator: "begins", value: GSLB_OWNED_VIEW_PREFIX }],
  });
  return toViews(page.records).filter((v) =>
    v.view.toLowerCase().startsWith(GSLB_OWNED_VIEW_PREFIX),
  );
}

/**
 * How many GSLB records point at a view.
 *
 * @throws {GslbError}
 */
export async function countRecordsUsingView(client: GslbClient, name: string): Promise<number> {
  const page = await client.getRecords("records", {
    search: [{ field: "view", operator: "is", value: name }],
  });
  return page.records.filter(
    (row) => typeof row["view"] === "string" && sameName(row["view"], name),
  ).length;
}

/** A rule already held by a different view - PowerGSLB would refuse the write. */
export class GslbRuleConflictError extends Error {
  public readonly conflictingView: string;
  public constructor(conflictingView: string) {
    super(`PowerGSLB view "${conflictingView}" already has exactly this rule.`);
    this.name = "GslbRuleConflictError";
    this.conflictingView = conflictingView;
  }
}

/** The view is still referenced by GSLB records, so PowerGSLB would refuse the delete. */
export class GslbViewInUseError extends Error {
  public readonly recordCount: number;
  public constructor(recordCount: number) {
    super(`View is in use by ${recordCount} GSLB record${recordCount === 1 ? "" : "s"}.`);
    this.name = "GslbViewInUseError";
    this.recordCount = recordCount;
  }
}

/**
 * Create or overwrite an owned view so it carries `rule`. A no-op when the
 * remote rule already matches. Returns the stored row (read back, since
 * `save-record` returns no id).
 *
 * @throws {GslbRuleConflictError} when another view already holds the rule.
 * @throws {GslbError}
 */
export async function pushOwnedView(
  client: GslbClient,
  name: string,
  rule: string,
): Promise<GslbView> {
  if (!name.startsWith(GSLB_OWNED_VIEW_PREFIX)) {
    throw new Error(`pushOwnedView: refusing to write non-owned view "${name}"`);
  }
  const existing = await findViewByName(client, name);
  if (existing && canonicalRule(existing.rule) === canonicalRule(rule)) return existing;

  const clash = await client.getRecords("views", {
    search: [{ field: "rule", operator: "is", value: rule }],
  });
  const holder = toViews(clash.records).find(
    (v) => canonicalRule(v.rule) === canonicalRule(rule) && !sameName(v.view, name),
  );
  if (holder) throw new GslbRuleConflictError(holder.view);

  await client.saveRecord("views", existing?.recid ?? 0, { view: name, rule });
  const stored = await findViewByName(client, name);
  if (!stored) {
    throw new GslbError("protocol", `View "${name}" was saved but cannot be read back.`);
  }
  return stored;
}

/**
 * Delete an owned view. Returns `false` when it was already gone.
 *
 * @throws {GslbViewInUseError} when GSLB records still reference it.
 * @throws {GslbError}
 */
export async function deleteOwnedView(client: GslbClient, name: string): Promise<boolean> {
  if (!name.startsWith(GSLB_OWNED_VIEW_PREFIX)) {
    throw new Error(`deleteOwnedView: refusing to delete non-owned view "${name}"`);
  }
  const existing = await findViewByName(client, name);
  if (!existing) return false;
  const inUse = await countRecordsUsingView(client, existing.view);
  if (inUse > 0) throw new GslbViewInUseError(inUse);
  await client.deleteRecords("views", [existing.recid]);
  return true;
}

// =============================================================================
// Drift
// =============================================================================

export type RegionSyncStatus = "in-sync" | "missing" | "rule-differs";

export interface RegionDrift {
  regionId: string;
  status: RegionSyncStatus;
  /** The remote rule when it differs, for display. */
  remoteRule?: string;
}

/**
 * Compare DB regions (the source of truth) with the owned remote views.
 * Pure: the caller fetched both sides. Orphans are owned views with no region
 * row - left behind by a failed delete or a hand-made view using the prefix.
 */
export function computeRegionDrift(
  regions: ReadonlyArray<{ id: string; slug: string; rules: readonly string[] }>,
  ownedViews: readonly GslbView[],
): { regions: RegionDrift[]; orphans: GslbView[] } {
  const remaining = new Map(ownedViews.map((v) => [v.view.toLowerCase(), v]));
  const drift = regions.map((region): RegionDrift => {
    const key = ownedViewName(region.slug).toLowerCase();
    const remote = remaining.get(key);
    remaining.delete(key);
    if (!remote) return { regionId: region.id, status: "missing" };
    if (canonicalRule(remote.rule) !== canonicalRule(region.rules.join(" "))) {
      return { regionId: region.id, status: "rule-differs", remoteRule: remote.rule };
    }
    return { regionId: region.id, status: "in-sync" };
  });
  return { regions: drift, orphans: [...remaining.values()] };
}
