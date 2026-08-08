CREATE TABLE IF NOT EXISTS "question_sources" (
	"question_id" text NOT NULL,
	"source_uid" text NOT NULL,
	"provider" text NOT NULL,
	"source_type" text NOT NULL,
	"source_file" text,
	"source_format" text,
	"source_question_number" integer,
	"source_sha256" text,
	"answer_key" text,
	"is_ncbe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "question_sources_source_uid_unique" UNIQUE("source_uid"),
	CONSTRAINT "question_sources_question_id_source_uid_unique" UNIQUE("question_id","source_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_snapshots_user_id_snapshot_date_unique" UNIQUE("user_id","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "question_items" ADD COLUMN IF NOT EXISTS "is_ncbe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_snapshots" ADD CONSTRAINT "plan_snapshots_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
