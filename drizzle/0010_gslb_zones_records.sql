CREATE TABLE "gslb_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gslb_zone_id" uuid NOT NULL,
	"backend_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"original_types" jsonb NOT NULL,
	"original_rrsets" jsonb NOT NULL,
	"mode" text NOT NULL,
	"monitor" jsonb NOT NULL,
	"ttl" integer NOT NULL,
	"members" jsonb NOT NULL,
	"remote_row_ids" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gslb_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"cluster_id" uuid,
	"zone_name" text NOT NULL,
	"backend_id" uuid NOT NULL,
	"subzone" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gslb_zones_scope_check" CHECK (("gslb_zones"."server_id" IS NULL) <> ("gslb_zones"."cluster_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "gslb_records" ADD CONSTRAINT "gslb_records_gslb_zone_id_gslb_zones_id_fk" FOREIGN KEY ("gslb_zone_id") REFERENCES "public"."gslb_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_records" ADD CONSTRAINT "gslb_records_backend_id_gslb_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."gslb_backends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_records" ADD CONSTRAINT "gslb_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_zones" ADD CONSTRAINT "gslb_zones_server_id_pdns_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."pdns_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_zones" ADD CONSTRAINT "gslb_zones_cluster_id_pdns_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."pdns_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_zones" ADD CONSTRAINT "gslb_zones_backend_id_gslb_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."gslb_backends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_zones" ADD CONSTRAINT "gslb_zones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_records_zone_name_unique_idx" ON "gslb_records" USING btree ("gslb_zone_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_zones_server_unique_idx" ON "gslb_zones" USING btree ("server_id","zone_name") WHERE "gslb_zones"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_zones_cluster_unique_idx" ON "gslb_zones" USING btree ("cluster_id","zone_name") WHERE "gslb_zones"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gslb_zones_backend_idx" ON "gslb_zones" USING btree ("backend_id");