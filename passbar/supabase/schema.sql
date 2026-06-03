-- PassBar complete schema — run this on a fresh database
-- Covers all tables used in src/ as of 2026-06-03

-- ─────────────────────────────────────────────────────────────
-- Helper function: is_admin()
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    text,
  role            text        NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  language        text        NOT NULL DEFAULT 'en',
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_update_own_profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own_last_seen"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "admins_select_all_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- subjects
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.subjects (
  id      serial PRIMARY KEY,
  subject text   NOT NULL UNIQUE
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subjects_public_read"
  ON public.subjects FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- chapters
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.chapters (
  id         text    PRIMARY KEY,
  subject_id integer NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  chapter    text    NOT NULL
);

ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chapters_public_read"
  ON public.chapters FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- question_items
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_items (
  id                     text        PRIMARY KEY,
  "index"                integer,
  chapter_id             text        NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  question               text,
  source_question        text,
  correct_answer         text,
  api_match_ok           boolean,
  api_match_score        numeric,
  api_qid                text,
  api_answer_key         text,
  micro_concept          text,
  trap_type              text,
  skill_tested           text,
  raw                    jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_items_public_read"
  ON public.question_items FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can update question metadata"
  ON public.question_items FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- question_choices
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_choices (
  id          serial  PRIMARY KEY,
  question_id text    NOT NULL REFERENCES public.question_items(id) ON DELETE CASCADE,
  language    text    NOT NULL,  -- 'en' | 'mixed' | 'zh'
  choice      text    NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_correct  boolean NOT NULL DEFAULT false
);

ALTER TABLE public.question_choices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_choices_public_read"
  ON public.question_choices FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- question_texts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_texts (
  id            serial  PRIMARY KEY,
  question_id   text    NOT NULL REFERENCES public.question_items(id) ON DELETE CASCADE,
  language      text    NOT NULL,  -- 'en' | 'mixed' | 'zh'
  question_stem text
);

ALTER TABLE public.question_texts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_texts_public_read"
  ON public.question_texts FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- question_explanations
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_explanations (
  id                       serial  PRIMARY KEY,
  question_id              text    NOT NULL REFERENCES public.question_items(id) ON DELETE CASCADE,
  language                 text    NOT NULL,  -- 'en' | 'zh'
  source                   text,              -- 'enriched' | 'castudy'
  explanation_html         text,
  explanation_image_file   text,
  public_url               text,
  sort_order               integer NOT NULL DEFAULT 0
);

ALTER TABLE public.question_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_explanations_public_read"
  ON public.question_explanations FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- question_explanation_ocr  (used in question-bank.ts)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_explanation_ocr (
  id          serial  PRIMARY KEY,
  question_id text    NOT NULL REFERENCES public.question_items(id) ON DELETE CASCADE,
  language    text    NOT NULL,
  ocr_text    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_explanation_ocr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_explanation_ocr_public_read"
  ON public.question_explanation_ocr FOR SELECT TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────
-- question_ai_explanations  (used in question-ai-analysis.ts)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_ai_explanations (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id      text        NOT NULL REFERENCES public.question_items(id) ON DELETE CASCADE,
  language         text        NOT NULL DEFAULT 'en',
  explanation_html text,
  model            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_ai_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_ai_explanations_public_read"
  ON public.question_ai_explanations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admins_manage_ai_explanations"
  ON public.question_ai_explanations FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- question_chapter_counts  (view or materialized; used in dashboard & question-bank)
-- ─────────────────────────────────────────────────────────────
CREATE VIEW public.question_chapter_counts AS
SELECT
  ch.id   AS chapter_id,
  s.subject,
  ch.chapter,
  count(q.id) AS question_count
FROM public.chapters ch
JOIN public.subjects s ON s.id = ch.subject_id
LEFT JOIN public.question_items q ON q.chapter_id = ch.id
GROUP BY ch.id, s.subject, ch.chapter;

-- ─────────────────────────────────────────────────────────────
-- questions  (view — aggregates all question data)
-- ─────────────────────────────────────────────────────────────
CREATE VIEW public.questions AS
WITH choice_rows AS (
  SELECT
    question_id,
    array_agg(choice ORDER BY sort_order) AS options,
    max(choice) FILTER (WHERE is_correct) AS correct_answer
  FROM public.question_choices
  WHERE language = 'en'
  GROUP BY question_id
),
mixed_choice_rows AS (
  SELECT
    question_id,
    array_agg(choice ORDER BY sort_order) AS bilingual_options,
    max(choice) FILTER (WHERE is_correct) AS bilingual_correct_answer
  FROM public.question_choices
  WHERE language = 'mixed'
  GROUP BY question_id
),
text_rows AS (
  SELECT
    question_id,
    max(question_stem) FILTER (WHERE language = 'en') AS source_question_stem,
    max(question_stem) FILTER (WHERE language = 'mixed') AS fetched_question_stem
  FROM public.question_texts
  GROUP BY question_id
),
en_explanation_rows AS (
  SELECT
    question_id,
    array_agg(public_url ORDER BY sort_order) FILTER (WHERE public_url IS NOT NULL) AS explain_imgs,
    min(explanation_image_file) AS source_explanation_image_file,
    min(public_url) AS source_explanation_image_url,
    max(explanation_html) FILTER (WHERE source = 'enriched') AS en_explanation_html
  FROM public.question_explanations
  WHERE language = 'en'
  GROUP BY question_id
),
zh_explanation_rows AS (
  SELECT
    question_id,
    COALESCE(
      max(explanation_html) FILTER (WHERE source = 'enriched'),
      max(explanation_html) FILTER (WHERE source = 'castudy')
    ) AS explanation_html,
    array_agg(public_url ORDER BY sort_order) FILTER (WHERE public_url IS NOT NULL) AS zh_explain_imgs
  FROM public.question_explanations
  WHERE language = 'zh'
  GROUP BY question_id
),
zh_text_rows AS (
  SELECT
    question_id,
    max(question_stem) FILTER (WHERE language = 'zh') AS zh_question_stem
  FROM public.question_texts
  GROUP BY question_id
),
zh_choice_rows AS (
  SELECT
    question_id,
    array_agg(choice ORDER BY sort_order) AS zh_options
  FROM public.question_choices
  WHERE language = 'zh'
  GROUP BY question_id
)
SELECT
  q.id,
  q."index",
  s.subject,
  ch.id AS chapter_id,
  ch.chapter AS topic,
  COALESCE(tr.source_question_stem, q.source_question, q.question) AS question_text,
  tr.fetched_question_stem,
  ztr.zh_question_stem,
  COALESCE(cr.options, '{}') AS options,
  COALESCE(mcr.bilingual_options, '{}') AS bilingual_options,
  COALESCE(zcr.zh_options, '{}') AS zh_options,
  cr.correct_answer,
  mcr.bilingual_correct_answer,
  q.correct_answer AS correct_answer_letter,
  COALESCE(q.api_match_ok, false) AS api_match_ok,
  q.api_match_score,
  q.api_qid,
  q.api_answer_key,
  COALESCE(er.explain_imgs, '{}') AS explain_imgs,
  er.source_explanation_image_file,
  er.source_explanation_image_url,
  er.en_explanation_html,
  zh.explanation_html,
  COALESCE(zh.zh_explain_imgs, '{}') AS zh_explain_imgs,
  q.micro_concept,
  q.trap_type,
  q.skill_tested,
  q.raw
FROM public.question_items q
JOIN public.chapters ch ON ch.id = q.chapter_id
JOIN public.subjects s ON s.id = ch.subject_id
LEFT JOIN choice_rows cr ON cr.question_id = q.id
LEFT JOIN mixed_choice_rows mcr ON mcr.question_id = q.id
LEFT JOIN text_rows tr ON tr.question_id = q.id
LEFT JOIN zh_text_rows ztr ON ztr.question_id = q.id
LEFT JOIN zh_choice_rows zcr ON zcr.question_id = q.id
LEFT JOIN en_explanation_rows er ON er.question_id = q.id
LEFT JOIN zh_explanation_rows zh ON zh.question_id = q.id;

-- ─────────────────────────────────────────────────────────────
-- question_reports
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.question_reports (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id   text        NOT NULL,
  user_id       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  category      text        NOT NULL DEFAULT 'other',
  -- 'wrong_answer' | 'typo' | 'unclear' | 'outdated' | 'other'
  message       text,
  resolved      boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_reports"
  ON public.question_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_select_reports"
  ON public.question_reports FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admins_update_reports"
  ON public.question_reports FOR UPDATE TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- practice_sessions
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.practice_sessions (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode           text        NOT NULL,  -- 'Test' | 'TopicStudy' | 'Practice' | etc.
  subject        text,
  chapter_ids    text[],
  total          integer,
  score          integer,
  duration_secs  integer,
  completed_at   timestamptz,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_sessions"
  ON public.practice_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_select_all_sessions"
  ON public.practice_sessions FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- practice_answers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.practice_answers (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id     uuid        NOT NULL REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id    text        NOT NULL,
  selected       text,
  is_correct     boolean,
  time_spent_ms  integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practice_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_answers"
  ON public.practice_answers FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_select_all_answers"
  ON public.practice_answers FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- user_question_progress
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.user_question_progress (
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id   text    NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  is_marked     boolean NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  PRIMARY KEY (user_id, question_id)
);

ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_progress"
  ON public.user_question_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- user_concept_mastery  (used in performance page)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.user_concept_mastery (
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concept       text    NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, concept)
);

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_concept_mastery"
  ON public.user_concept_mastery FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- feedback  (used in help page and HelpDialog)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.feedback (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  message    text        NOT NULL,
  category   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_feedback"
  ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_select_feedback"
  ON public.feedback FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- topic_study_progress  (formerly browse_progress)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.topic_study_progress (
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id           text        NOT NULL,
  viewed_count         integer     NOT NULL DEFAULT 0,
  last_question_id     text,
  last_question_index  integer     NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

ALTER TABLE public.topic_study_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own browse progress"
  ON public.topic_study_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- topic_study_question_states  (formerly browse_question_states)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.topic_study_question_states (
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id    text        NOT NULL,
  chapter_id     text,
  is_learned     boolean     NOT NULL DEFAULT false,
  is_marked      boolean     NOT NULL DEFAULT false,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

ALTER TABLE public.topic_study_question_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own topic study question states"
  ON public.topic_study_question_states FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Data migration: rename old Browse sessions to TopicStudy
-- ─────────────────────────────────────────────────────────────
UPDATE public.practice_sessions SET mode = 'TopicStudy' WHERE mode = 'Browse';

-- ─────────────────────────────────────────────────────────────
-- RPC functions
-- ─────────────────────────────────────────────────────────────

-- NOTE: RPC function bodies must match your actual implementation.
-- Signatures listed here for reference; fill in the body or replace with your
-- production-tested versions.

-- record_auth_event(user_id uuid, event text, metadata jsonb)
-- Called from AuthProvider.tsx on sign-in / sign-out events.
-- NOTE: RPC functions go here

-- get_question_choice_stats(p_question_id text)
-- Returns per-choice selection counts across all users for a given question.
-- Called from question-progress.ts.
-- NOTE: RPC functions go here

-- get_question_answer_stats(p_question_id text)
-- Returns aggregate correct/incorrect counts for a given question.
-- Called from question-progress.ts.
-- NOTE: RPC functions go here
