/**
 * lib/db/schema-sqlite/gslb-zones.ts - SQLite mirror of `../schema/gslb-zones.ts`.
 */

import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { gslbBackends } from "./gslb-backends";
import { pdnsClusters } from "./pdns-clusters";
import { pdnsServers } from "./pdns-servers";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbZones = sqliteTable(
  "gslb_zones",
  {
    id: pk(),
    serverId: text("server_id").references(() => pdnsServers.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => pdnsClusters.id, { onDelete: "cascade" }),
    zoneName: text("zone_name").notNull(),
    backendId: text("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "restrict" }),
    subzone: text("subzone").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    serverUniq: uniqueIndex("gslb_zones_server_unique_idx")
      .on(t.serverId, t.zoneName)
      .where(sql`${t.serverId} IS NOT NULL`),
    clusterUniq: uniqueIndex("gslb_zones_cluster_unique_idx")
      .on(t.clusterId, t.zoneName)
      .where(sql`${t.clusterId} IS NOT NULL`),
    backendIdx: index("gslb_zones_backend_idx").on(t.backendId),
    scopeCheck: check(
      "gslb_zones_scope_check",
      sql`(${t.serverId} IS NULL) <> (${t.clusterId} IS NULL)`,
    ),
  }),
);

export type GslbZone = typeof gslbZones.$inferSelect;
export type NewGslbZone = typeof gslbZones.$inferInsert;
