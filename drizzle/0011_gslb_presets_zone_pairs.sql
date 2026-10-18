CREATE TABLE "gslb_record_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"cluster_id" uuid,
	"zone_name" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gslb_record_presets_scope_check" CHECK (("gslb_record_presets"."server_id" IS NULL) <> ("gslb_record_presets"."cluster_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "zone_pair_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"server_id" uuid,
	"cluster_id" uuid,
	"zone_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_pair_members_scope_check" CHECK (("zone_pair_members"."server_id" IS NULL) <> ("zone_pair_members"."cluster_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "zone_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gslb_record_presets" ADD CONSTRAINT "gslb_record_presets_server_id_pdns_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."pdns_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_record_presets" ADD CONSTRAINT "gslb_record_presets_cluster_id_pdns_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."pdns_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_record_presets" ADD CONSTRAINT "gslb_record_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_pair_members" ADD CONSTRAINT "zone_pair_members_pair_id_zone_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."zone_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_pair_members" ADD CONSTRAINT "zone_pair_members_server_id_pdns_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."pdns_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_pair_members" ADD CONSTRAINT "zone_pair_members_cluster_id_pdns_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."pdns_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_pairs" ADD CONSTRAINT "zone_pairs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_record_presets_server_unique_idx" ON "gslb_record_presets" USING btree ("server_id","zone_name","name") WHERE "gslb_record_presets"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_record_presets_cluster_unique_idx" ON "gslb_record_presets" USING btree ("cluster_id","zone_name","name") WHERE "gslb_record_presets"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "zone_pair_members_server_unique_idx" ON "zone_pair_members" USING btree ("server_id","zone_name") WHERE "zone_pair_members"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "zone_pair_members_cluster_unique_idx" ON "zone_pair_members" USING btree ("cluster_id","zone_name") WHERE "zone_pair_members"."cluster_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "zone_pair_members_pair_idx" ON "zone_pair_members" USING btree ("pair_id");