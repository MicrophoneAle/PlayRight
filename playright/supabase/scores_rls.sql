-- Run in the Supabase SQL Editor if imports work locally but the Songs panel
-- stays empty on production (or console shows RLS / permission errors).

alter table public.scores enable row level security;

create policy "scores_select_anon"
  on public.scores
  for select
  to anon
  using (true);

create policy "scores_insert_anon"
  on public.scores
  for insert
  to anon
  with check (true);

create policy "scores_delete_anon"
  on public.scores
  for delete
  to anon
  using (true);
