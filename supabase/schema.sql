-- PassBar question bank schema.
-- Question content is imported from out/<subject>/<chapter> fetch results.
-- English source data is kept beside fetched Castudy/Tomato bilingual data so
-- the app can switch between English and Chinese without losing raw source rows.

create extension if not exists pgcrypto;

drop view if exists public.questions;
drop view if exists public.question_chapter_counts;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'admin')),
  study_settings jsonb not null default '{"contentMode":"english","textSize":"medium","interfaceLanguage":"en"}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists study_settings jsonb not null default '{"contentMode":"english","textSize":"medium","interfaceLanguage":"en"}'::jsonb;

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
  explanation_image_file text,
  source_question text,
  source_choices jsonb,
  source_correct_answer text check (source_correct_answer is null or source_correct_answer ~ '^[A-D]$'),
  source_explanation_html text,
  source_explanation_image_file text,
  api_qid text,
  api_answer_key text check (api_answer_key is null or api_answer_key ~ '^[A-D]$'),
  api_match_ok boolean,
  api_match_score numeric,
  api_url text,
  api_status int,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chapter_id, "index")
);

alter table public.question_items add column if not exists source_question text;
alter table public.question_items add column if not exists source_choices jsonb;
alter table public.question_items add column if not exists source_correct_answer text;
alter table public.question_items add column if not exists source_explanation_html text;
alter table public.question_items add column if not exists source_explanation_image_file text;
alter table public.question_items add column if not exists api_qid text;
alter table public.question_items add column if not exists api_answer_key text;
alter table public.question_items add column if not exists api_match_ok boolean;
alter table public.question_items add column if not exists api_match_score numeric;
alter table public.question_items add column if not exists api_url text;
alter table public.question_items add column if not exists api_status int;

create table if not exists public.question_texts (
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null check (language in ('en', 'zh', 'mixed')),
  source text not null check (source in ('uworld', 'castudy')),
  question_stem text not null,
  raw jsonb,
  created_at timestamptz default now(),
  primary key (question_id, language, source)
);

create table if not exists public.question_choices (
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'zh', 'mixed')),
  source text not null default 'uworld' check (source in ('uworld', 'castudy')),
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

create table if not exists public.question_explanations (
  id bigserial primary key,
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null check (language in ('en', 'zh')),
  source text not null default 'uworld' check (source in ('uworld', 'castudy')),
  explanation_text text,
  explanation_html text,
  explanation_image_file text,
  storage_bucket text,
  storage_path text,
  public_url text,
  mime_type text,
  sort_order int default 0,
  raw jsonb,
  created_at timestamptz default now(),
  unique (question_id, language, source, sort_order)
);

alter table public.question_explanations add column if not exists source text not null default 'uworld';

create table if not exists public.question_explanation_ocr (
  id bigserial primary key,
  question_id text not null references public.question_items(id) on delete cascade,
  explanation_id bigint references public.question_explanations(id) on delete cascade,
  storage_bucket text,
  storage_path text,
  public_url text not null,
  language text not null default 'eng',
  engine text not null default 'tesseract.js',
  image_width int,
  image_height int,
  text text,
  words jsonb not null default '[]'::jsonb,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (public_url, language)
);

alter table public.question_explanation_ocr add column if not exists explanation_id bigint;
alter table public.question_explanation_ocr add column if not exists storage_bucket text;
alter table public.question_explanation_ocr add column if not exists storage_path text;
alter table public.question_explanation_ocr add column if not exists image_width int;
alter table public.question_explanation_ocr add column if not exists image_height int;
alter table public.question_explanation_ocr add column if not exists text text;
alter table public.question_explanation_ocr add column if not exists words jsonb not null default '[]'::jsonb;
alter table public.question_explanation_ocr add column if not exists raw jsonb;
alter table public.question_explanation_ocr add column if not exists updated_at timestamptz default now();

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
  answered_at timestamptz default now(),
  raw jsonb,
  unique (session_id, question_id)
);

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

create index if not exists chapters_subject_id_idx on public.chapters (subject_id);
create index if not exists question_items_chapter_id_idx on public.question_items (chapter_id);
create index if not exists question_items_api_qid_idx on public.question_items (api_qid);
create index if not exists question_texts_question_id_idx on public.question_texts (question_id);
create index if not exists question_texts_language_idx on public.question_texts (language);
create index if not exists question_choices_question_id_idx on public.question_choices (question_id);
create index if not exists question_choices_language_idx on public.question_choices (language);
create index if not exists question_explanations_question_id_idx on public.question_explanations (question_id);
create index if not exists question_explanations_language_idx on public.question_explanations (language);
create index if not exists question_explanation_ocr_question_id_idx on public.question_explanation_ocr (question_id);
create index if not exists question_explanation_ocr_public_url_idx on public.question_explanation_ocr (public_url);
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

create or replace view public.question_chapter_counts as
select
  s.subject,
  ch.id as chapter_id,
  ch.chapter as topic,
  count(q.id)::int as count
from public.chapters ch
join public.subjects s on s.id = ch.subject_id
left join public.question_items q on q.chapter_id = ch.id
group by s.subject, ch.id, ch.chapter;

-- Compatibility view for the current frontend. New code should prefer
-- subjects / chapters / question_items / question_choices / question_explanations.
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
    array_agg(public_url order by sort_order) filter (where public_url is not null) as explain_imgs,
    min(explanation_image_file) as source_explanation_image_file,
    min(public_url) as source_explanation_image_url
  from public.question_explanations
  where language = 'en'
  group by question_id
),
zh_explanation_rows as (
  select
    question_id,
    max(explanation_html) as explanation_html,
    array_agg(public_url order by sort_order) filter (where public_url is not null) as zh_explain_imgs
  from public.question_explanations
  where language = 'zh'
  group by question_id
)
select
  q.id,
  s.subject,
  ch.id as chapter_id,
  ch.chapter as topic,
  coalesce(tr.source_question_stem, q.source_question, q.question) as question_text,
  tr.fetched_question_stem,
  coalesce(cr.options, '{}') as options,
  coalesce(mcr.bilingual_options, '{}') as bilingual_options,
  cr.correct_answer,
  mcr.bilingual_correct_answer,
  q.correct_answer as correct_answer_letter,
  coalesce(q.api_match_ok, false) as api_match_ok,
  q.api_match_score,
  q.api_qid,
  q.api_answer_key,
  coalesce(er.explain_imgs, '{}') as explain_imgs,
  er.source_explanation_image_file,
  er.source_explanation_image_url,
  zh.explanation_html,
  coalesce(zh.zh_explain_imgs, '{}') as zh_explain_imgs,
  q.raw
from public.question_items q
join public.chapters ch on ch.id = q.chapter_id
join public.subjects s on s.id = ch.subject_id
left join choice_rows cr on cr.question_id = q.id
left join mixed_choice_rows mcr on mcr.question_id = q.id
left join text_rows tr on tr.question_id = q.id
left join en_explanation_rows er on er.question_id = q.id
left join zh_explanation_rows zh on zh.question_id = q.id;

alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.question_items enable row level security;
alter table public.question_texts enable row level security;
alter table public.question_choices enable row level security;
alter table public.question_explanations enable row level security;
alter table public.question_explanation_ocr enable row level security;
alter table public.question_ai_explanations enable row level security;
alter table public.profiles enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;
alter table public.user_question_progress enable row level security;
alter table public.auth_events enable row level security;

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
security definer set search_path = public
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

grant execute on function public.record_auth_event(text, text, text, timestamptz, text, text, jsonb) to authenticated;

create or replace function public.get_question_answer_stats(p_question_id text)
returns table (
  total_answers bigint,
  correct_answers bigint,
  correct_percent int
)
language sql
stable
security definer set search_path = public
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

grant execute on function public.get_question_answer_stats(text) to authenticated;

create or replace function public.get_question_choice_stats(p_question_id text)
returns table (
  selected_choice text,
  answer_count bigint,
  answer_percent int
)
language sql
stable
security definer set search_path = public
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

grant execute on function public.get_question_choice_stats(text) to authenticated;

drop policy if exists "Allow public read access to subjects" on public.subjects;
create policy "Allow public read access to subjects"
on public.subjects for select using (true);

drop policy if exists "Allow public read access to chapters" on public.chapters;
create policy "Allow public read access to chapters"
on public.chapters for select using (true);

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

drop policy if exists "Allow public read access to question explanation OCR" on public.question_explanation_ocr;
create policy "Allow public read access to question explanation OCR"
on public.question_explanation_ocr for select using (true);

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
