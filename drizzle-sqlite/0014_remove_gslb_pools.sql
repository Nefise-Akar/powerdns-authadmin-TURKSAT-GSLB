-- Removes GSLB service pools (ADR-0024). Hand-written: drizzle-kit's table
-- rebuild drops `gslb_backends` while foreign keys are still ON (PRAGMA
-- foreign_keys is a no-op inside the migrator's transaction), which would
-- cascade-delete every `gslb_regions` row. Child rows are parked in temp
-- tables around the rebuild instead.
--
-- Guard: refuse to run while pools or pool-backed records exist - dropping
-- them would leave zone CNAMEs pointing at a domain nobody manages. Delete
-- the pools (and switch their records off) first.
CREATE TEMP TABLE `_gslb_pool_guard` (`pool_rows_must_be_deleted_first` integer CHECK (`pool_rows_must_be_deleted_first` = 0));--> statement-breakpoint
INSERT INTO `_gslb_pool_guard` SELECT (SELECT count(*) FROM `gslb_pools`) + (SELECT count(*) FROM `gslb_records` WHERE `pool_id` IS NOT NULL);--> statement-breakpoint
DROP TABLE `_gslb_pool_guard`;--> statement-breakpoint
CREATE TEMP TABLE `_gslb_regions_keep` AS SELECT `id`, `backend_id`, `slug`, `name`, `description`, `rules`, `created_by`, `created_at`, `updated_at` FROM `gslb_regions`;--> statement-breakpoint
CREATE TEMP TABLE `_gslb_zones_keep` AS SELECT `id`, `server_id`, `cluster_id`, `zone_name`, `backend_id`, `subzone`, `created_by`, `created_at`, `updated_at` FROM `gslb_zones`;--> statement-breakpoint
CREATE TEMP TABLE `_gslb_records_keep` AS SELECT `id`, `gslb_zone_id`, `backend_id`, `name`, `kind`, `original_types`, `original_rrsets`, `mode`, `monitor`, `ttl`, `members`, `remote_row_ids`, `created_by`, `created_at`, `updated_at` FROM `gslb_records`;--> statement-breakpoint
DELETE FROM `gslb_records`;--> statement-breakpoint
DELETE FROM `gslb_zones`;--> statement-breakpoint
DELETE FROM `gslb_regions`;--> statement-breakpoint
DROP TABLE `gslb_records`;--> statement-breakpoint
DROP TABLE `gslb_pools`;--> statement-breakpoint
CREATE TABLE `__new_gslb_backends` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`base_url` text NOT NULL,
	`username` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`nameserver_host` text,
	`nameserver_addresses` text,
	`enabled` integer DEFAULT true NOT NULL,
	`probe_cache` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_gslb_backends`("id", "slug", "name", "description", "base_url", "username", "password_encrypted", "nameserver_host", "nameserver_addresses", "enabled", "probe_cache", "created_by", "created_at", "updated_at") SELECT "id", "slug", "name", "description", "base_url", "username", "password_encrypted", "nameserver_host", "nameserver_addresses", "enabled", "probe_cache", "created_by", "created_at", "updated_at" FROM `gslb_backends`;--> statement-breakpoint
DROP TABLE `gslb_backends`;--> statement-breakpoint
ALTER TABLE `__new_gslb_backends` RENAME TO `gslb_backends`;--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_backends_slug_idx` ON `gslb_backends` (`slug`);--> statement-breakpoint
CREATE TABLE `gslb_records` (
	`id` text PRIMARY KEY NOT NULL,
	`gslb_zone_id` text NOT NULL,
	`backend_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`original_types` text NOT NULL,
	`original_rrsets` text NOT NULL,
	`mode` text NOT NULL,
	`monitor` text NOT NULL,
	`ttl` integer NOT NULL,
	`members` text NOT NULL,
	`remote_row_ids` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`gslb_zone_id`) REFERENCES `gslb_zones`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`backend_id`) REFERENCES `gslb_backends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_records_zone_name_unique_idx` ON `gslb_records` (`gslb_zone_id`,`name`);--> statement-breakpoint
ALTER TABLE `gslb_zones` DROP COLUMN `delegated`;--> statement-breakpoint
INSERT INTO `gslb_regions` SELECT * FROM `_gslb_regions_keep`;--> statement-breakpoint
INSERT INTO `gslb_zones` (`id`, `server_id`, `cluster_id`, `zone_name`, `backend_id`, `subzone`, `created_by`, `created_at`, `updated_at`) SELECT * FROM `_gslb_zones_keep`;--> statement-breakpoint
INSERT INTO `gslb_records` SELECT * FROM `_gslb_records_keep`;--> statement-breakpoint
DROP TABLE `_gslb_regions_keep`;--> statement-breakpoint
DROP TABLE `_gslb_zones_keep`;--> statement-breakpoint
DROP TABLE `_gslb_records_keep`;
