/**
 * lib/db/schema/gslb-regions.ts
 *
 * Operator-defined sites for a PowerGSLB backend (ADR-0024 §4). The panel is
 * the source of truth: each row is pushed to PowerGSLB as a view named
 * `authadmin:<slug>` whose rule is `rules` joined by single spaces. Nothing is
 * seeded - operators build the list themselves.
 */

import { jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gslbBackends } from "./gslb-backends";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbRegions = pgTable(
  "gslb_regions",
  {
    id: pk(),

    /** Regions are per backend: each PowerGSLB has its own view table. */
    backendId: uuid("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "cascade" }),

    /**
     * Immutable after create: it is the suffix of the remote view name, so a
     * rename would orphan the view and every GSLB record pointing at it.
     */
    slug: text("slug").notNull(),

    name: text("name").notNull(),

    description: text("description"),

    /**
     * Normalized rule tokens (CIDR network address, `country:XX`,
     * `continent:XX`), in operator order. See lib/validators/gslb-region-rules.ts.
     */
    rules: jsonb("rules").$type<string[]>().notNull(),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),

    ...timestamps(),
  },
  (t) => ({
    backendSlugIdx: uniqueIndex("gslb_regions_backend_slug_idx").on(t.backendId, t.slug),
  }),
);

export type GslbRegion = typeof gslbRegions.$inferSelect;
export type NewGslbRegion = typeof gslbRegions.$inferInsert;
