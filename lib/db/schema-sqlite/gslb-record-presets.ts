/**
 * lib/db/schema-sqlite/gslb-record-presets.ts - SQLite mirror of `../schema/gslb-record-presets.ts`.
 */

import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { GslbRecordPreset } from "@/lib/gslb/model";
import { pdnsClusters } from "./pdns-clusters";
import { pdnsServers } from "./pdns-servers";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbRecordPresets = sqliteTable(
  "gslb_record_presets",
  {
    id: pk(),
    serverId: text("server_id").references(() => pdnsServers.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => pdnsClusters.id, { onDelete: "cascade" }),
    zoneName: text("zone_name").notNull(),
    name: text("name").notNull(),
    settings: text("settings", { mode: "json" }).$type<GslbRecordPreset>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    serverUniq: uniqueIndex("gslb_record_presets_server_unique_idx")
      .on(t.serverId, t.zoneName, t.name)
      .where(sql`${t.serverId} IS NOT NULL`),
    clusterUniq: uniqueIndex("gslb_record_presets_cluster_unique_idx")
      .on(t.clusterId, t.zoneName, t.name)
      .where(sql`${t.clusterId} IS NOT NULL`),
    scopeCheck: check(
      "gslb_record_presets_scope_check",
      sql`(${t.serverId} IS NULL) <> (${t.clusterId} IS NULL)`,
    ),
  }),
);

export type GslbRecordPresetRow = typeof gslbRecordPresets.$inferSelect;
