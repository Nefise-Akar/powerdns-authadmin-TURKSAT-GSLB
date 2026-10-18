CREATE TABLE "gslb_backends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_url" text NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"nameserver_host" text,
	"nameserver_addresses" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"probe_cache" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD CONSTRAINT "gslb_backends_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_backends_slug_idx" ON "gslb_backends" USING btree ("slug");