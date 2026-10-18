/**
 * lib/db/schema-sqlite/gslb-regions.ts - SQLite mirror of `../schema/gslb-regions.ts`.
 */

import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { gslbBackends } from "./gslb-backends";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbRegions = sqliteTable(
  "gslb_regions",
  {
    id: pk(),
    backendId: text("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    rules: text("rules", { mode: "json" }).$type<string[]>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    backendSlugIdx: uniqueIndex("gslb_regions_backend_slug_idx").on(t.backendId, t.slug),
  }),
);

export type GslbRegion = typeof gslbRegions.$inferSelect;
export type NewGslbRegion = typeof gslbRegions.$inferInsert;
