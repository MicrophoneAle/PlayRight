-- Unpublish Runaway from the curated public library (keep the row for its owner).
-- Applied 2026-07-27; safe to re-run.

update public.scores
set is_public = false
where is_public = true
  and lower(title) = 'runaway';
