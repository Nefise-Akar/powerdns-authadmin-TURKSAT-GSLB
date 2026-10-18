/**
 * lib/db/schema/gslb-zones.ts
 *
 * Zones that have GSLB switched on (ADR-0024 §3, §6). The first GSLB record in
 * zone Z creates PowerGSLB domain `gslb.Z` and delegates it from Z (NS + glue);
 * this row records that, so later records reuse it and the zone stays bound to
 * one GSLB backend (the delegation points at that backend's nameserver).
 *
 * Zone identity mirrors `zone_horizons`: exactly one of `server_id` /
 * `cluster_id`, resolved by `horizonScopeFor`, so a cluster zone is the same
 * row whichever peer served the page. `zone_name` is canonical.
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gslbBackends } from "./gslb-backends";
import { pdnsClusters } from "./pdns-clusters";
import { pdnsServers } from "./pdns-servers";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

export const gslbZones = pgTable(
  "gslb_zones",
  {
    id: pk(),
    serverId: uuid("server_id").references(() => pdnsServers.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => pdnsClusters.id, { onDelete: "cascade" }),
    /** Canonical parent zone name (lowercase, trailing dot). */
    zoneName: text("zone_name").notNull(),
    /**
     * Restrict, not cascade: deleting a backend that still serves a zone would
     * strand the delegation and every GSLB CNAME in it.
     */
    backendId: uuid("backend_id")
      .notNull()
      .references(() => gslbBackends.id, { onDelete: "restrict" }),
    /** `gslb.<zone>` - canonical, trailing dot. */
    subzone: text("subzone").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
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
