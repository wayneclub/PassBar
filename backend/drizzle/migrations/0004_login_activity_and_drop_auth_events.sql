-- Catches prod up to migrations 0001/0002, which were generated locally but never applied
-- (login_activity was missing in prod, so syncLoginActivity has been silently failing on
-- every login; auth_events was still present despite already being unused/dead, 0 rows).
-- The question_ai_explanations unique constraint from 0001 already exists in prod under a
-- different name (raw-SQL provisioning), so it's intentionally not repeated here.

CREATE TABLE IF NOT EXISTS "login_activity" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"login_count" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_logout_at" timestamp with time zone,
	"last_ip" text,
	"last_device" text,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'login_activity_user_id_profiles_id_fk'
      AND conrelid = 'public.login_activity'::regclass
  ) THEN
    ALTER TABLE "login_activity"
      ADD CONSTRAINT "login_activity_user_id_profiles_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
DROP TABLE IF EXISTS "auth_events" CASCADE;
