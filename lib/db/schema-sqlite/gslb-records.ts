/**
 * lib/db/schema-sqlite/gslb-records.ts - SQLite mirror of `../schema/gslb-records.ts`.
 */

import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  GslbMember,
  GslbMode,
  GslbMonitorConfig,
  GslbRecordKind,
  GslbRRsetSnapshot,
} from "@/lib/gslb/model";
import { gslbBackends } from "./gslb-backends";
import { gslbZones } from "./gslb-zones";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbRecords = sqliteTable(
  "gslb_records",
  {
    id: pk(),
    gslbZoneId: text("gslb_zone_id")
      .notNull()
      .references(() => gslbZones.id, { onDelete: "restrict" }),
    backendId: text("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: text("kind").$type<GslbRecordKind>().notNull(),
    originalTypes: text("original_types", { mode: "json" }).$type<string[]>().notNull(),
    originalRrsets: text("original_rrsets", { mode: "json" })
      .$type<GslbRRsetSnapshot[]>()
      .notNull(),
    mode: text("mode").$type<GslbMode>().notNull(),
    monitor: text("monitor", { mode: "json" }).$type<GslbMonitorConfig>().notNull(),
    ttl: integer("ttl").notNull(),
    members: text("members", { mode: "json" }).$type<GslbMember[]>().notNull(),
    remoteRowIds: text("remote_row_ids", { mode: "json" }).$type<number[]>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    zoneNameUniq: uniqueIndex("gslb_records_zone_name_unique_idx").on(t.gslbZoneId, t.name),
  }),
);

export type GslbRecordRow = typeof gslbRecords.$inferSelect;
export type NewGslbRecordRow = typeof gslbRecords.$inferInsert;
