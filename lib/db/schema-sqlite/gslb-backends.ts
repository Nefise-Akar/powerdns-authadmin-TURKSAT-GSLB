/**
 * lib/db/schema-sqlite/gslb-backends.ts - SQLite mirror of `../schema/gslb-backends.ts`.
 */

import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

/** Same shape as the PG side; re-declared to keep the SQLite schema module standalone. */
export interface GslbProbeCache {
  fetchedAt: string;
  ok: boolean;
  reason?: string;
  latencyMs?: number;
  counts?: { domains: number; monitors: number; views: number; records: number };
}

export const gslbBackends = sqliteTable(
  "gslb_backends",
  {
    id: pk(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    baseUrl: text("base_url").notNull(),
    username: text("username").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    nameserverHost: text("nameserver_host"),
    nameserverAddresses: text("nameserver_addresses", { mode: "json" }).$type<string[]>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    probeCache: text("probe_cache", { mode: "json" }).$type<GslbProbeCache | null>(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    slugIdx: uniqueIndex("gslb_backends_slug_idx").on(t.slug),
  }),
);

export type GslbBackend = typeof gslbBackends.$inferSelect;
export type NewGslbBackend = typeof gslbBackends.$inferInsert;
