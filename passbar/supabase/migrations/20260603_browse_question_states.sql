create table public.topic_study_question_states (
  user_id      uuid not null references auth.users(id) on delete cascade,
  question_id  text not null,
  chapter_id   text,
  is_learned   boolean not null default false,
  is_marked    boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);
alter table public.topic_study_question_states enable row level security;
create policy "Users can manage their own topic study question states"
  on public.topic_study_question_states for all
  using (auth.uid() = user_id);

drop table if exists public.browse_marks;
