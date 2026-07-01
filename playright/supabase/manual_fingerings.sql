-- Manual fingering overrides per saved score (Clerk user via scores RLS).
-- Run in Supabase SQL Editor after scores_rls.sql.
--
-- manual_fingerings: JSON object keyed by "onset:notatedHand:midi"
-- Values: finger 1–5, or { "finger": 1–5, "physicalHand": "L"|"R" } for cross-hand assignments.
-- Example: { "0:R:60": 3, "480:L:48": { "finger": 2, "physicalHand": "R" } }

alter table public.scores
  add column if not exists manual_fingerings jsonb not null default '{}'::jsonb;
