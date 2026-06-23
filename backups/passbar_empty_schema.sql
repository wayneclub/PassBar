-- PassBar empty PostgreSQL schema generated from a Supabase schema snapshot.
-- Supabase platform schemas and all existing rows are intentionally excluded.
\set ON_ERROR_STOP on
BEGIN;
-- Minimal Supabase compatibility objects for restoring PassBar's public schema
-- into a standard PostgreSQL container running on AWS.
--
-- This does not install Supabase Auth or PostgREST. It only preserves the
-- database contracts used by foreign keys, functions, grants, and RLS policies.

create extension if not exists pgcrypto;

do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$bootstrap$;

alter role service_role bypassrls;

create schema if not exists auth;
create schema if not exists private;

-- Only identity fields used by PassBar are copied. Password hashes and OAuth
-- provider tokens intentionally remain in Supabase Auth during phase one.
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $function$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$function$;

create or replace function auth.role()
returns text
language sql
stable
as $function$
  select coalesce(
    auth.jwt() ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
$function$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: is_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


--
-- Name: refresh_practice_session_answer_summary(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_practice_session_answer_summary(p_session_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.practice_sessions s
  set
    answered_count = coalesce(stats.answered_count, 0),
    correct_count = coalesce(stats.correct_count, 0)
  from (
    select
      p_session_id as session_id,
      count(*)::int as answered_count,
      count(*) filter (where is_correct)::int as correct_count
    from public.practice_answers
    where session_id = p_session_id
  ) stats
  where s.id = stats.session_id;
$$;


--
-- Name: refresh_practice_session_answer_summary_trigger(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_practice_session_answer_summary_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_session_id uuid;
begin
  target_session_id := coalesce(new.session_id, old.session_id);
  if target_session_id is not null then
    perform private.refresh_practice_session_answer_summary(target_session_id);
  end if;
  return coalesce(new, old);
end;
$$;


--
-- Name: get_question_answer_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_question_answer_stats(p_question_id text) RETURNS TABLE(total_answers bigint, correct_answers bigint, correct_percent integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    count(*) as total_answers,
    count(*) filter (where is_correct) as correct_answers,
    case
      when count(*) = 0 then null
      else round((count(*) filter (where is_correct))::numeric * 100 / count(*))::int
    end as correct_percent
  from public.practice_answers
  where question_id = p_question_id;
$$;


--
-- Name: get_question_choice_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_question_choice_stats(p_question_id text) RETURNS TABLE(selected_choice text, answer_count bigint, answer_percent integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with choices(choice) as (
    values ('A'), ('B'), ('C'), ('D')
  ),
  totals as (
    select count(*)::numeric as total_answers
    from public.practice_answers
    where question_id = p_question_id
  ),
  counts as (
    select selected_choice, count(*) as answer_count
    from public.practice_answers
    where question_id = p_question_id
    group by selected_choice
  )
  select
    choices.choice as selected_choice,
    coalesce(counts.answer_count, 0) as answer_count,
    case
      when totals.total_answers = 0 then 0
      else round(coalesce(counts.answer_count, 0)::numeric * 100 / totals.total_answers)::int
    end as answer_percent
  from choices
  cross join totals
  left join counts on counts.selected_choice = choices.choice
  order by choices.choice;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, last_seen_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    last_seen_at = now(),
    updated_at = now();

  return new;
end;
$$;


--
-- Name: record_auth_event(text, text, text, timestamp with time zone, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_auth_event(p_event_type text, p_provider text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_session_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_agent text DEFAULT NULL::text, p_path text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_event_type not in ('session_checked', 'signed_in', 'signed_out', 'token_refreshed') then
    raise exception 'Invalid auth event type: %', p_event_type;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, last_seen_at)
  values (
    current_user_id,
    coalesce(p_email, auth.jwt() ->> 'email'),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name'),
    auth.jwt() -> 'user_metadata' ->> 'avatar_url',
    now()
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    last_seen_at = case
      when p_event_type = 'signed_out' then public.profiles.last_seen_at
      else now()
    end,
    updated_at = now();

  insert into public.auth_events (
    user_id,
    event_type,
    provider,
    email,
    session_expires_at,
    user_agent,
    path,
    metadata
  )
  values (
    current_user_id,
    p_event_type,
    p_provider,
    coalesce(p_email, auth.jwt() ->> 'email'),
    p_session_expires_at,
    p_user_agent,
    p_path,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;


--
-- Name: auth_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    provider text,
    email text,
    session_expires_at timestamp with time zone,
    user_agent text,
    path text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT auth_events_event_type_check CHECK ((event_type = ANY (ARRAY['session_checked'::text, 'signed_in'::text, 'signed_out'::text, 'token_refreshed'::text])))
);


--
-- Name: chapters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chapters (
    id text NOT NULL,
    subject_id text NOT NULL,
    source text,
    captured_at timestamp with time zone,
    count integer,
    screenshot_count integer,
    url text,
    exam_name text,
    subject text NOT NULL,
    chapter text NOT NULL,
    slug text NOT NULL,
    raw_meta jsonb,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    category text,
    subject text,
    qid text,
    ref_subject text,
    ref_chapter text,
    email text,
    message text NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: practice_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    user_id uuid,
    question_id text NOT NULL,
    selected_choice text NOT NULL,
    correct_answer text NOT NULL,
    is_correct boolean NOT NULL,
    is_marked boolean DEFAULT false,
    time_spent_seconds integer DEFAULT 0,
    answered_at timestamp with time zone DEFAULT now(),
    raw jsonb,
    previous_is_correct boolean,
    confidence text,
    changed_answer boolean DEFAULT false,
    error_type text,
    CONSTRAINT practice_answers_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))),
    CONSTRAINT practice_answers_correct_answer_check CHECK ((correct_answer ~ '^[A-D]$'::text)),
    CONSTRAINT practice_answers_selected_choice_check CHECK ((selected_choice ~ '^[A-D]$'::text))
);


--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    mode text,
    status text DEFAULT 'in_progress'::text NOT NULL,
    subject_ids text[] DEFAULT '{}'::text[],
    chapter_ids text[] DEFAULT '{}'::text[],
    question_count integer,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    total_time_seconds integer DEFAULT 0,
    raw jsonb,
    user_agent text,
    answered_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT practice_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'suspended'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    avatar_url text,
    role text DEFAULT 'student'::text NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    study_settings jsonb DEFAULT '{"textSize": "medium", "contentMode": "english", "interfaceLanguage": "en"}'::jsonb NOT NULL,
    exam_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['student'::text, 'admin'::text]))),
    CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: question_ai_explanations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_ai_explanations (
    id bigint NOT NULL,
    question_id text NOT NULL,
    selected_choice text,
    correct_choice text,
    is_correct boolean DEFAULT false NOT NULL,
    interface_language text DEFAULT 'zh-Hant'::text NOT NULL,
    prompt_version text DEFAULT 'question-analysis-v2'::text NOT NULL,
    source text DEFAULT 'gemini'::text NOT NULL,
    model text,
    analysis_markdown text NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT question_ai_explanations_correct_choice_check CHECK (((correct_choice IS NULL) OR (correct_choice ~ '^[A-D]$'::text))),
    CONSTRAINT question_ai_explanations_interface_language_check CHECK ((interface_language = ANY (ARRAY['en'::text, 'zh-Hans'::text, 'zh-Hant'::text]))),
    CONSTRAINT question_ai_explanations_selected_choice_check CHECK (((selected_choice IS NULL) OR (selected_choice ~ '^[A-D]$'::text)))
);


--
-- Name: question_ai_explanations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_ai_explanations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_ai_explanations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_ai_explanations_id_seq OWNED BY public.question_ai_explanations.id;


--
-- Name: question_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_items (
    id text NOT NULL,
    chapter_id text NOT NULL,
    index integer NOT NULL,
    question text NOT NULL,
    correct_answer text NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_question text,
    source_choices jsonb,
    source_correct_answer text,
    source_explanation_html text,
    api_qid text,
    api_answer_key text,
    api_match_ok boolean,
    api_match_score numeric,
    api_url text,
    api_status integer,
    micro_concept text,
    trap_type text,
    skill_tested text,
    difficulty text,
    trap_type_is_new boolean,
    keyword_meta jsonb,
    highlight_meta jsonb,
    topic text,
    CONSTRAINT question_items_correct_answer_check CHECK ((correct_answer ~ '^[A-D]$'::text)),
    CONSTRAINT question_items_difficulty_check CHECK (((difficulty IS NULL) OR (difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))))
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id text NOT NULL,
    subject text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: question_chapter_counts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.question_chapter_counts WITH (security_invoker='true') AS
 SELECT s.subject,
    ch.id AS chapter_id,
    ch.chapter AS chapter_name,
    (count(q.id))::integer AS count
   FROM ((public.chapters ch
     JOIN public.subjects s ON ((s.id = ch.subject_id)))
     LEFT JOIN public.question_items q ON ((q.chapter_id = ch.id)))
  GROUP BY s.subject, ch.id, ch.chapter;


--
-- Name: question_choices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_choices (
    question_id text NOT NULL,
    choice_key text NOT NULL,
    choice text NOT NULL,
    sort_order integer NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    language text DEFAULT 'en'::text NOT NULL,
    source text DEFAULT 'uworld'::text NOT NULL,
    raw jsonb,
    CONSTRAINT question_choices_choice_key_check CHECK ((choice_key ~ '^[a-d]$'::text)),
    CONSTRAINT question_choices_language_check CHECK ((language = ANY (ARRAY['en'::text, 'zh'::text, 'mixed'::text]))),
    CONSTRAINT question_choices_source_check CHECK ((source = ANY (ARRAY['uworld'::text, 'castudy'::text, 'enriched'::text])))
);


--
-- Name: question_explanations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_explanations (
    id bigint NOT NULL,
    question_id text NOT NULL,
    language text NOT NULL,
    explanation_text text,
    explanation_html text,
    mime_type text,
    sort_order integer DEFAULT 0,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now(),
    source text DEFAULT 'uworld'::text NOT NULL,
    CONSTRAINT question_explanations_language_check CHECK ((language = ANY (ARRAY['en'::text, 'zh'::text]))),
    CONSTRAINT question_explanations_source_check CHECK ((source = ANY (ARRAY['uworld'::text, 'castudy'::text, 'gemini'::text, 'enriched'::text])))
);


--
-- Name: question_explanations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_explanations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_explanations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_explanations_id_seq OWNED BY public.question_explanations.id;


--
-- Name: question_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id text NOT NULL,
    user_id uuid,
    category text DEFAULT 'other'::text NOT NULL,
    message text,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    categories text[],
    language text
);


--
-- Name: question_texts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_texts (
    question_id text NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    question_stem text NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT question_texts_language_check CHECK ((language = ANY (ARRAY['en'::text, 'zh'::text, 'mixed'::text]))),
    CONSTRAINT question_texts_source_check CHECK ((source = ANY (ARRAY['uworld'::text, 'castudy'::text, 'enriched'::text])))
);


--
-- Name: questions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.questions WITH (security_invoker='true') AS
 WITH choice_rows AS (
         SELECT question_choices.question_id,
            array_agg(question_choices.choice ORDER BY question_choices.sort_order) AS options,
            max(question_choices.choice) FILTER (WHERE question_choices.is_correct) AS correct_answer
           FROM public.question_choices
          WHERE (question_choices.language = 'en'::text)
          GROUP BY question_choices.question_id
        ), mixed_choice_rows AS (
         SELECT question_choices.question_id,
            array_agg(question_choices.choice ORDER BY question_choices.sort_order) AS bilingual_options,
            max(question_choices.choice) FILTER (WHERE question_choices.is_correct) AS bilingual_correct_answer
           FROM public.question_choices
          WHERE (question_choices.language = 'mixed'::text)
          GROUP BY question_choices.question_id
        ), text_rows AS (
         SELECT question_texts.question_id,
            max(question_texts.question_stem) FILTER (WHERE (question_texts.language = 'en'::text)) AS source_question_stem,
            max(question_texts.question_stem) FILTER (WHERE (question_texts.language = 'mixed'::text)) AS fetched_question_stem
           FROM public.question_texts
          GROUP BY question_texts.question_id
        ), en_explanation_rows AS (
         SELECT question_explanations.question_id,
            max(question_explanations.explanation_html) FILTER (WHERE (question_explanations.source = 'enriched'::text)) AS en_explanation_html
           FROM public.question_explanations
          WHERE (question_explanations.language = 'en'::text)
          GROUP BY question_explanations.question_id
        ), zh_explanation_rows AS (
         SELECT question_explanations.question_id,
            COALESCE(max(question_explanations.explanation_html) FILTER (WHERE (question_explanations.source = 'enriched'::text)), max(question_explanations.explanation_html) FILTER (WHERE (question_explanations.source = 'castudy'::text))) AS explanation_html
           FROM public.question_explanations
          WHERE (question_explanations.language = 'zh'::text)
          GROUP BY question_explanations.question_id
        ), zh_text_rows AS (
         SELECT question_texts.question_id,
            max(question_texts.question_stem) FILTER (WHERE (question_texts.language = 'zh'::text)) AS zh_question_stem
           FROM public.question_texts
          GROUP BY question_texts.question_id
        ), zh_choice_rows AS (
         SELECT question_choices.question_id,
            array_agg(question_choices.choice ORDER BY question_choices.sort_order) AS zh_options
           FROM public.question_choices
          WHERE (question_choices.language = 'zh'::text)
          GROUP BY question_choices.question_id
        )
 SELECT q.id,
    q.index,
    s.subject,
    ch.id AS chapter_id,
    ch.chapter AS chapter_name,
    COALESCE(tr.source_question_stem, q.source_question, q.question) AS question_text,
    tr.fetched_question_stem,
    ztr.zh_question_stem,
    COALESCE(cr.options, '{}'::text[]) AS options,
    COALESCE(mcr.bilingual_options, '{}'::text[]) AS bilingual_options,
    COALESCE(zcr.zh_options, '{}'::text[]) AS zh_options,
    cr.correct_answer,
    mcr.bilingual_correct_answer,
    q.correct_answer AS correct_answer_letter,
    COALESCE(q.api_match_ok, false) AS api_match_ok,
    q.api_match_score,
    q.api_qid,
    q.api_answer_key,
    er.en_explanation_html,
    zh.explanation_html,
    q.topic,
    q.micro_concept,
    q.trap_type,
    q.trap_type_is_new,
    q.skill_tested,
    q.keyword_meta,
    q.highlight_meta,
    q.raw
   FROM (((((((((public.question_items q
     JOIN public.chapters ch ON ((ch.id = q.chapter_id)))
     JOIN public.subjects s ON ((s.id = ch.subject_id)))
     LEFT JOIN choice_rows cr ON ((cr.question_id = q.id)))
     LEFT JOIN mixed_choice_rows mcr ON ((mcr.question_id = q.id)))
     LEFT JOIN text_rows tr ON ((tr.question_id = q.id)))
     LEFT JOIN zh_text_rows ztr ON ((ztr.question_id = q.id)))
     LEFT JOIN zh_choice_rows zcr ON ((zcr.question_id = q.id)))
     LEFT JOIN en_explanation_rows er ON ((er.question_id = q.id)))
     LEFT JOIN zh_explanation_rows zh ON ((zh.question_id = q.id)));


--
-- Name: todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    type text DEFAULT 'manual'::text NOT NULL,
    due_date date,
    chapter_id text,
    chapter_ids text,
    auto_generated boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: topic_study_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_study_progress (
    user_id uuid NOT NULL,
    chapter_id text NOT NULL,
    viewed_count integer DEFAULT 0 NOT NULL,
    last_question_id text,
    last_question_index integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topic_study_question_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_study_question_states (
    user_id uuid NOT NULL,
    question_id text NOT NULL,
    chapter_id text,
    is_learned boolean DEFAULT false NOT NULL,
    is_marked boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_concept_mastery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_concept_mastery (
    user_id uuid NOT NULL,
    subject text NOT NULL,
    topic text NOT NULL,
    micro_concept text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    correct integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    status text DEFAULT 'under-sampled'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_concept_mastery_status_check CHECK ((status = ANY (ARRAY['under-sampled'::text, 'struggling'::text, 'repairing'::text, 'stabilizing'::text, 'mastered'::text, 'decaying'::text])))
);


--
-- Name: user_question_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_question_progress (
    user_id uuid NOT NULL,
    question_id text NOT NULL,
    status text NOT NULL,
    selected_choice text,
    correct_answer text,
    is_correct boolean,
    is_marked boolean DEFAULT false NOT NULL,
    times_answered integer DEFAULT 0 NOT NULL,
    time_spent_seconds integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    last_answered_at timestamp with time zone,
    raw jsonb,
    CONSTRAINT user_question_progress_correct_answer_check CHECK (((correct_answer IS NULL) OR (correct_answer ~ '^[A-D]$'::text))),
    CONSTRAINT user_question_progress_selected_choice_check CHECK (((selected_choice IS NULL) OR (selected_choice ~ '^[A-D]$'::text))),
    CONSTRAINT user_question_progress_status_check CHECK ((status = ANY (ARRAY['correct'::text, 'incorrect'::text, 'omitted'::text])))
);


--
-- Name: question_ai_explanations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_ai_explanations ALTER COLUMN id SET DEFAULT nextval('public.question_ai_explanations_id_seq'::regclass);


--
-- Name: question_explanations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_explanations ALTER COLUMN id SET DEFAULT nextval('public.question_explanations_id_seq'::regclass);


--
-- Name: auth_events auth_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_events
    ADD CONSTRAINT auth_events_pkey PRIMARY KEY (id);


--
-- Name: topic_study_progress browse_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_study_progress
    ADD CONSTRAINT browse_progress_pkey PRIMARY KEY (user_id, chapter_id);


--
-- Name: chapters chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);


--
-- Name: chapters chapters_subject_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_subject_id_slug_key UNIQUE (subject_id, slug);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: practice_answers practice_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_answers
    ADD CONSTRAINT practice_answers_pkey PRIMARY KEY (id);


--
-- Name: practice_answers practice_answers_session_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_answers
    ADD CONSTRAINT practice_answers_session_id_question_id_key UNIQUE (session_id, question_id);


--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: question_ai_explanations question_ai_explanations_lookup_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_ai_explanations
    ADD CONSTRAINT question_ai_explanations_lookup_key UNIQUE (question_id, selected_choice, correct_choice, interface_language, prompt_version);


--
-- Name: question_ai_explanations question_ai_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_ai_explanations
    ADD CONSTRAINT question_ai_explanations_pkey PRIMARY KEY (id);


--
-- Name: question_ai_explanations question_ai_explanations_question_id_selected_choice_correc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_ai_explanations
    ADD CONSTRAINT question_ai_explanations_question_id_selected_choice_correc_key UNIQUE (question_id, selected_choice, correct_choice, interface_language, prompt_version);


--
-- Name: question_choices question_choices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_choices
    ADD CONSTRAINT question_choices_pkey PRIMARY KEY (question_id, language, choice_key);


--
-- Name: question_explanations question_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_explanations
    ADD CONSTRAINT question_explanations_pkey PRIMARY KEY (id);


--
-- Name: question_explanations question_explanations_question_id_language_source_sort_order_ke; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_explanations
    ADD CONSTRAINT question_explanations_question_id_language_source_sort_order_ke UNIQUE (question_id, language, source, sort_order);


--
-- Name: question_items question_items_chapter_id_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_items
    ADD CONSTRAINT question_items_chapter_id_index_key UNIQUE (chapter_id, index);


--
-- Name: question_items question_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_items
    ADD CONSTRAINT question_items_pkey PRIMARY KEY (id);


--
-- Name: question_reports question_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_reports
    ADD CONSTRAINT question_reports_pkey PRIMARY KEY (id);


--
-- Name: question_texts question_texts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_texts
    ADD CONSTRAINT question_texts_pkey PRIMARY KEY (question_id, language, source);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_slug_key UNIQUE (slug);


--
-- Name: subjects subjects_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_subject_key UNIQUE (subject);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: topic_study_question_states topic_study_question_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_study_question_states
    ADD CONSTRAINT topic_study_question_states_pkey PRIMARY KEY (user_id, question_id);


--
-- Name: user_concept_mastery user_concept_mastery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_concept_mastery
    ADD CONSTRAINT user_concept_mastery_pkey PRIMARY KEY (user_id, subject, topic, micro_concept);


--
-- Name: user_question_progress user_question_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_question_progress
    ADD CONSTRAINT user_question_progress_pkey PRIMARY KEY (user_id, question_id);


--
-- Name: auth_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_events_created_at_idx ON public.auth_events USING btree (created_at DESC);


--
-- Name: auth_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_events_event_type_idx ON public.auth_events USING btree (event_type);


--
-- Name: auth_events_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_events_user_id_idx ON public.auth_events USING btree (user_id);


--
-- Name: chapters_subject_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chapters_subject_id_idx ON public.chapters USING btree (subject_id);


--
-- Name: feedback_resolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_resolved_idx ON public.feedback USING btree (resolved);


--
-- Name: feedback_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_user_id_idx ON public.feedback USING btree (user_id);


--
-- Name: practice_answers_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_answers_question_id_idx ON public.practice_answers USING btree (question_id);


--
-- Name: practice_answers_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_answers_session_id_idx ON public.practice_answers USING btree (session_id);


--
-- Name: practice_answers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_answers_user_id_idx ON public.practice_answers USING btree (user_id);


--
-- Name: practice_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_sessions_user_id_idx ON public.practice_sessions USING btree (user_id);


--
-- Name: profiles_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_email_idx ON public.profiles USING btree (email);


--
-- Name: profiles_last_seen_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_last_seen_at_idx ON public.profiles USING btree (last_seen_at);


--
-- Name: question_ai_explanations_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_ai_explanations_lookup_idx ON public.question_ai_explanations USING btree (question_id, selected_choice, correct_choice, interface_language, prompt_version);


--
-- Name: question_ai_explanations_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_ai_explanations_question_id_idx ON public.question_ai_explanations USING btree (question_id);


--
-- Name: question_choices_language_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_choices_language_idx ON public.question_choices USING btree (language);


--
-- Name: question_choices_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_choices_question_id_idx ON public.question_choices USING btree (question_id);


--
-- Name: question_explanations_language_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_explanations_language_idx ON public.question_explanations USING btree (language);


--
-- Name: question_explanations_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_explanations_question_id_idx ON public.question_explanations USING btree (question_id);


--
-- Name: question_items_api_qid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_items_api_qid_idx ON public.question_items USING btree (api_qid);


--
-- Name: question_items_chapter_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_items_chapter_id_idx ON public.question_items USING btree (chapter_id);


--
-- Name: question_items_highlight_meta_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_items_highlight_meta_gin ON public.question_items USING gin (highlight_meta);


--
-- Name: question_items_keyword_meta_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_items_keyword_meta_gin ON public.question_items USING gin (keyword_meta);


--
-- Name: question_reports_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_reports_question_id_idx ON public.question_reports USING btree (question_id);


--
-- Name: question_reports_resolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_reports_resolved_idx ON public.question_reports USING btree (resolved);


--
-- Name: question_reports_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_reports_user_id_idx ON public.question_reports USING btree (user_id);


--
-- Name: question_texts_language_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_texts_language_idx ON public.question_texts USING btree (language);


--
-- Name: question_texts_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_texts_question_id_idx ON public.question_texts USING btree (question_id);


--
-- Name: todos_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX todos_user_id_idx ON public.todos USING btree (user_id);


--
-- Name: topic_study_progress_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topic_study_progress_user_id_idx ON public.topic_study_progress USING btree (user_id);


--
-- Name: topic_study_question_states_chapter_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topic_study_question_states_chapter_id_idx ON public.topic_study_question_states USING btree (chapter_id);


--
-- Name: topic_study_question_states_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topic_study_question_states_user_id_idx ON public.topic_study_question_states USING btree (user_id);


--
-- Name: user_concept_mastery_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_concept_mastery_user_id_idx ON public.user_concept_mastery USING btree (user_id);


--
-- Name: user_question_progress_is_marked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_question_progress_is_marked_idx ON public.user_question_progress USING btree (is_marked);


--
-- Name: user_question_progress_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_question_progress_question_id_idx ON public.user_question_progress USING btree (question_id);


--
-- Name: user_question_progress_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_question_progress_status_idx ON public.user_question_progress USING btree (status);


--
-- Name: user_question_progress_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_question_progress_user_id_idx ON public.user_question_progress USING btree (user_id);


--
-- Name: practice_answers refresh_practice_session_answer_summary_after_answer_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER refresh_practice_session_answer_summary_after_answer_change AFTER INSERT OR DELETE OR UPDATE ON public.practice_answers FOR EACH ROW EXECUTE FUNCTION private.refresh_practice_session_answer_summary_trigger();


--
-- Name: auth_events auth_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_events
    ADD CONSTRAINT auth_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: topic_study_progress browse_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_study_progress
    ADD CONSTRAINT browse_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chapters chapters_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: practice_answers practice_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_answers
    ADD CONSTRAINT practice_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: practice_answers practice_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_answers
    ADD CONSTRAINT practice_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: practice_answers practice_answers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_answers
    ADD CONSTRAINT practice_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: question_ai_explanations question_ai_explanations_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_ai_explanations
    ADD CONSTRAINT question_ai_explanations_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: question_choices question_choices_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_choices
    ADD CONSTRAINT question_choices_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: question_explanations question_explanations_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_explanations
    ADD CONSTRAINT question_explanations_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: question_items question_items_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_items
    ADD CONSTRAINT question_items_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE CASCADE;


--
-- Name: question_reports question_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_reports
    ADD CONSTRAINT question_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: question_texts question_texts_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_texts
    ADD CONSTRAINT question_texts_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: todos todos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: topic_study_question_states topic_study_question_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_study_question_states
    ADD CONSTRAINT topic_study_question_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_concept_mastery user_concept_mastery_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_concept_mastery
    ADD CONSTRAINT user_concept_mastery_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_question_progress user_question_progress_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_question_progress
    ADD CONSTRAINT user_question_progress_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_items(id) ON DELETE CASCADE;


--
-- Name: user_question_progress user_question_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_question_progress
    ADD CONSTRAINT user_question_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles Admins can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT USING (((auth.uid() = id) OR private.is_admin()));


--
-- Name: profiles Admins can update any profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE USING (private.is_admin()) WITH CHECK (private.is_admin());


--
-- Name: question_items Admins can update question metadata; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update question metadata" ON public.question_items FOR UPDATE USING (private.is_admin()) WITH CHECK (private.is_admin());


--
-- Name: chapters Allow public read access to chapters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to chapters" ON public.chapters FOR SELECT USING (true);


--
-- Name: question_ai_explanations Allow public read access to question AI explanations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to question AI explanations" ON public.question_ai_explanations FOR SELECT USING (true);


--
-- Name: question_choices Allow public read access to question choices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to question choices" ON public.question_choices FOR SELECT USING (true);


--
-- Name: question_explanations Allow public read access to question explanations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to question explanations" ON public.question_explanations FOR SELECT USING (true);


--
-- Name: question_items Allow public read access to question items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to question items" ON public.question_items FOR SELECT USING (true);


--
-- Name: question_texts Allow public read access to question texts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to question texts" ON public.question_texts FOR SELECT USING (true);


--
-- Name: subjects Allow public read access to subjects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to subjects" ON public.subjects FOR SELECT USING (true);


--
-- Name: question_ai_explanations Authenticated users can insert question AI explanations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert question AI explanations" ON public.question_ai_explanations FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: question_ai_explanations Authenticated users can update question AI explanations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update question AI explanations" ON public.question_ai_explanations FOR UPDATE USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: push_subscriptions Users can delete their own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own push subscriptions" ON public.push_subscriptions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: practice_answers Users can delete their practice answers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their practice answers" ON public.practice_answers FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: practice_sessions Users can delete their practice sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their practice sessions" ON public.practice_sessions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_question_progress Users can delete their question progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their question progress" ON public.user_question_progress FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: auth_events Users can insert their auth events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their auth events" ON public.auth_events FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_subscriptions Users can insert their own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own push subscriptions" ON public.push_subscriptions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: practice_answers Users can insert their practice answers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their practice answers" ON public.practice_answers FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: practice_sessions Users can insert their practice sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their practice sessions" ON public.practice_sessions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can insert their profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: user_question_progress Users can insert their question progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their question progress" ON public.user_question_progress FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_concept_mastery Users can manage their concept mastery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their concept mastery" ON public.user_concept_mastery USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: topic_study_progress Users can manage their own browse progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own browse progress" ON public.topic_study_progress USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: topic_study_question_states Users can manage their own topic study question states; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own topic study question states" ON public.topic_study_question_states USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: auth_events Users can read their auth events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their auth events" ON public.auth_events FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: practice_answers Users can read their practice answers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their practice answers" ON public.practice_answers FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: practice_sessions Users can read their practice sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their practice sessions" ON public.practice_sessions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can read their profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: user_question_progress Users can read their question progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their question progress" ON public.user_question_progress FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: push_subscriptions Users can update their own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own push subscriptions" ON public.push_subscriptions FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: practice_answers Users can update their practice answers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their practice answers" ON public.practice_answers FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: practice_sessions Users can update their practice sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their practice sessions" ON public.practice_sessions FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can update their profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: user_question_progress Users can update their question progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their question progress" ON public.user_question_progress FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_subscriptions Users can view their own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own push subscriptions" ON public.push_subscriptions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: todos Users manage their own todos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage their own todos" ON public.todos USING ((auth.uid() = user_id));


--
-- Name: feedback admins_select_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_select_feedback ON public.feedback FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: question_reports admins_select_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_select_reports ON public.question_reports FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: feedback admins_update_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_update_feedback ON public.feedback FOR UPDATE TO authenticated USING (private.is_admin());


--
-- Name: question_reports admins_update_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_update_reports ON public.question_reports FOR UPDATE TO authenticated USING (private.is_admin());


--
-- Name: auth_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

--
-- Name: chapters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: question_ai_explanations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_ai_explanations ENABLE ROW LEVEL SECURITY;

--
-- Name: question_choices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_choices ENABLE ROW LEVEL SECURITY;

--
-- Name: question_explanations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_explanations ENABLE ROW LEVEL SECURITY;

--
-- Name: question_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_items ENABLE ROW LEVEL SECURITY;

--
-- Name: question_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: question_texts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: todos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

--
-- Name: topic_study_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.topic_study_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: topic_study_question_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.topic_study_question_states ENABLE ROW LEVEL SECURITY;

--
-- Name: user_concept_mastery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;

--
-- Name: user_question_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback users_insert_own_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_feedback ON public.feedback FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: question_reports users_insert_own_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_reports ON public.question_reports FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--

-- Recreate the table privileges normally managed by the Supabase platform.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

COMMIT;
