-- Browse-mode question marks (independent from test-mode user_question_progress.is_marked)
create table if not exists public.browse_marks (
  user_id    uuid  not null references auth.users(id) on delete cascade,
  question_id text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.browse_marks enable row level security;

create policy "Users can manage their own browse marks"
  on public.browse_marks for all
  using (auth.uid() = user_id);
