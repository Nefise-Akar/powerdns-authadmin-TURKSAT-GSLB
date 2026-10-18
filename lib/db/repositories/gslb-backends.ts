/**
 * lib/db/repositories/gslb-backends.ts
 *
 * CRUD for the PowerGSLB backend connections (ADR-0024). `password_encrypted`
 * is the AES-256-GCM envelope; callers pass the already-encrypted string in and
 * receive it out - `lib/crypto/encryption.ts` does the encrypt at the route
 * boundary and the decrypt in `lib/gslb/registry.ts`.
 */

import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/lib/db";
import {
  gslbBackends,
  type GslbBackend,
  type GslbProbeCache,
  type NewGslbBackend,
} from "@/lib/db/schema";

export async function listAllGslbBackends(): Promise<GslbBackend[]> {
  return db.select().from(gslbBackends).orderBy(asc(gslbBackends.name));
}

export async function findGslbBackendById(id: string): Promise<GslbBackend | null> {
  const rows = await db.select().from(gslbBackends).where(eq(gslbBackends.id, id));
  return rows[0] ?? null;
}

export async function findGslbBackendBySlug(slug: string): Promise<GslbBackend | null> {
  const rows = await db.select().from(gslbBackends).where(eq(gslbBackends.slug, slug));
  return rows[0] ?? null;
}

export async function insertGslbBackend(
  input: Omit<NewGslbBackend, "id" | "createdAt" | "updatedAt">,
  executor: DbExecutor = db,
): Promise<GslbBackend> {
  const [row] = await executor.insert(gslbBackends).values(input).returning();
  if (!row) throw new Error("gslb-backends.insert: no row returned");
  return row;
}

export async function updateGslbBackend(
  id: string,
  patch: Partial<Omit<GslbBackend, "id" | "slug" | "createdAt" | "createdBy">>,
  executor: DbExecutor = db,
): Promise<GslbBackend | null> {
  const [row] = await executor
    .update(gslbBackends)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(gslbBackends.id, id))
    .returning();
  return row ?? null;
}

export async function deleteGslbBackend(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(gslbBackends).where(eq(gslbBackends.id, id));
}

/**
 * Persist the latest connection-probe verdict. Narrow setter so the Test
 * action can't touch any other column - and deliberately leaves `updatedAt`
 * alone, since a probe is not an edit of the connection settings.
 */
export async function setGslbProbeCache(
  id: string,
  cache: GslbProbeCache,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(gslbBackends).set({ probeCache: cache }).where(eq(gslbBackends.id, id));
}
