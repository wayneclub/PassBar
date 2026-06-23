CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" bigint,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_unique" UNIQUE("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"sessionToken" text NOT NULL,
	CONSTRAINT "sessions_sessionToken_unique" UNIQUE("sessionToken")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"full_name" text,
	"avatar_url" text,
	"role" text DEFAULT 'student' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"study_settings" jsonb NOT NULL,
	"exam_date" date,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"source" text,
	"captured_at" timestamp with time zone,
	"count" integer,
	"screenshot_count" integer,
	"url" text,
	"exam_name" text,
	"subject" text NOT NULL,
	"chapter" text NOT NULL,
	"slug" text NOT NULL,
	"raw_meta" jsonb,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "chapters_subject_id_slug_unique" UNIQUE("subject_id","slug")
);
--> statement-breakpoint
CREATE TABLE "question_ai_explanations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"selected_choice" text,
	"correct_choice" text,
	"is_correct" boolean DEFAULT false NOT NULL,
	"interface_language" text DEFAULT 'zh-Hant' NOT NULL,
	"prompt_version" text DEFAULT 'question-analysis-v2' NOT NULL,
	"source" text DEFAULT 'gemini' NOT NULL,
	"model" text,
	"analysis_markdown" text NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "question_choices" (
	"question_id" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"source" text DEFAULT 'uworld' NOT NULL,
	"choice_key" text NOT NULL,
	"choice" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "question_choices_question_id_language_choice_key_pk" PRIMARY KEY("question_id","language","choice_key")
);
--> statement-breakpoint
CREATE TABLE "question_explanations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"language" text NOT NULL,
	"source" text DEFAULT 'uworld' NOT NULL,
	"explanation_text" text,
	"explanation_html" text,
	"mime_type" text,
	"sort_order" integer DEFAULT 0,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "question_items" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"index" integer NOT NULL,
	"question" text NOT NULL,
	"correct_answer" text NOT NULL,
	"source_question" text,
	"source_choices" jsonb,
	"source_correct_answer" text,
	"source_explanation_html" text,
	"api_qid" text,
	"api_answer_key" text,
	"api_match_ok" boolean,
	"api_match_score" numeric,
	"api_url" text,
	"api_status" integer,
	"topic" text,
	"micro_concept" text,
	"trap_type" text,
	"trap_type_is_new" boolean,
	"skill_tested" text,
	"difficulty" text,
	"keyword_meta" jsonb,
	"highlight_meta" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "question_items_chapter_id_index_unique" UNIQUE("chapter_id","index")
);
--> statement-breakpoint
CREATE TABLE "question_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" text NOT NULL,
	"user_id" uuid,
	"category" text DEFAULT 'other' NOT NULL,
	"categories" text[],
	"language" text,
	"message" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_texts" (
	"question_id" text NOT NULL,
	"language" text NOT NULL,
	"source" text NOT NULL,
	"question_stem" text NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "question_texts_question_id_language_source_pk" PRIMARY KEY("question_id","language","source")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "subjects_subject_unique" UNIQUE("subject"),
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"provider" text,
	"email" text,
	"session_expires_at" timestamp with time zone,
	"user_agent" text,
	"path" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"category" text,
	"subject" text,
	"qid" text,
	"ref_subject" text,
	"ref_chapter" text,
	"email" text,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"question_id" text NOT NULL,
	"selected_choice" text NOT NULL,
	"correct_answer" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"is_marked" boolean DEFAULT false,
	"time_spent_seconds" integer DEFAULT 0,
	"confidence" text,
	"changed_answer" boolean DEFAULT false,
	"error_type" text,
	"previous_is_correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now(),
	"raw" jsonb,
	CONSTRAINT "practice_answers_session_id_question_id_unique" UNIQUE("session_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"mode" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"subject_ids" text[] DEFAULT '{}',
	"chapter_ids" text[] DEFAULT '{}',
	"question_count" integer,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"total_time_seconds" integer DEFAULT 0,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"user_agent" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"type" text DEFAULT 'manual' NOT NULL,
	"due_date" date,
	"chapter_id" text,
	"chapter_ids" text,
	"auto_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "topic_study_progress" (
	"user_id" uuid NOT NULL,
	"chapter_id" text NOT NULL,
	"viewed_count" integer DEFAULT 0 NOT NULL,
	"last_question_id" text,
	"last_question_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_study_progress_user_id_chapter_id_pk" PRIMARY KEY("user_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE "topic_study_question_states" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"chapter_id" text,
	"is_learned" boolean DEFAULT false NOT NULL,
	"is_marked" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_study_question_states_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_key_unique" UNIQUE("user_id","badge_key")
);
--> statement-breakpoint
CREATE TABLE "user_concept_mastery" (
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"topic" text NOT NULL,
	"micro_concept" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"status" text DEFAULT 'under-sampled' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_concept_mastery_user_id_subject_topic_micro_concept_pk" PRIMARY KEY("user_id","subject","topic","micro_concept")
);
--> statement-breakpoint
CREATE TABLE "user_question_progress" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"status" text NOT NULL,
	"selected_choice" text,
	"correct_answer" text,
	"is_correct" boolean,
	"is_marked" boolean DEFAULT false NOT NULL,
	"times_answered" integer DEFAULT 0 NOT NULL,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	"last_answered_at" timestamp with time zone,
	"raw" jsonb,
	CONSTRAINT "user_question_progress_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_ai_explanations" ADD CONSTRAINT "question_ai_explanations_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_choices" ADD CONSTRAINT "question_choices_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_explanations" ADD CONSTRAINT "question_explanations_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_reports" ADD CONSTRAINT "question_reports_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_reports" ADD CONSTRAINT "question_reports_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_texts" ADD CONSTRAINT "question_texts_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_study_progress" ADD CONSTRAINT "topic_study_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_study_question_states" ADD CONSTRAINT "topic_study_question_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_concept_mastery" ADD CONSTRAINT "user_concept_mastery_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_question_progress" ADD CONSTRAINT "user_question_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_question_progress" ADD CONSTRAINT "user_question_progress_question_id_question_items_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question_items"("id") ON DELETE cascade ON UPDATE no action;