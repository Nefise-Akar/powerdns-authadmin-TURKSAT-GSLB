/**
 * lib/db/repositories/gslb-regions.ts
 *
 * CRUD for GSLB regions (ADR-0024 §4). The PowerGSLB side of each write is
 * sequenced by `lib/gslb/region-sync.ts`; these functions touch the DB only.
 */

import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import { gslbRegions, type GslbRegion, type NewGslbRegion } from "@/lib/db/schema";

export async function listGslbRegions(backendId: string): Promise<GslbRegion[]> {
  return db
    .select()
    .from(gslbRegions)
    .where(eq(gslbRegions.backendId, backendId))
    .orderBy(asc(gslbRegions.name));
}

/** Scoped to the backend so a region id from another backend's URL never resolves. */
export async function findGslbRegion(
  backendId: string,
  regionId: string,
): Promise<GslbRegion | null> {
  const rows = await db
    .select()
    .from(gslbRegions)
    .where(and(eq(gslbRegions.backendId, backendId), eq(gslbRegions.id, regionId)));
  return rows[0] ?? null;
}

export async function insertGslbRegion(
  input: Omit<NewGslbRegion, "id" | "createdAt" | "updatedAt">,
  executor: DbExecutor = db,
): Promise<GslbRegion> {
  const [row] = await executor.insert(gslbRegions).values(input).returning();
  if (!row) throw new Error("gslb-regions.insert: no row returned");
  return row;
}

export async function updateGslbRegion(
  regionId: string,
  patch: Partial<Pick<GslbRegion, "name" | "description" | "rules">>,
  executor: DbExecutor = db,
): Promise<GslbRegion | null> {
  const [row] = await executor
    .update(gslbRegions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(gslbRegions.id, regionId))
    .returning();
  return row ?? null;
}

export async function deleteGslbRegion(regionId: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(gslbRegions).where(eq(gslbRegions.id, regionId));
}
