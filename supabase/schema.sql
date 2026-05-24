-- PassBar question bank schema.
-- Field names intentionally follow the source JSON:
-- meta: source, capturedAt, count, screenshotCount, url, examName, subject, chapter
-- questions[]: index, question, choices, correctAnswer, explanationImageFile

create extension if not exists pgcrypto;

drop view if exists public.questions;
drop view if exists public.question_chapter_counts;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chapter_id, "index")
);

create table if not exists public.question_choices (
  question_id text not null references public.question_items(id) on delete cascade,
  choice_key text not null check (choice_key ~ '^[a-d]$'),
  choice text not null,
  sort_order int not null,
  is_correct boolean not null default false,
  created_at timestamptz default now(),
  primary key (question_id, choice_key)
);

create table if not exists public.question_explanations (
  id bigserial primary key,
  question_id text not null references public.question_items(id) on delete cascade,
  language text not null check (language in ('en', 'zh')),
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
  unique (question_id, language, sort_order)
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

create index if not exists chapters_subject_id_idx on public.chapters (subject_id);
create index if not exists question_items_chapter_id_idx on public.question_items (chapter_id);
create index if not exists question_choices_question_id_idx on public.question_choices (question_id);
create index if not exists question_explanations_question_id_idx on public.question_explanations (question_id);
create index if not exists question_explanations_language_idx on public.question_explanations (language);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists practice_sessions_user_id_idx on public.practice_sessions (user_id);
create index if not exists practice_answers_session_id_idx on public.practice_answers (session_id);
create index if not exists practice_answers_user_id_idx on public.practice_answers (user_id);
create index if not exists practice_answers_question_id_idx on public.practice_answers (question_id);

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
    max(explanation_html) as explanation_html
  from public.question_explanations
  where language = 'zh'
  group by question_id
)
select
  q.id,
  s.subject,
  ch.id as chapter_id,
  ch.chapter as topic,
  q.question as question_text,
  coalesce(cr.options, '{}') as options,
  cr.correct_answer,
  q.correct_answer as correct_answer_letter,
  false as api_match_ok,
  coalesce(er.explain_imgs, '{}') as explain_imgs,
  er.source_explanation_image_file,
  er.source_explanation_image_url,
  zh.explanation_html,
  q.raw
from public.question_items q
join public.chapters ch on ch.id = q.chapter_id
join public.subjects s on s.id = ch.subject_id
left join choice_rows cr on cr.question_id = q.id
left join en_explanation_rows er on er.question_id = q.id
left join zh_explanation_rows zh on zh.question_id = q.id;

alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.question_items enable row level security;
alter table public.question_choices enable row level security;
alter table public.question_explanations enable row level security;
alter table public.profiles enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop policy if exists "Allow public read access to subjects" on public.subjects;
create policy "Allow public read access to subjects"
on public.subjects for select using (true);

drop policy if exists "Allow public read access to chapters" on public.chapters;
create policy "Allow public read access to chapters"
on public.chapters for select using (true);

drop policy if exists "Allow public read access to question items" on public.question_items;
create policy "Allow public read access to question items"
on public.question_items for select using (true);

drop policy if exists "Allow public read access to question choices" on public.question_choices;
create policy "Allow public read access to question choices"
on public.question_choices for select using (true);

drop policy if exists "Allow public read access to question explanations" on public.question_explanations;
create policy "Allow public read access to question explanations"
on public.question_explanations for select using (true);

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

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
