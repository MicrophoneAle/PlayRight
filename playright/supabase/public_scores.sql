-- Public curated scores (readable by anyone, writable only by the owner).
-- Run in Supabase SQL Editor after scores_rls.sql and manual_fingerings.sql.
--
-- is_public: when true, SELECT is allowed for anon + authenticated via
-- scores_select_public. INSERT/UPDATE/DELETE remain owner-only.

alter table public.scores
  add column if not exists is_public boolean not null default false;

create index if not exists scores_is_public_created_at_idx
  on public.scores (is_public, created_at desc)
  where is_public = true;

-- Drop legacy overly-permissive anon policies if present.
drop policy if exists "Allow anon read" on public.scores;
drop policy if exists "Allow anon insert" on public.scores;
drop policy if exists "scores_select_anon" on public.scores;
drop policy if exists "scores_insert_anon" on public.scores;
drop policy if exists "scores_delete_anon" on public.scores;
drop policy if exists "scores_select_authenticated" on public.scores;
drop policy if exists "scores_insert_authenticated" on public.scores;
drop policy if exists "scores_delete_authenticated" on public.scores;
drop policy if exists "scores_select_public" on public.scores;

create policy "scores_select_public"
  on public.scores
  for select
  to anon, authenticated
  using (is_public = true);
