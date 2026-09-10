-- Per-user score library (Clerk user id in user_id column).
--
-- Prerequisites:
-- 1. Supabase Dashboard → Authentication → Third-party auth → add Clerk
--    https://supabase.com/docs/guides/auth/third-party/clerk
-- 2. Run this script in the SQL Editor.
--
-- Publishing: clients cannot set or change is_public. Curate the public library
-- out-of-band (SQL Editor as postgres / table owner, or the service_role key).
-- Example: update public.scores set is_public = true where id = '...';

alter table public.scores enable row level security;

alter table public.scores add column if not exists user_id text;

create index if not exists scores_user_id_created_at_idx
  on public.scores (user_id, created_at desc);

-- Remove shared-library / legacy anon policies
drop policy if exists "Allow anon read" on public.scores;
drop policy if exists "Allow anon insert" on public.scores;
drop policy if exists "scores_select_anon" on public.scores;
drop policy if exists "scores_insert_anon" on public.scores;
drop policy if exists "scores_delete_anon" on public.scores;
drop policy if exists "scores_select_authenticated" on public.scores;
drop policy if exists "scores_insert_authenticated" on public.scores;
drop policy if exists "scores_delete_authenticated" on public.scores;
drop policy if exists "scores_select_public" on public.scores;
drop policy if exists "scores_select_own" on public.scores;
drop policy if exists "scores_insert_own" on public.scores;
drop policy if exists "scores_delete_own" on public.scores;
drop policy if exists "scores_update_own" on public.scores;

-- Public curated scores are readable by anyone (see also public_scores.sql)
alter table public.scores
  add column if not exists is_public boolean not null default false;

-- Pin is_public for PostgREST client roles. A trigger (not only RLS WITH CHECK)
-- so a later policy cannot re-open client self-publish. SQL Editor / service_role
-- still curate via UPDATE ... SET is_public = true|false.
create or replace function public.scores_preserve_is_public()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.is_public is distinct from false then
      raise exception 'is_public cannot be set by clients'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.is_public is distinct from old.is_public then
      raise exception 'is_public cannot be changed by clients'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scores_preserve_is_public on public.scores;
create trigger scores_preserve_is_public
  before insert or update on public.scores
  for each row
  execute function public.scores_preserve_is_public();

create policy "scores_select_public"
  on public.scores
  for select
  to anon, authenticated
  using (is_public = true);

-- Clerk JWT "sub" claim must match user_id (Clerk user id, e.g. user_...)
create policy "scores_select_own"
  on public.scores
  for select
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id);

-- Inserts are always private; is_public is also blocked by the trigger above.
create policy "scores_insert_own"
  on public.scores
  for insert
  to authenticated
  with check (
    (auth.jwt() ->> 'sub') = user_id
    and is_public = false
  );

-- Owners may update their rows (e.g. manual_fingerings). is_public changes are
-- rejected by scores_preserve_is_public even if a future policy forgets to pin it.
create policy "scores_update_own"
  on public.scores
  for update
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

-- Clients may delete private scores only; curated public rows stay until
-- unpublished/removed out-of-band (matches the app UI, which hides delete).
create policy "scores_delete_own"
  on public.scores
  for delete
  to authenticated
  using (
    (auth.jwt() ->> 'sub') = user_id
    and is_public = false
  );
