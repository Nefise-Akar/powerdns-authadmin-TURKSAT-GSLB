CREATE TABLE `gslb_backends` (
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
CREATE UNIQUE INDEX `gslb_backends_slug_idx` ON `gslb_backends` (`slug`);