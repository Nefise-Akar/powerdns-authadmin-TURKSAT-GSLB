CREATE TABLE `gslb_record_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`cluster_id` text,
	`zone_name` text NOT NULL,
	`name` text NOT NULL,
	`settings` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `pdns_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `pdns_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "gslb_record_presets_scope_check" CHECK(("gslb_record_presets"."server_id" IS NULL) <> ("gslb_record_presets"."cluster_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_record_presets_server_unique_idx` ON `gslb_record_presets` (`server_id`,`zone_name`,`name`) WHERE "gslb_record_presets"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_record_presets_cluster_unique_idx` ON `gslb_record_presets` (`cluster_id`,`zone_name`,`name`) WHERE "gslb_record_presets"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `zone_pair_members` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_id` text NOT NULL,
	`server_id` text,
	`cluster_id` text,
	`zone_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pair_id`) REFERENCES `zone_pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `pdns_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `pdns_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_pair_members_scope_check" CHECK(("zone_pair_members"."server_id" IS NULL) <> ("zone_pair_members"."cluster_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_pair_members_server_unique_idx` ON `zone_pair_members` (`server_id`,`zone_name`) WHERE "zone_pair_members"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_pair_members_cluster_unique_idx` ON `zone_pair_members` (`cluster_id`,`zone_name`) WHERE "zone_pair_members"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `zone_pair_members_pair_idx` ON `zone_pair_members` (`pair_id`);--> statement-breakpoint
CREATE TABLE `zone_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
