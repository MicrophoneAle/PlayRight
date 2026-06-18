-- Run in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Safe to re-run: drops existing policies before recreating them.

alter table public.scores enable row level security;

drop policy if exists "scores_select_anon" on public.scores;
create policy "scores_select_anon"
  on public.scores
  for select
  to anon
  using (true);

drop policy if exists "scores_insert_anon" on public.scores;
create policy "scores_insert_anon"
  on public.scores
  for insert
  to anon
  with check (true);

drop policy if exists "scores_delete_anon" on public.scores;
create policy "scores_delete_anon"
  on public.scores
  for delete
  to anon
  using (true);

-- If delete still fails for signed-in users using the authenticated role, also add:
drop policy if exists "scores_delete_authenticated" on public.scores;
create policy "scores_delete_authenticated"
  on public.scores
  for delete
  to authenticated
  using (true);

drop policy if exists "scores_select_authenticated" on public.scores;
create policy "scores_select_authenticated"
  on public.scores
  for select
  to authenticated
  using (true);

drop policy if exists "scores_insert_authenticated" on public.scores;
create policy "scores_insert_authenticated"
  on public.scores
  for insert
  to authenticated
  with check (true);
