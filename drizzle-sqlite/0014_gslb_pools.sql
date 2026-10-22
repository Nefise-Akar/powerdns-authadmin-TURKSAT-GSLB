CREATE TABLE `gslb_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`backend_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`monitor` text NOT NULL,
	`ttl` integer NOT NULL,
	`members` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`backend_id`) REFERENCES `gslb_backends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_pools_backend_slug_idx` ON `gslb_pools` (`backend_id`,`slug`);--> statement-breakpoint
ALTER TABLE `gslb_backends` ADD `pool_zone_server_id` text REFERENCES pdns_servers(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `gslb_backends` ADD `pool_zone_cluster_id` text REFERENCES pdns_clusters(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `gslb_backends` ADD `pool_zone_name` text;--> statement-breakpoint
ALTER TABLE `gslb_backends` ADD `pool_label` text DEFAULT 'gslb-pools' NOT NULL;--> statement-breakpoint
ALTER TABLE `gslb_zones` ADD `delegated` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `gslb_records` ADD `pool_id` text REFERENCES gslb_pools(id);