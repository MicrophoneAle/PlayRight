-- Manual fingering overrides per saved score (Clerk user via scores RLS).
-- Run in Supabase SQL Editor after scores_rls.sql.
--
-- manual_fingerings: JSON object keyed by "stepIndex:hand:midi" → finger 1–5
-- Example: { "0:R:60": 3, "12:L:48": 2 }

alter table public.scores
  add column if not exists manual_fingerings jsonb not null default '{}'::jsonb;
