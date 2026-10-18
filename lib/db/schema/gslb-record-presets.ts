/**
 * lib/db/schema/gslb-record-presets.ts
 *
 * The last GSLB settings used for a name, kept when GSLB is switched off so
 * the enable dialog can offer them again (never applied automatically).
 * Keyed like `gslb_records` but by zone identity + name rather than by a
 * `gslb_zones` row, so it survives independently of the zone's GSLB state.
 * A stale preset (name deleted, members gone) is harmless: the dialog only
 * reuses members whose content still exists.
 */

import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { GslbRecordPreset } from "@/lib/gslb/model";
import { pdnsClusters } from "./pdns-clusters";
import { pdnsServers } from "./pdns-servers";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbRecordPresets = pgTable(
  "gslb_record_presets",
  {
    id: pk(),
    serverId: uuid("server_id").references(() => pdnsServers.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => pdnsClusters.id, { onDelete: "cascade" }),
    zoneName: text("zone_name").notNull(),
    /** Canonical owner name. */
    name: text("name").notNull(),
    settings: jsonb("settings").$type<GslbRecordPreset>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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
