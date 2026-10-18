/**
 * app/(app)/zones/_lib/gslb-health.ts
 *
 * Per-zone GSLB health for the amalgamated zones list (ADR-0024 §8): how many
 * GSLB records the zone has, how many have a member down, and how many
 * servers are down.
 *
 * Cost control: one PowerGSLB `status` read per backend, in parallel, with a
 * short timeout, cached in-process for `STATUS_TTL_MS` (failures too, so a
 * dead backend isn't retried on every page view). Concurrent renders share
 * one in-flight read. A failure only marks that backend's zones "status
 * unavailable" - the list itself never waits longer than the timeout.
 */

import "server-only";
import { listAllGslbBackends } from "@/lib/db/repositories/gslb-backends";
import { listAllGslbZonesWithRecords } from "@/lib/db/repositories/gslb-records";
import { horizonKey, type HorizonScope } from "@/lib/db/repositories/zone-horizons";
import type { GslbBackend } from "@/lib/db/schema";
import { GslbError } from "@/lib/gslb/errors";
import { readAllStatus, type MemberState } from "@/lib/gslb/objects";
import { recordTarget, zoneGslbHealth, type ZoneGslbHealth } from "@/lib/gslb/record-plan";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import { logger } from "@/lib/logger";

const STATUS_TTL_MS = 20_000;
const STATUS_TIMEOUT_MS = 3_000;

export type { ZoneGslbHealth };

interface CacheEntry {
  at: number;
  /** Stamp of the backend row it was read with; an edit invalidates it. */
  stamp: number;
  result: Promise<Map<string, MemberState> | null>;
}

declare global {
  var __gslbStatusCache: Map<string, CacheEntry> | undefined;
}

const cache = (globalThis.__gslbStatusCache ??= new Map<string, CacheEntry>());

function backendStatus(backend: GslbBackend): Promise<Map<string, MemberState> | null> {
  const now = Date.now();
  const stamp = backend.updatedAt.getTime();
  const hit = cache.get(backend.id);
  if (hit?.stamp === stamp && now - hit.at < STATUS_TTL_MS) return hit.result;

  const result = readAllStatus(
    getGslbClientForRow(backend, { timeoutMs: STATUS_TIMEOUT_MS }),
  ).catch((err: unknown) => {
    if (!(err instanceof GslbError)) throw err;
    logger.warn({ gslbBackend: backend.slug, kind: err.kind }, "gslb.zones-list.status.failed");
    return null;
  });
  cache.set(backend.id, { at: now, stamp, result });
  return result;
}

/**
 * Health per zone keyed by `horizonKey(scope, zoneName)`, or `null` when no
 * GSLB backend is enabled (the column is then not shown at all).
 */
export async function loadZoneGslbHealthIndex(): Promise<Map<string, ZoneGslbHealth> | null> {
  const backends = await listAllGslbBackends();
  if (!backends.some((b) => b.enabled)) return null;

  const { zones, records } = await listAllGslbZonesWithRecords();
  const index = new Map<string, ZoneGslbHealth>();
  if (zones.length === 0) return index;

  const byId = new Map(backends.map((b) => [b.id, b]));
  const usedIds = [...new Set(zones.map((z) => z.backendId))];
  const statuses = new Map(
    await Promise.all(
      usedIds.map(async (id) => {
        const backend = byId.get(id);
        return [id, backend ? await backendStatus(backend) : null] as const;
      }),
    ),
  );

  for (const zone of zones) {
    const scope: HorizonScope = zone.serverId
      ? { serverId: zone.serverId }
      : { clusterId: zone.clusterId! };
    const states = statuses.get(zone.backendId) ?? null;
    const effective = records
      .filter((r) => r.gslbZoneId === zone.id)
      .map((r) => ({ target: recordTarget(r.name, zone.zoneName), members: r.members }));
    index.set(horizonKey(scope, zone.zoneName), zoneGslbHealth(effective, states));
  }
  return index;
}
