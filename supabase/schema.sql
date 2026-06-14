-- PassBar question bank schema.
-- Question content is imported from out/<subject>/<chapter> fetch results.
-- English source data is kept beside fetched Castudy/Tomato bilingual data so
-- the app can switch between English and Chinese without losing raw source rows.

create extension if not exists pgcrypto;

drop view if exists public.questions;
drop view if exists public.question_chapter_counts;
drop table if exists public.browse_question_states;
drop table if exists public.browse_progress;
drop table if exists public.browse_marks;
drop function if exists public.is_admin();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  study_settings jsonb not null default '{"contentMode":"english","textSize":"medium","interfaceLanguage":"en"}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));

alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists study_settings jsonb not null default '{"contentMode":"english","textSize":"medium","interfaceLanguage":"en"}'::jsonb;
alter table public.profiles add column if not exists exam_date date;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function private.is_admin() to anon, authenticated, service_role;

create table if not exists public.subjects (
  id text primary key,
  subject text not null unique,
  slug text not null unique,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists public.chapters (
  id text primary key,
  subject_id text not null references public.subjects(id) on delete cascade,
  source text,
  captured_at timestamptz,
  count int,
  screenshot_count int,
  url text,
  exam_name text,
  subject text not null,
  chapter text not null,
  slug text not null,
  raw_meta jsonb,
  sort_order int default 0,
  created_at timestamptz default now(),
  unique (subject_id, slug)
);

create table if not exists public.question_items (
  id text primary key,
  chapter_id text not null references public.chapters(id) on delete cascade,
  "index" int not null,
  question text not null,
  correct_answer text not null check (correct_answer ~ '^[A-D]$'),
  source_question text,
  source_choices jsonb,
  source_correct_answer text check (source_correct_answer is null or source_correct_answer ~ '^[A-D]$'),
  source_explanation_html text,
  api_qid text,
  api_answer_key text check (api_answer_key is null or api_answer_key ~ '^[A-D]$'),
  api_match_ok boolean,
  api_match_score numeric,
  api_url text,
  api_status int,
  topic             text,    -- fine-grained topic extracted from source explanation image
  micro_concept     text,
  trap_type         text,
  trap_type_is_new  boolean,
  skill_tested      text,
  keyword_meta      jsonb,   -- { question_keyword_meta, choice_keyword_meta }
  highlight_meta    jsonb,   -- { question_highlight_meta }
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chapter_id, "index")
);

alter table public.question_items add column if not exists source_question text;
alter table public.question_items add column if not exists source_choices jsonb;
alter table public.question_items add column if not exists source_correct_answer text;
alter table public.question_items add column if not exists source_explanation_html text;
alter table public.question_items add column if not exists api_qid text;
alter table public.question_items add column if not exists api_answer_key text;
alter table public.question_items add column if not exists api_match_ok boolean;
alter table public.question_items add column if not exists api_match_score numeric;
alter table public.question_items add column if not exists api_url text;
alter table public.question_items add column if not exists api_status int;

create table if not exists public.question_texts (
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null check (language in ('en', 'zh', 'mixed')),
  source text not null check (source in ('uworld', 'castudy', 'enriched')),
  question_stem text not null,
  raw jsonb,
  created_at timestamptz default now(),
  primary key (question_id, language, source)
);

create table if not exists public.question_choices (
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'zh', 'mixed')),
  source text not null default 'uworld' check (source in ('uworld', 'castudy', 'enriched')),
  choice_key text not null check (choice_key ~ '^[a-d]$'),
  choice text not null,
  sort_order int not null,
  is_correct boolean not null default false,
  raw jsonb,
  created_at timestamptz default now(),
  primary key (question_id, language, choice_key)
);

alter table public.question_choices add column if not exists language text not null default 'en';
alter table public.question_choices add column if not exists source text not null default 'uworld';
alter table public.question_choices add column if not exists raw jsonb;
-- allow 'zh' language and 'enriched' source (from enriched json zh-choices)
alter table public.question_choices
  drop constraint if exists question_choices_language_check;
alter table public.question_choices
  add constraint question_choices_language_check
  check (language in ('en', 'zh', 'mixed'));
alter table public.question_choices
  drop constraint if exists question_choices_source_check;
alter table public.question_choices
  add constraint question_choices_source_check
  check (source in ('uworld', 'castudy', 'enriched'));
-- same for question_texts
alter table public.question_texts
  drop constraint if exists question_texts_source_check;
alter table public.question_texts
  add constraint question_texts_source_check
  check (source in ('uworld', 'castudy', 'enriched'));

create table if not exists public.question_explanations (
  id bigserial primary key,
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null check (language in ('en', 'zh')),
  -- 'uworld'   = original source image/html from UWorld
  -- 'castudy'  = bilingual API html from CasStudy
  -- 'gemini'   = AI-generated analysis (question_ai_explanations)
  -- 'enriched' = processed final version from enriched JSON (authoritative)
  source text not null default 'uworld' check (source in ('uworld', 'castudy', 'gemini', 'enriched')),
  explanation_text text,
  explanation_html text,
  mime_type text,
  sort_order int default 0,
  raw jsonb,
  created_at timestamptz default now(),
  unique (question_id, language, source, sort_order)
);

alter table public.question_explanations add column if not exists source text not null default 'uworld';
-- allow 'gemini' as a valid source value
alter table public.question_explanations
  drop constraint if exists question_explanations_source_check;
alter table public.question_explanations
  add constraint question_explanations_source_check
  check (source in ('uworld', 'castudy', 'gemini', 'enriched'));

create table if not exists public.question_ai_explanations (
  id bigserial primary key,
  question_id text not null references public.question_items(id) on delete cascade,
  selected_choice text check (selected_choice is null or selected_choice ~ '^[A-D]$'),
  correct_choice text check (correct_choice is null or correct_choice ~ '^[A-D]$'),
  is_correct boolean not null default false,
  interface_language text not null default 'zh-Hant' check (interface_language in ('en', 'zh-Hans', 'zh-Hant')),
  prompt_version text not null default 'question-analysis-v2',
  source text not null default 'gemini',
  model text,
  analysis_markdown text not null,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (question_id, selected_choice, correct_choice, interface_language, prompt_version)
);

alter table public.question_ai_explanations add column if not exists selected_choice text;
alter table public.question_ai_explanations add column if not exists correct_choice text;
alter table public.question_ai_explanations add column if not exists is_correct boolean not null default false;
alter table public.question_ai_explanations add column if not exists interface_language text not null default 'zh-Hant';
alter table public.question_ai_explanations add column if not exists prompt_version text not null default 'question-analysis-v2';
alter table public.question_ai_explanations add column if not exists source text not null default 'gemini';
alter table public.question_ai_explanations add column if not exists model text;
alter table public.question_ai_explanations add column if not exists analysis_markdown text;
alter table public.question_ai_explanations add column if not exists raw jsonb;
alter table public.question_ai_explanations add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.question_ai_explanations'::regclass
      and conname = 'question_ai_explanations_lookup_key'
  ) then
    alter table public.question_ai_explanations
      add constraint question_ai_explanations_lookup_key
      unique (question_id, selected_choice, correct_choice, interface_language, prompt_version);
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.question_choices'::regclass
      and conname = 'question_choices_pkey'
  ) then
    alter table public.question_choices drop constraint question_choices_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.question_choices'::regclass
      and conname = 'question_choices_pkey'
  ) then
    alter table public.question_choices
      add constraint question_choices_pkey primary key (question_id, language, choice_key);
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.question_explanations'::regclass
      and conname = 'question_explanations_question_id_language_sort_order_key'
  ) then
    alter table public.question_explanations
      drop constraint question_explanations_question_id_language_sort_order_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.question_explanations'::regclass
      and conname = 'question_explanations_question_id_language_source_sort_order_key'
  ) then
    alter table public.question_explanations
      add constraint question_explanations_question_id_language_source_sort_order_key
      unique (question_id, language, source, sort_order);
  end if;
end $$;

create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  mode text,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'suspended')),
  subject_ids text[] default '{}',
  chapter_ids text[] default '{}',
  question_count int,
  started_at timestamptz default now(),
  completed_at timestamptz,
  total_time_seconds int default 0,
  answered_count int not null default 0,
  correct_count int not null default 0,
  user_agent text,
  raw jsonb
);
alter table public.practice_sessions add column if not exists user_agent text;

create table if not exists public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.practice_sessions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  question_id text not null references public.question_items(id) on delete cascade,
  selected_choice text not null check (selected_choice ~ '^[A-D]$'),
  correct_answer text not null check (correct_answer ~ '^[A-D]$'),
  is_correct boolean not null,
  is_marked boolean default false,
  time_spent_seconds int default 0,
  answered_at timestamptz default now(),
  raw jsonb,
  unique (session_id, question_id)
);

create or replace function private.refresh_practice_session_answer_summary(p_session_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
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

create or replace function private.refresh_practice_session_answer_summary_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists refresh_practice_session_answer_summary_after_answer_change on public.practice_answers;
create trigger refresh_practice_session_answer_summary_after_answer_change
after insert or update or delete on public.practice_answers
for each row execute function private.refresh_practice_session_answer_summary_trigger();

create table if not exists public.user_question_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null references public.question_items(id) on delete cascade,
  status text not null check (status in ('correct', 'incorrect', 'omitted')),
  selected_choice text check (selected_choice is null or selected_choice ~ '^[A-D]$'),
  correct_answer text check (correct_answer is null or correct_answer ~ '^[A-D]$'),
  is_correct boolean,
  is_marked boolean not null default false,
  times_answered int not null default 0,
  time_spent_seconds int not null default 0,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  last_answered_at timestamptz,
  raw jsonb,
  primary key (user_id, question_id)
);

alter table public.user_question_progress add column if not exists status text;
alter table public.user_question_progress add column if not exists selected_choice text;
alter table public.user_question_progress add column if not exists correct_answer text;
alter table public.user_question_progress add column if not exists is_correct boolean;
alter table public.user_question_progress add column if not exists is_marked boolean not null default false;
alter table public.user_question_progress add column if not exists times_answered int not null default 0;
alter table public.user_question_progress add column if not exists time_spent_seconds int not null default 0;
alter table public.user_question_progress add column if not exists first_seen_at timestamptz default now();
alter table public.user_question_progress add column if not exists last_seen_at timestamptz default now();
alter table public.user_question_progress add column if not exists last_answered_at timestamptz;
alter table public.user_question_progress add column if not exists raw jsonb;

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('session_checked', 'signed_in', 'signed_out', 'token_refreshed')),
  provider text,
  email text,
  session_expires_at timestamptz,
  user_agent text,
  path text,
  metadata jsonb,
  created_at timestamptz default now()
);

create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references public.question_items(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  category text not null default 'other',
  categories text[],
  language text,
  message text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.question_reports add column if not exists categories text[];
alter table public.question_reports add column if not exists language text;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  category text,
  subject text,
  qid text,
  ref_subject text,
  ref_chapter text,
  email text,
  message text not null,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.feedback add column if not exists subject text;
alter table public.feedback add column if not exists qid text;
alter table public.feedback add column if not exists ref_subject text;
alter table public.feedback add column if not exists ref_chapter text;
alter table public.feedback add column if not exists email text;
alter table public.feedback add column if not exists resolved boolean not null default false;
alter table public.feedback add column if not exists resolved_at timestamptz;

create table if not exists public.topic_study_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id text not null,
  viewed_count int not null default 0,
  last_question_id text,
  last_question_index int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create table if not exists public.topic_study_question_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  chapter_id text,
  is_learned boolean not null default false,
  is_marked boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index if not exists chapters_subject_id_idx on public.chapters (subject_id);
create index if not exists question_items_chapter_id_idx on public.question_items (chapter_id);
create index if not exists question_items_api_qid_idx on public.question_items (api_qid);
create index if not exists question_texts_question_id_idx on public.question_texts (question_id);
create index if not exists question_texts_language_idx on public.question_texts (language);
create index if not exists question_choices_question_id_idx on public.question_choices (question_id);
create index if not exists question_choices_language_idx on public.question_choices (language);
create index if not exists question_explanations_question_id_idx on public.question_explanations (question_id);
create index if not exists question_explanations_language_idx on public.question_explanations (language);
create index if not exists question_ai_explanations_question_id_idx on public.question_ai_explanations (question_id);
create index if not exists question_ai_explanations_lookup_idx on public.question_ai_explanations (question_id, selected_choice, correct_choice, interface_language, prompt_version);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_last_seen_at_idx on public.profiles (last_seen_at);
create index if not exists practice_sessions_user_id_idx on public.practice_sessions (user_id);
create index if not exists practice_answers_session_id_idx on public.practice_answers (session_id);
create index if not exists practice_answers_user_id_idx on public.practice_answers (user_id);
alter table public.practice_answers add column if not exists previous_is_correct boolean;
create index if not exists practice_answers_question_id_idx on public.practice_answers (question_id);
create index if not exists user_question_progress_user_id_idx on public.user_question_progress (user_id);
create index if not exists user_question_progress_question_id_idx on public.user_question_progress (question_id);
create index if not exists user_question_progress_status_idx on public.user_question_progress (status);
create index if not exists user_question_progress_is_marked_idx on public.user_question_progress (is_marked);
create index if not exists auth_events_user_id_idx on public.auth_events (user_id);
create index if not exists auth_events_event_type_idx on public.auth_events (event_type);
create index if not exists auth_events_created_at_idx on public.auth_events (created_at desc);
create index if not exists question_reports_question_id_idx on public.question_reports (question_id);
create index if not exists question_reports_user_id_idx on public.question_reports (user_id);
create index if not exists question_reports_resolved_idx on public.question_reports (resolved);
create index if not exists feedback_user_id_idx on public.feedback (user_id);
create index if not exists feedback_resolved_idx on public.feedback (resolved);
create index if not exists topic_study_progress_user_id_idx on public.topic_study_progress (user_id);
create index if not exists topic_study_question_states_user_id_idx on public.topic_study_question_states (user_id);
create index if not exists topic_study_question_states_chapter_id_idx on public.topic_study_question_states (chapter_id);

create or replace view public.question_chapter_counts as
select
  s.subject,
  ch.id as chapter_id,
  ch.chapter as chapter_name,
  count(q.id)::int as count
from public.chapters ch
join public.subjects s on s.id = ch.subject_id
left join public.question_items q on q.chapter_id = ch.id
group by s.subject, ch.id, ch.chapter;
alter view public.question_chapter_counts set (security_invoker = true);

-- Compatibility view for the current frontend. New code should prefer
-- subjects / chapters / question_items / question_choices / question_explanations.
drop view if exists public.questions;
create view public.questions as
with choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as options,
    max(choice) filter (where is_correct) as correct_answer
  from public.question_choices
  where language = 'en'
  group by question_id
),
mixed_choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as bilingual_options,
    max(choice) filter (where is_correct) as bilingual_correct_answer
  from public.question_choices
  where language = 'mixed'
  group by question_id
),
text_rows as (
  select
    question_id,
    max(question_stem) filter (where language = 'en') as source_question_stem,
    max(question_stem) filter (where language = 'mixed') as fetched_question_stem
  from public.question_texts
  group by question_id
),
en_explanation_rows as (
  select
    question_id,
    -- enriched-JSON English interactive HTML (source='enriched', language='en')
    max(explanation_html) filter (where source = 'enriched') as en_explanation_html
  from public.question_explanations
  where language = 'en'
  group by question_id
),
zh_explanation_rows as (
  select
    question_id,
    -- enriched JSON is the authoritative source; when imported it replaces any
    -- prior castudy record, so there is at most one zh explanation per question.
    -- coalesce order: enriched (final processed) → castudy (raw API) → fallback
    coalesce(
      max(explanation_html) filter (where source = 'enriched'),
      max(explanation_html) filter (where source = 'castudy')
    ) as explanation_html
  from public.question_explanations
  where language = 'zh'
  group by question_id
),
zh_text_rows as (
  select
    question_id,
    max(question_stem) filter (where language = 'zh') as zh_question_stem
  from public.question_texts
  group by question_id
),
zh_choice_rows as (
  select
    question_id,
    array_agg(choice order by sort_order) as zh_options
  from public.question_choices
  where language = 'zh'
  group by question_id
)
select
  q.id,
  q."index",
  s.subject,
  ch.id as chapter_id,
  ch.chapter as chapter_name,
  coalesce(tr.source_question_stem, q.source_question, q.question) as question_text,
  tr.fetched_question_stem,
  -- zh_question_stem: pure Chinese question (from enriched json zh-question)
  ztr.zh_question_stem,
  coalesce(cr.options, '{}') as options,
  coalesce(mcr.bilingual_options, '{}') as bilingual_options,
  -- zh_options: pure Chinese choices (from enriched json zh-choices)
  coalesce(zcr.zh_options, '{}') as zh_options,
  cr.correct_answer,
  mcr.bilingual_correct_answer,
  q.correct_answer as correct_answer_letter,
  coalesce(q.api_match_ok, false) as api_match_ok,
  q.api_match_score,
  q.api_qid,
  q.api_answer_key,
  -- en_explanation_html: gemini-generated English interactive HTML
  er.en_explanation_html,
  zh.explanation_html,
  -- new metadata columns
  q.topic as topic,
  q.micro_concept,
  q.trap_type,
  q.trap_type_is_new,
  q.skill_tested,
  q.keyword_meta,
  q.highlight_meta,
  q.raw
from public.question_items q
join public.chapters ch on ch.id = q.chapter_id
join public.subjects s on s.id = ch.subject_id
left join choice_rows cr on cr.question_id = q.id
left join mixed_choice_rows mcr on mcr.question_id = q.id
left join text_rows tr on tr.question_id = q.id
left join zh_text_rows ztr on ztr.question_id = q.id
left join zh_choice_rows zcr on zcr.question_id = q.id
left join en_explanation_rows er on er.question_id = q.id
left join zh_explanation_rows zh on zh.question_id = q.id;
alter view public.questions set (security_invoker = true);

alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.question_items enable row level security;
alter table public.question_texts enable row level security;
alter table public.question_choices enable row level security;
alter table public.question_explanations enable row level security;
alter table public.question_ai_explanations enable row level security;
alter table public.profiles enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;
alter table public.user_question_progress enable row level security;
alter table public.auth_events enable row level security;
alter table public.question_reports enable row level security;
alter table public.feedback enable row level security;
alter table public.topic_study_progress enable row level security;
alter table public.topic_study_question_states enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name, avatar_url, last_seen_at)
select
  users.id,
  users.email,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name'),
  users.raw_user_meta_data ->> 'avatar_url',
  now()
from auth.users
on conflict (id) do update set
  email = coalesce(excluded.email, public.profiles.email),
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
  updated_at = now();

create or replace function public.record_auth_event(
  p_event_type text,
  p_provider text default null,
  p_email text default null,
  p_session_expires_at timestamptz default null,
  p_user_agent text default null,
  p_path text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
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

revoke all on function public.record_auth_event(text, text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_auth_event(text, text, text, timestamptz, text, text, jsonb) to authenticated;

create or replace function public.get_question_answer_stats(p_question_id text)
returns table (
  total_answers bigint,
  correct_answers bigint,
  correct_percent int
)
language sql
stable
security invoker
set search_path = public
as $$
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

revoke all on function public.get_question_answer_stats(text) from public, anon, authenticated;
grant execute on function public.get_question_answer_stats(text) to authenticated;

create or replace function public.get_question_choice_stats(p_question_id text)
returns table (
  selected_choice text,
  answer_count bigint,
  answer_percent int
)
language sql
stable
security invoker
set search_path = public
as $$
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

revoke all on function public.get_question_choice_stats(text) from public, anon, authenticated;
grant execute on function public.get_question_choice_stats(text) to authenticated;

drop policy if exists "Allow public read access to subjects" on public.subjects;
create policy "Allow public read access to subjects"
on public.subjects for select using (true);

drop policy if exists "Allow public read access to chapters" on public.chapters;
create policy "Allow public read access to chapters"
on public.chapters for select using (true);

drop policy if exists "Admins can update question metadata" on public.question_items;
create policy "Admins can update question metadata"
on public.question_items for update
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "Allow public read access to question items" on public.question_items;
create policy "Allow public read access to question items"
on public.question_items for select using (true);

drop policy if exists "Allow public read access to question texts" on public.question_texts;
create policy "Allow public read access to question texts"
on public.question_texts for select using (true);

drop policy if exists "Allow public read access to question choices" on public.question_choices;
create policy "Allow public read access to question choices"
on public.question_choices for select using (true);

drop policy if exists "Allow public read access to question explanations" on public.question_explanations;
create policy "Allow public read access to question explanations"
on public.question_explanations for select using (true);

drop policy if exists "Allow public read access to question AI explanations" on public.question_ai_explanations;
create policy "Allow public read access to question AI explanations"
on public.question_ai_explanations for select using (true);

drop policy if exists "Authenticated users can insert question AI explanations" on public.question_ai_explanations;
create policy "Authenticated users can insert question AI explanations"
on public.question_ai_explanations for insert
with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update question AI explanations" on public.question_ai_explanations;
create policy "Authenticated users can update question AI explanations"
on public.question_ai_explanations for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert their profile" on public.profiles;
create policy "Users can insert their profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "users_update_own_last_seen" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read their auth events" on public.auth_events;
create policy "Users can read their auth events"
on public.auth_events for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their auth events" on public.auth_events;
create policy "Users can insert their auth events"
on public.auth_events for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can read their practice sessions" on public.practice_sessions;
create policy "Users can read their practice sessions"
on public.practice_sessions for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their practice sessions" on public.practice_sessions;
create policy "Users can insert their practice sessions"
on public.practice_sessions for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their practice sessions" on public.practice_sessions;
create policy "Users can update their practice sessions"
on public.practice_sessions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their practice sessions" on public.practice_sessions;
create policy "Users can delete their practice sessions"
on public.practice_sessions for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their practice answers" on public.practice_answers;
create policy "Users can read their practice answers"
on public.practice_answers for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their practice answers" on public.practice_answers;
create policy "Users can insert their practice answers"
on public.practice_answers for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their practice answers" on public.practice_answers;
create policy "Users can update their practice answers"
on public.practice_answers for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their practice answers" on public.practice_answers;
create policy "Users can delete their practice answers"
on public.practice_answers for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their question progress" on public.user_question_progress;
create policy "Users can read their question progress"
on public.user_question_progress for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their question progress" on public.user_question_progress;
create policy "Users can insert their question progress"
on public.user_question_progress for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their question progress" on public.user_question_progress;
create policy "Users can update their question progress"
on public.user_question_progress for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their question progress" on public.user_question_progress;
create policy "Users can delete their question progress"
on public.user_question_progress for delete
using (auth.uid() = user_id);

drop policy if exists "users_insert_own_reports" on public.question_reports;
create policy "users_insert_own_reports"
on public.question_reports for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "admins_select_reports" on public.question_reports;
create policy "admins_select_reports"
on public.question_reports for select to authenticated
using (private.is_admin());

drop policy if exists "admins_update_reports" on public.question_reports;
create policy "admins_update_reports"
on public.question_reports for update to authenticated
using (private.is_admin());

drop policy if exists "users_insert_own_feedback" on public.feedback;
create policy "users_insert_own_feedback"
on public.feedback for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "admins_select_feedback" on public.feedback;
create policy "admins_select_feedback"
on public.feedback for select to authenticated
using (private.is_admin());

drop policy if exists "admins_update_feedback" on public.feedback;
create policy "admins_update_feedback"
on public.feedback for update to authenticated
using (private.is_admin());

drop policy if exists "Users can manage their own browse progress" on public.topic_study_progress;
create policy "Users can manage their own browse progress"
on public.topic_study_progress for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own topic study question states" on public.topic_study_question_states;
create policy "Users can manage their own topic study question states"
on public.topic_study_question_states for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- question_items enrichment for AI coaching
alter table public.question_items add column if not exists micro_concept text;
alter table public.question_items add column if not exists trap_type text;
alter table public.question_items add column if not exists skill_tested text;
alter table public.question_items add column if not exists difficulty text check (difficulty is null or difficulty in ('easy','medium','hard'));

-- question_items: topic from source explanation image footer
alter table public.question_items add column if not exists topic text;

-- question_items: extended AI meta (trap_type_is_new, keyword_meta, highlight_meta)
alter table public.question_items add column if not exists trap_type_is_new boolean;
alter table public.question_items add column if not exists keyword_meta   jsonb;
alter table public.question_items add column if not exists highlight_meta jsonb;

-- practice_answers enrichment
alter table public.practice_answers add column if not exists confidence text check (confidence is null or confidence in ('low','medium','high'));
alter table public.practice_answers add column if not exists changed_answer boolean default false;
alter table public.practice_answers add column if not exists error_type text;

-- User concept mastery tracking
create table if not exists public.user_concept_mastery (
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  topic text not null,
  micro_concept text not null,
  attempts int not null default 0,
  correct int not null default 0,
  last_attempt_at timestamptz,
  status text not null default 'under-sampled' check (status in ('under-sampled','struggling','repairing','stabilizing','mastered','decaying')),
  updated_at timestamptz default now(),
  primary key (user_id, subject, topic, micro_concept)
);
create index if not exists user_concept_mastery_user_id_idx on public.user_concept_mastery (user_id);
alter table public.user_concept_mastery enable row level security;
drop policy if exists "Users can manage their concept mastery" on public.user_concept_mastery;
create policy "Users can manage their concept mastery"
on public.user_concept_mastery for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Admin RLS: admins can read all profiles and update status/role
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles for select
using (auth.uid() = id or private.is_admin());

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
on public.profiles for update
using (private.is_admin())
with check (private.is_admin());

-- Seed: set me@wayneclub.com as admin + approved
update public.profiles
set role = 'admin', status = 'approved'
where email = 'me@wayneclub.com';

-- Dev seed: mock user for local testing (NEXT_PUBLIC_USE_MOCK_AUTH=true)
-- Must bypass FK by inserting into auth.users first
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, aud, role
)
values (
  '00000000-0000-0000-0000-000000000001',
  'mock@example.com',
  '',
  now(),
  '{"name": "Mock User", "full_name": "Mock User"}'::jsonb,
  now(), now(), 'authenticated', 'authenticated'
)
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, status, last_seen_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'mock@example.com',
  'Mock User',
  'admin',
  'approved',
  now()
)
on conflict (id) do update set
  role = 'admin',
  status = 'approved',
  updated_at = now();
