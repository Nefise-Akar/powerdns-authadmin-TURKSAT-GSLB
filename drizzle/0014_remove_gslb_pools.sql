-- Removes GSLB service pools (ADR-0024). Refuses to run while pools or
-- pool-backed records exist: dropping them would leave zone CNAMEs pointing at
-- a domain nobody manages. Delete the pools (and switch their records off) first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "gslb_pools") OR EXISTS (SELECT 1 FROM "gslb_records" WHERE "pool_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'GSLB service pools are being removed: delete all pools and switch off pool-backed GSLB records before upgrading.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP CONSTRAINT "gslb_backends_pool_zone_server_id_pdns_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP CONSTRAINT "gslb_backends_pool_zone_cluster_id_pdns_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "gslb_records" DROP CONSTRAINT "gslb_records_pool_id_gslb_pools_id_fk";
--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP COLUMN "pool_zone_server_id";--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP COLUMN "pool_zone_cluster_id";--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP COLUMN "pool_zone_name";--> statement-breakpoint
ALTER TABLE "gslb_backends" DROP COLUMN "pool_label";--> statement-breakpoint
ALTER TABLE "gslb_records" DROP COLUMN "pool_id";--> statement-breakpoint
ALTER TABLE "gslb_zones" DROP COLUMN "delegated";--> statement-breakpoint
-- Dropped last (hand-reordered): drizzle-kit put it first, and its CASCADE already
-- removed the gslb_records FK that the statements above drop explicitly.
DROP TABLE "gslb_pools";