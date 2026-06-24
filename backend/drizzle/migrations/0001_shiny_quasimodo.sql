CREATE TABLE "login_activity" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"login_count" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_logout_at" timestamp with time zone,
	"last_ip" text,
	"last_device" text,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "login_activity" ADD CONSTRAINT "login_activity_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_ai_explanations" ADD CONSTRAINT "question_ai_explanations_question_id_selected_choice_correct_choice_interface_language_prompt_version_unique" UNIQUE("question_id","selected_choice","correct_choice","interface_language","prompt_version");