-- PassBar question bank schema — plain PostgreSQL version (no Supabase Auth/RLS).
-- Access control (who can read/write what) is enforced in the application layer
-- (NextAuth session + API routes), not via Postgres RLS.
--
-- Run 00_create_database.sql first (connected to the default "postgres" db),
-- then connect to "passbar" and run this file.

create extension if not exists pgcrypto;

-- Auth.js (NextAuth) standard tables — replaces Supabase Auth (auth.users etc.).
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  "emailVerified" timestamptz,
  image text
);

create table if not exists public.accounts (
  id bigserial primary key,
  "userId" uuid not null references public.users(id) on delete cascade,
  type text not null,
  provider text not null,
  "providerAccountId" text not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  unique (provider, "providerAccountId")
);

create table if not exists public.sessions (
  id bigserial primary key,
  "userId" uuid not null references public.users(id) on delete cascade,
  expires timestamptz not null,
  "sessionToken" text not null unique
);

create table if not exists public.verification_token (
  identifier text not null,
  expires timestamptz not null,
  token text not null,
  primary key (identifier, token)
);

-- profiles holds PassBar-specific user data, one-to-one with users (id shared).
create table if not exists public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  email text unique,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  study_settings jsonb not null default '{"contentMode":"english","textSize":"medium","interfaceLanguage":"en"}'::jsonb,
  exam_date date,
  last_seen_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create a profiles row whenever Auth.js inserts a new user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.name, new.image)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on public.users;
create trigger on_auth_user_created
after insert on public.users
for each row execute function public.handle_new_auth_user();

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
  topic text,
  micro_concept text,
  trap_type text,
  trap_type_is_new boolean,
  skill_tested text,
  difficulty text check (difficulty is null or difficulty in ('easy','medium','hard')),
  keyword_meta jsonb,
  highlight_meta jsonb,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chapter_id, "index")
);

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
  confidence text check (confidence is null or confidence in ('low','medium','high')),
  changed_answer boolean default false,
  error_type text,
  previous_is_correct boolean,
  answered_at timestamptz default now(),
  raw jsonb,
  unique (session_id, question_id)
);

create or replace function public.refresh_practice_session_answer_summary(p_session_id uuid)
returns void
language sql
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

create or replace function public.refresh_practice_session_answer_summary_trigger()
returns trigger
language plpgsql
as $$
declare
  target_session_id uuid;
begin
  target_session_id := coalesce(new.session_id, old.session_id);
  if target_session_id is not null then
    perform public.refresh_practice_session_answer_summary(target_session_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_practice_session_answer_summary_after_answer_change on public.practice_answers;
create trigger refresh_practice_session_answer_summary_after_answer_change
after insert or update or delete on public.practice_answers
for each row execute function public.refresh_practice_session_answer_summary_trigger();

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

create table if not exists public.topic_study_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  chapter_id text not null,
  viewed_count int not null default 0,
  last_question_id text,
  last_question_index int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create table if not exists public.topic_study_question_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null,
  chapter_id text,
  is_learned boolean not null default false,
  is_marked boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

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

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status text not null default 'new' check (status in ('new', 'scheduled', 'in_progress', 'completed')),
  type text not null default 'manual' check (type in ('manual', 'review', 'practice')),
  due_date date,
  chapter_id text,
  chapter_ids text,
  auto_generated boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null,
  unlocked_at timestamptz default now() not null,
  unique (user_id, badge_key)
);

-- Indexes
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
create index if not exists user_concept_mastery_user_id_idx on public.user_concept_mastery (user_id);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index if not exists todos_user_id_idx on public.todos (user_id);

-- Compatibility views for the current frontend.
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

create or replace view public.questions as
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
    max(explanation_html) filter (where source = 'enriched') as en_explanation_html
  from public.question_explanations
  where language = 'en'
  group by question_id
),
zh_explanation_rows as (
  select
    question_id,
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
  ztr.zh_question_stem,
  coalesce(cr.options, '{}') as options,
  coalesce(mcr.bilingual_options, '{}') as bilingual_options,
  coalesce(zcr.zh_options, '{}') as zh_options,
  cr.correct_answer,
  mcr.bilingual_correct_answer,
  q.correct_answer as correct_answer_letter,
  coalesce(q.api_match_ok, false) as api_match_ok,
  q.api_match_score,
  q.api_qid,
  q.api_answer_key,
  er.en_explanation_html,
  zh.explanation_html,
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

-- Stats helper functions (no role grants needed — app connects as a single DB user).
create or replace function public.get_question_answer_stats(p_question_id text)
returns table (
  total_answers bigint,
  correct_answers bigint,
  correct_percent int
)
language sql
stable
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

create or replace function public.get_question_choice_stats(p_question_id text)
returns table (
  selected_choice text,
  answer_count bigint,
  answer_percent int
)
language sql
stable
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

-- Seed: set me@wayneclub.com as admin + approved (created on first login via app).
update public.profiles
set role = 'admin', status = 'approved'
where email = 'me@wayneclub.com';

-- Dev seed: mock user for local testing (NEXT_PUBLIC_USE_MOCK_AUTH=true).
insert into public.users (id, email, name)
values ('00000000-0000-0000-0000-000000000001', 'mock@example.com', 'Mock User')
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
