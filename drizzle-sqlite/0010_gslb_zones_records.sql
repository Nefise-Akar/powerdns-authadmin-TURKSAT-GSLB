CREATE TABLE `gslb_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`cluster_id` text,
	`zone_name` text NOT NULL,
	`backend_id` text NOT NULL,
	`subzone` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `pdns_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `pdns_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_id`) REFERENCES `gslb_backends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "gslb_zones_scope_check" CHECK(("gslb_zones"."server_id" IS NULL) <> ("gslb_zones"."cluster_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_zones_server_unique_idx` ON `gslb_zones` (`server_id`,`zone_name`) WHERE "gslb_zones"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_zones_cluster_unique_idx` ON `gslb_zones` (`cluster_id`,`zone_name`) WHERE "gslb_zones"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `gslb_zones_backend_idx` ON `gslb_zones` (`backend_id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `gslb_records_zone_name_unique_idx` ON `gslb_records` (`gslb_zone_id`,`name`);