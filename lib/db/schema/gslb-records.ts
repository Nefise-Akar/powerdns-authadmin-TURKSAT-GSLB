/**
 * lib/db/schema/gslb-records.ts
 *
 * One row per GSLB-managed name (ADR-0024 §3, §6). Holds everything needed to
 * switch it off again - the parent RRsets as they were (`original_rrsets`) -
 * and the GSLB settings the edit dialog round-trips. PowerGSLB row ids are a
 * cache: writes always re-read the name's rows (save-record returns no id).
 */

import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

export const gslbRecords = pgTable(
  "gslb_records",
  {
    id: pk(),
    /** Restrict: a zone row can't vanish while names in it still CNAME into its subzone. */
    gslbZoneId: uuid("gslb_zone_id")
      .notNull()
      .references(() => gslbZones.id, { onDelete: "restrict" }),
    backendId: uuid("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "restrict" }),
    /** Canonical owner name in the parent zone (lowercase, trailing dot). */
    name: text("name").notNull(),
    kind: text("kind").$type<GslbRecordKind>().notNull(),
    /** Parent RRset types replaced by the CNAME (`["A","AAAA"]`, `["CNAME"]`). */
    originalTypes: jsonb("original_types").$type<string[]>().notNull(),
    originalRrsets: jsonb("original_rrsets").$type<GslbRRsetSnapshot[]>().notNull(),
    mode: text("mode").$type<GslbMode>().notNull(),
    monitor: jsonb("monitor").$type<GslbMonitorConfig>().notNull(),
    ttl: integer("ttl").notNull(),
    members: jsonb("members").$type<GslbMember[]>().notNull(),
    remoteRowIds: jsonb("remote_row_ids").$type<number[]>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    zoneNameUniq: uniqueIndex("gslb_records_zone_name_unique_idx").on(t.gslbZoneId, t.name),
  }),
);

export type GslbRecordRow = typeof gslbRecords.$inferSelect;
export type NewGslbRecordRow = typeof gslbRecords.$inferInsert;
