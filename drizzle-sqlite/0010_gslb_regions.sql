CREATE TABLE `gslb_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`backend_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rules` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`backend_id`) REFERENCES `gslb_backends`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gslb_regions_backend_slug_idx` ON `gslb_regions` (`backend_id`,`slug`);