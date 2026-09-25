-- Publish curated public pieces: Runaway + All of Me.
-- Applied 2026-09-25; safe to re-run (idempotent for these ids).
--
-- Runaway: copy programmed manual_fingerings from the fingered twin
-- (same MusicXML md5) onto the display-titled "Runaway" row, then publish.
-- All of Me: already stored; publish with a curated display title.

update public.scores as target
set
  manual_fingerings = source.manual_fingerings,
  is_public = true
from public.scores as source
where target.id = '6926c7e1-3ee4-42a6-8114-efad2ca25391'
  and source.id = 'b9266bc6-a49e-4cbf-975c-2dfb1dfe6717';

update public.scores
set
  is_public = true,
  title = 'All of Me'
where id = '6fcabbbb-680f-4fac-8681-6f0107704810';
