-- 1) Add the new JSONB columns to question_items and backfill them from the
--    normalized child tables before those tables are dropped.
ALTER TABLE "question_items" ADD COLUMN "stem" jsonb;
--> statement-breakpoint
ALTER TABLE "question_items" ADD COLUMN "choices" jsonb;
--> statement-breakpoint
ALTER TABLE "question_items" ADD COLUMN "explanation" jsonb;
--> statement-breakpoint

UPDATE "question_items" q SET "stem" = jsonb_strip_nulls(jsonb_build_object(
  'en', (SELECT t.question_stem FROM "question_texts" t WHERE t.question_id = q.id AND t.language = 'en' LIMIT 1),
  'zh', (SELECT t.question_stem FROM "question_texts" t WHERE t.question_id = q.id AND t.language = 'zh' LIMIT 1)
));
--> statement-breakpoint

UPDATE "question_items" q SET "choices" = COALESCE((
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'key', en.choice_key,
    'en', en.choice,
    'zh', zh.choice,
    'sortOrder', en.sort_order,
    'isCorrect', en.is_correct
  )) ORDER BY en.sort_order)
  FROM "question_choices" en
  LEFT JOIN "question_choices" zh
    ON zh.question_id = en.question_id AND zh.choice_key = en.choice_key AND zh.language = 'zh'
  WHERE en.question_id = q.id AND en.language = 'en'
), '[]'::jsonb);
--> statement-breakpoint

UPDATE "question_items" q SET "explanation" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
  'en', (SELECT e.explanation_html FROM "question_explanations" e WHERE e.question_id = q.id AND e.language = 'en' LIMIT 1),
  'zh', (SELECT e.explanation_html FROM "question_explanations" e WHERE e.question_id = q.id AND e.language = 'zh' LIMIT 1)
)), '{}'::jsonb);
--> statement-breakpoint

ALTER TABLE "question_items" ALTER COLUMN "stem" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "question_items" ALTER COLUMN "choices" SET NOT NULL;
--> statement-breakpoint

-- 2) Drop the now-folded-in child tables.
DROP TABLE "question_texts" CASCADE;
--> statement-breakpoint
DROP TABLE "question_choices" CASCADE;
--> statement-breakpoint
DROP TABLE "question_explanations" CASCADE;
--> statement-breakpoint

-- 3) Drop the questions/question_chapter_counts view dependency on question_items columns,
--    then drop the dead/duplicate columns on question_items itself.
DROP VIEW IF EXISTS "questions";
--> statement-breakpoint

ALTER TABLE "question_items" DROP COLUMN "question";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "source_question";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "source_choices";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "source_correct_answer";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "source_explanation_html";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_qid";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_answer_key";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_match_ok";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_match_score";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_url";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "api_status";
--> statement-breakpoint
ALTER TABLE "question_items" DROP COLUMN "difficulty";
--> statement-breakpoint

-- 4) chapters: drop dead import-metadata columns (always null, no writer), add updated_at.
ALTER TABLE "chapters" DROP COLUMN "source";
--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "captured_at";
--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "screenshot_count";
--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "url";
--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "exam_name";
--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "raw_meta";
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint

-- 5) Drop pre-auth-service NextAuth leftovers (0 rows, 0 code references) and the local
--    `users` mirror table (profiles.id no longer has a local FK; auth-service is the source
--    of truth for the user record itself).
ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_id_users_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "accounts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "sessions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "verification_token" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "users" CASCADE;
--> statement-breakpoint

-- 6) Timestamp consistency: add created_at/updated_at to mutable tables that lacked them.
ALTER TABLE "practice_sessions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "practice_answers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "topic_study_progress" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_concept_mastery" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();
