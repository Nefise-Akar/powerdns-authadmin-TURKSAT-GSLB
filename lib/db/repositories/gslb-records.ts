/**
 * lib/db/repositories/gslb-records.ts
 *
 * App-DB side of per-record GSLB (ADR-0024 §6): the `gslb_zones` row per
 * GSLB-enabled zone and the `gslb_records` row per managed name. PowerGSLB
 * and the parent zone are sequenced by `lib/gslb/record-sync.ts`; these
 * functions touch the DB only.
 *
 * Zone scope is the same `{ serverId } | { clusterId }` pair zone horizons
 * use (`horizonScopeFor`), so a cluster zone resolves to one row whichever
 * peer served the request.
 */

import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { computeOwnedRRsets } from "@/lib/gslb/record-plan";
import type { GslbRecordPreset } from "@/lib/gslb/model";
import {
  gslbBackends,
  gslbRecordPresets,
  gslbRecords,
  gslbZones,
  type GslbRecordRow,
  type GslbZone,
  type NewGslbRecordRow,
} from "@/lib/db/schema";
import type { HorizonScope } from "./zone-horizons";

export type GslbZoneScope = HorizonScope;

function scopeCondition(scope: GslbZoneScope) {
  return "serverId" in scope
    ? and(eq(gslbZones.serverId, scope.serverId), isNull(gslbZones.clusterId))
    : and(eq(gslbZones.clusterId, scope.clusterId), isNull(gslbZones.serverId));
}

export async function findGslbZone(
  scope: GslbZoneScope,
  zoneName: string,
): Promise<GslbZone | null> {
  const rows = await db
    .select()
    .from(gslbZones)
    .where(and(scopeCondition(scope), eq(gslbZones.zoneName, zoneName)));
  return rows[0] ?? null;
}

export async function insertGslbZone(
  input: {
    scope: GslbZoneScope;
    zoneName: string;
    backendId: string;
    subzone: string;
    createdBy: string;
  },
  executor: DbExecutor = db,
): Promise<GslbZone> {
  const [row] = await executor
    .insert(gslbZones)
    .values({
      ...("serverId" in input.scope
        ? { serverId: input.scope.serverId }
        : { clusterId: input.scope.clusterId }),
      zoneName: input.zoneName,
      backendId: input.backendId,
      subzone: input.subzone,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error("gslb-zones.insert: no row returned");
  return row;
}

export async function listGslbRecordsForZone(gslbZoneId: string): Promise<GslbRecordRow[]> {
  return db
    .select()
    .from(gslbRecords)
    .where(eq(gslbRecords.gslbZoneId, gslbZoneId))
    .orderBy(asc(gslbRecords.name));
}

export async function findGslbRecord(
  gslbZoneId: string,
  name: string,
): Promise<GslbRecordRow | null> {
  const rows = await db
    .select()
    .from(gslbRecords)
    .where(and(eq(gslbRecords.gslbZoneId, gslbZoneId), eq(gslbRecords.name, name)));
  return rows[0] ?? null;
}

export async function insertGslbRecord(
  input: Omit<NewGslbRecordRow, "id" | "createdAt" | "updatedAt">,
  executor: DbExecutor = db,
): Promise<GslbRecordRow> {
  const [row] = await executor.insert(gslbRecords).values(input).returning();
  if (!row) throw new Error("gslb-records.insert: no row returned");
  return row;
}

export async function updateGslbRecordRow(
  id: string,
  patch: Partial<Pick<GslbRecordRow, "mode" | "monitor" | "ttl" | "members" | "remoteRowIds">>,
  executor: DbExecutor = db,
): Promise<GslbRecordRow | null> {
  const [row] = await executor
    .update(gslbRecords)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(gslbRecords.id, id))
    .returning();
  return row ?? null;
}

export async function deleteGslbRecordRow(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(gslbRecords).where(eq(gslbRecords.id, id));
}

export async function loadGslbOwnedRRsets(
  scope: GslbZoneScope,
  zoneName: string,
): Promise<{ names: ReadonlySet<string>; delegationKeys: ReadonlySet<string> } | null> {
  const [zone, backends] = await Promise.all([
    findGslbZone(scope, zoneName),
    db.select().from(gslbBackends),
  ]);
  const records = zone ? await listGslbRecordsForZone(zone.id) : [];
  const zoneBackend = zone ? backends.find((b) => b.id === zone.backendId) : undefined;
  const owned = computeOwnedRRsets({
    managedNames: records.map((r) => r.name),
    zoneDelegation: zone
      ? { subzone: zone.subzone, nameserverHost: zoneBackend?.nameserverHost ?? null }
      : null,
  });
  if (owned.names.size === 0 && owned.delegationKeys.size === 0) return null;
  return owned;
}

function presetScopeCondition(scope: GslbZoneScope) {
  return "serverId" in scope
    ? and(eq(gslbRecordPresets.serverId, scope.serverId), isNull(gslbRecordPresets.clusterId))
    : and(eq(gslbRecordPresets.clusterId, scope.clusterId), isNull(gslbRecordPresets.serverId));
}

/** Last-used settings per name in one zone (names canonical). */
export async function listGslbRecordPresets(
  scope: GslbZoneScope,
  zoneName: string,
): Promise<Map<string, GslbRecordPreset>> {
  const rows = await db
    .select()
    .from(gslbRecordPresets)
    .where(and(presetScopeCondition(scope), eq(gslbRecordPresets.zoneName, zoneName)));
  return new Map(rows.map((r) => [r.name, r.settings]));
}

/** Remember a name's settings (replaces any earlier preset for it). */
export async function saveGslbRecordPreset(
  input: {
    scope: GslbZoneScope;
    zoneName: string;
    name: string;
    settings: GslbRecordPreset;
    createdBy: string;
  },
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .delete(gslbRecordPresets)
    .where(
      and(
        presetScopeCondition(input.scope),
        eq(gslbRecordPresets.zoneName, input.zoneName),
        eq(gslbRecordPresets.name, input.name),
      ),
    );
  await executor.insert(gslbRecordPresets).values({
    ...("serverId" in input.scope
      ? { serverId: input.scope.serverId }
      : { clusterId: input.scope.clusterId }),
    zoneName: input.zoneName,
    name: input.name,
    settings: input.settings,
    createdBy: input.createdBy,
  });
}

/** Every GSLB zone + record, for the fleet-wide zones list (two queries). */
export async function listAllGslbZonesWithRecords(): Promise<{
  zones: GslbZone[];
  records: GslbRecordRow[];
}> {
  const [zones, records] = await Promise.all([
    db.select().from(gslbZones),
    db.select().from(gslbRecords),
  ]);
  return { zones, records };
}

export async function deleteGslbZoneRow(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(gslbZones).where(eq(gslbZones.id, id));
}

/** Zones bound to a backend, with how many GSLB records each still has. */
export async function listGslbZonesForBackend(
  backendId: string,
): Promise<Array<{ zone: GslbZone; records: number }>> {
  const zones = await db.select().from(gslbZones).where(eq(gslbZones.backendId, backendId));
  return Promise.all(
    zones.map(async (zone) => ({ zone, records: (await listGslbRecordsForZone(zone.id)).length })),
  );
}

/**
 * GSLB zones of one PowerDNS server (standalone) or cluster, with record
 * counts - a server/cluster delete is refused while any exist.
 */
export async function listGslbZonesForScope(
  scope: GslbZoneScope,
): Promise<Array<{ zone: GslbZone; records: number }>> {
  const zones = await db.select().from(gslbZones).where(scopeCondition(scope));
  return Promise.all(
    zones.map(async (zone) => ({ zone, records: (await listGslbRecordsForZone(zone.id)).length })),
  );
}
