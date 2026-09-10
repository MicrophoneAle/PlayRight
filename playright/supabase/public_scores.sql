-- Public curated scores (readable by anyone; is_public is not client-writable).
-- Run in Supabase SQL Editor after scores_rls.sql and manual_fingerings.sql.
--
-- is_public: when true, SELECT is allowed for anon + authenticated via
-- scores_select_public. Clients cannot set/change is_public (see
-- scores_preserve_is_public in scores_rls.sql). Publish/unpublish out-of-band:
--   update public.scores set is_public = true where id = '...';
-- Owner UPDATE of other columns (e.g. manual_fingerings) remains allowed;
-- owner DELETE of public rows is blocked (private deletes only).

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
