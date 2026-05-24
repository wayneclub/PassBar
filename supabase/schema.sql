create table if not exists public.questions (
  id text primary key,
  subject text not null,
  chapter_id text not null,
  topic text not null,
  question_text text not null,
  options text[] not null,
  correct_answer text not null,
  api_match_ok boolean default true,
  explain_imgs text[] default '{}',
  source_explanation_image_file text,
  explanation_html text,
  raw jsonb,
  created_at timestamptz default now()
);

create index if not exists questions_subject_idx on public.questions (subject);
create index if not exists questions_chapter_id_idx on public.questions (chapter_id);

create or replace view public.question_chapter_counts as
select
  subject,
  chapter_id,
  topic,
  count(*)::int as count
from public.questions
group by subject, chapter_id, topic;

alter table public.questions enable row level security;

drop policy if exists "Allow public read access to questions" on public.questions;
create policy "Allow public read access to questions"
on public.questions
for select
using (true);
