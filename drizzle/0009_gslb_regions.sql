CREATE TABLE "gslb_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backend_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gslb_regions" ADD CONSTRAINT "gslb_regions_backend_id_gslb_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."gslb_backends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gslb_regions" ADD CONSTRAINT "gslb_regions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gslb_regions_backend_slug_idx" ON "gslb_regions" USING btree ("backend_id","slug");