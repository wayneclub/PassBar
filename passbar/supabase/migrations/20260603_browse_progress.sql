-- Browse progress: tracks per-user, per-chapter reading progress for Chapter Browse mode.
-- This is separate from practice_sessions to avoid polluting test scoring data.

create table if not exists browse_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id text not null,
  viewed_count integer not null default 0,
  last_question_id text,
  last_question_index integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

alter table browse_progress enable row level security;

create policy "Users can manage their own browse progress"
  on browse_progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Delete all old Browse mode sessions from practice_sessions to clean up historical data.
delete from practice_sessions where mode = 'Browse';
