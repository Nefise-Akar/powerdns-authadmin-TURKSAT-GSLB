CREATE TABLE "gslb_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backend_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"monitor" jsonb NOT NULL,
	"ttl" integer NOT NULL,
	"members" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD COLUMN "pool_zone_server_id" uuid;--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD COLUMN "pool_zone_cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD COLUMN "pool_zone_name" text;--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD COLUMN "pool_label" text DEFAULT 'gslb-pools' NOT NULL;--> statement-breakpoint
ALTER TABLE "gslb_records" ADD COLUMN "pool_id" uuid;--> statement-breakpoint
ALTER TABLE "gslb_zones" ADD COLUMN "delegated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gslb_pools" ADD CONSTRAINT "gslb_pools_backend_id_gslb_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."gslb_backends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_pools" ADD CONSTRAINT "gslb_pools_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_pools_backend_slug_idx" ON "gslb_pools" USING btree ("backend_id","slug");--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD CONSTRAINT "gslb_backends_pool_zone_server_id_pdns_servers_id_fk" FOREIGN KEY ("pool_zone_server_id") REFERENCES "public"."pdns_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_backends" ADD CONSTRAINT "gslb_backends_pool_zone_cluster_id_pdns_clusters_id_fk" FOREIGN KEY ("pool_zone_cluster_id") REFERENCES "public"."pdns_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_records" ADD CONSTRAINT "gslb_records_pool_id_gslb_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."gslb_pools"("id") ON DELETE restrict ON UPDATE no action;