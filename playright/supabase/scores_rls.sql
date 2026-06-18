-- Per-user score library (Clerk user id in user_id column).
--
-- Prerequisites:
-- 1. Supabase Dashboard → Authentication → Third-party auth → add Clerk
--    https://supabase.com/docs/guides/auth/third-party/clerk
-- 2. Run this script in the SQL Editor.

alter table public.scores enable row level security;

alter table public.scores add column if not exists user_id text;

create index if not exists scores_user_id_created_at_idx
  on public.scores (user_id, created_at desc);

-- Remove shared-library policies
drop policy if exists "scores_select_anon" on public.scores;
drop policy if exists "scores_insert_anon" on public.scores;
drop policy if exists "scores_delete_anon" on public.scores;
drop policy if exists "scores_select_authenticated" on public.scores;
drop policy if exists "scores_insert_authenticated" on public.scores;
drop policy if exists "scores_delete_authenticated" on public.scores;
drop policy if exists "scores_select_own" on public.scores;
drop policy if exists "scores_insert_own" on public.scores;
drop policy if exists "scores_delete_own" on public.scores;
drop policy if exists "scores_update_own" on public.scores;

-- Clerk JWT "sub" claim must match user_id (Clerk user id, e.g. user_...)
create policy "scores_select_own"
  on public.scores
  for select
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "scores_insert_own"
  on public.scores
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "scores_update_own"
  on public.scores
  for update
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "scores_delete_own"
  on public.scores
  for delete
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id);
