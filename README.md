# PlayRight

Keyboard-controlled piano practice in the browser. Load a MusicXML or MXL score, practice one hand or both hands, and play along with highlighted sheet music.

## Features

- **Sheet music practice** renders scores with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org) and highlights the current note(s) in green
- **One-hand mode** lets you practice the left or right hand separately with an LH/RH toggle. Computer keys map to a movable slice of the piano
- **Two-hand mode** lets you press finger keys (`Q`–`R`, `V`, `N`, `I`–`P`, `[`) to match predicted or score-provided fingerings. Click keys on the virtual piano to override fingerings
- **Program mode** steps through the score and assigns fingerings in ascending pitch order. Any LH or RH finger key binds to the current lowest-unassigned note (including cross-hand crossovers). All notes in the current step highlight green on the sheet and keyboard, with an amber ring on the next note to assign, and the step advances automatically when every note in it is set. Click a note on the staff to jump back and re-finger a step, or play different fingers over an already-programmed step to reprogram in pitch order. Fingerings autosave to the score library when signed in
- **17-note core scope** means the playable window spans 17 semitones. The on-screen keyboard shows a 22-semitone display window (Shift through `]`) including low and high extension keys when needed
- **Smart scope mapping** assigns extension keys (`Shift`, Caps Lock, Tab, `Q`, `'`, `]`) contextually so labels stay aligned as you shift the window
- **Scope shifting** moves the window with the arrow keys or `1`/`2`, while `↑`/`3` cycles shift distance (semitone, octave, or full 22-semitone range)
- **Auto-fingering** predicts fingerings from the score with adjustable hand size (small / medium / large) and respects MusicXML fingering markings and manual overrides
- **Smart scrolling** anchors each staff line to the treble staff top and the highest note on the full grand-staff line. Scroll position stays consistent when switching LH/RH or one-hand/two-hand practice (hand-independent scroll index)
- **Practice controls** cover start, pause, restart, and stop. Practice mode is the default, and chord steps require all notes before advancing
- **Play mode** lets you listen to the full piece with tempo-adjustable playback (0.5×–1.5×). Sheet music and keyboard stay visually in sync for each note’s full sounding duration (including half notes and ties). Click the score to seek. The piece auto-ends at the final release and offers **Replay** to start from the top.
- **Score library** lets you sign in with Clerk to import, save, load, and delete personal MusicXML/MXL files (Supabase). **Public** scores (e.g. River Flows In You, Runaway) are visible to everyone, including signed-out visitors. Saved scores open in a two-column list with inline sort by date, name, or playback duration (parsed from each score’s MusicXML).
- **Settings** cover Fingering mode (Off / Program), **play mode**, playback tempo, auto-fingering, hand size, smooth vs instant line scroll, and scope shift mode, in a scrollable panel with a slim edge scrollbar when content overflows
- **Collapsible header** gives more room for sheet music (`Z` to toggle), with a fixed-position collapse control that does not jump when toggled

### Program mode behavior

Enable **Program** in Settings (under Fingering mode):

- **MIDI-walk assignment** orders notes in ascending pitch across both hands. Press any LH or RH finger key to bind the current lowest-unassigned note in the step. Cross-hand assignments are supported (e.g. RH finger on a bass note).
- **Physical-hand progress** shows in the status bar `LH x/y · RH x/y`, which counts assignments by the physical hand that plays each note, not the notated staff hand. Totals shift live as crossovers are made.
- **Full-step highlights** mark every note in the current step green on the sheet music and virtual keyboard.
- The **next-note hint** is an amber ring on the keyboard marking the next note to assign (or the first note when reprogramming a complete step). The status bar shows LH/RH progress, the next pitch, and the upcoming step number.
- **Chord steps**, meaning steps with multiple notes (e.g. LH chord + RH melody), require a finger press for each note before advancing.
- **Sheet click-jump** lets you click a note on the staff to move the program step to that beat and re-finger its notes in pitch order. Only a deliberate click jumps, so scroll and drag do not. After the last note in that step is reassigned, the program advances to the next step automatically.
- With **live reprogramming**, on a step where every note is already assigned, finger presses walk ascending MIDI order and overwrite each note with the new finger, with no sheet click required. The status bar and amber ring show the next note in the reprogram pass. Changes persist to Supabase when signed in, and after the last note is reassigned, the program advances to the next step.
- **Practice crossover** carries cross-hand assignments into two-hand practice. A bass note assigned to RH finger 2 is triggered by RH `I`, not the LH key. Notated `hand` stays on the correct staff for engraving, while `playingHand` drives keyboard matching.
- The **stable step index** means the program engine owns step progression, and external code cannot change the step index in program mode. On session start, already-fingered steps from saved library data are skipped forward to the first incomplete step.
- For **persistence**, assignments are stored in `scores.manual_fingerings` as plain finger numbers (same hand) or `{ finger, physicalHand }` objects (crossovers), keyed by `onset:notatedHand:midi`. This syncs to Supabase when signed in (requires Clerk + Supabase + `manual_fingerings.sql`).

### Play mode behavior

When play mode is enabled in Settings:

- **Practice is the default**, so toggle play mode on to listen instead of stepping through manually.
- **Visual sync** keeps green highlights on the sheet music and keyboard following the same press/release schedule. Longer notes stay highlighted until their scheduled release, not just until the next step in the script. Overlapping held notes (e.g. a LH whole note under RH eighths) stay lit for their full written duration.
- For **ties and chords**, tied notes play through their combined duration, and chord tones on the same beat start and release together.
- For **articulation**, non-tied notes include a short release gap before the next attack so repeated pitches re-articulate cleanly.
- **Fermatas** make marked notes hold for **2×** their normal played duration. When the score places a fermata on a short pickup into an immediately following sustained chord (e.g. Constant Moderato measure 8), the extended hold applies to that chord step. Transport events use integer ticks so fractional fermata offsets still fire, and seek and step advance release lingering notes.
- On the **keyboard in play mode**, keys show green while a note is held and grey while it is sounding, and scope labels and purple scope highlights are hidden. Computer piano keys are disabled.
- For **transport**, pause clears sounding highlights, stop returns to the beginning, and **Replay** appears after the piece finishes.
- **Steady tempo on long pieces** comes from scheduling notes in a rolling window (~24 quarter-note beats ahead) instead of the entire score upfront, keeping the Tone transport timeline bounded on dense pieces. Tone.js audio-node disposal is guaranteed under sustained load so finished voices do not accumulate and gradually slow playback.
- For **efficient visuals**, sheet highlights diff incrementally (only changed noteheads recolor), the cursor walks only when the step moves, and live sync is coalesced to one update per animation frame so transport callbacks stay off the critical path.
- **Pedal markings**, meaning sustain pedal brackets and signs, render on the staff by default. If OSMD fails to lay out a score’s pedals, the display falls back to a pedal-free copy automatically.

### Score library panel

When signed in, **Saved Scores** opens a modal with:

- The **two-column layout** keeps more scores visible without scrolling.
- **Inline sort** is a dropdown beside the title offering date (newest/oldest), name (A–Z), or duration (shortest/longest). Duration is computed from each file’s parsed playback length at written tempo (measure count as fallback).
- **Per-score actions** are load on title click, download MusicXML, and delete with confirmation.

### Keyboard shortcuts

Global shortcuts apply in every mode:

| Key | Action |
|-----|--------|
| `Z` | Toggle header |

**Practice mode** (default)

| Key | Action |
|-----|--------|
| `Enter` | Start practice |
| `Space` | Pause / resume |
| `X` | Stop and return to start |

**Play mode** (enable in Settings)

| Key | Action |
|-----|--------|
| `Enter` | Play / **Replay** (after the piece ends) |
| `Space` | Pause / resume |
| `X` | Stop playback and return to start |

During play mode, computer piano keys are disabled. The LH/RH toggle and scope shift are disabled as well.

**One-hand mode**

| Key | Action |
|-----|--------|
| `A` – `;` | White keys in scope |
| `Q` – `[` | Black keys in scope |
| `⇧` / `⇪` / `↹` / `'` / `]` | Extension keys when needed |
| `←` or `1` | Move scope down |
| `→` or `2` | Move scope up |
| `↑` or `3` | Cycle scope shift distance |

**Two-hand mode**

| Key | Fingers |
|-----|---------|
| `Q` `W` `E` `R` `V` | Left hand 5 → 1 |
| `N` `I` `O` `P` `[` | Right hand 1 → 5 |

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19, TypeScript, Tailwind CSS v4, Vite |
| State | Zustand |
| Sheet music | OpenSheetMusicDisplay 2 |
| Audio | Tone.js |
| Auth | Clerk |
| Storage | Supabase (Postgres + RLS) |
| Parsing | Custom MusicXML pipeline (`fast-xml-parser`, Zod) |
| Tests | Vitest (unit), Playwright (browser E2E) |

## Getting started

### Prerequisites

- Node.js 20+
- npm

### Install

From the repository root, install shared dependencies (includes OpenSheetMusicDisplay):

```bash
npm install
```

Then install the app:

```bash
cd playright
npm install
```

### Environment variables

Copy `.env.example` to `.env` in `playright/` and fill in values:

```env
# Clerk — https://dashboard.clerk.com
VITE_CLERK_PUBLISHABLE_KEY=

# Supabase — optional; required for the score library
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Clerk and Supabase are optional for local practice. You can import a file and practice in-session without signing in. Saving to the library requires both services configured.

### Supabase setup

1. Create a `scores` table with `id`, `title`, `raw_xml`, `user_id`, and `created_at`.
2. Enable [Clerk third-party auth](https://supabase.com/docs/guides/auth/third-party/clerk) in the Supabase dashboard.
3. Run `supabase/scores_rls.sql` in the SQL editor to apply row-level security (includes public-score SELECT).
4. Run `supabase/manual_fingerings.sql` to persist per-score manual fingering overrides.
5. Optionally run `supabase/public_scores.sql` for the public-score index (column is also added by `scores_rls.sql`).

### Run locally

```bash
cd playright
npm run dev
```

### Build

```bash
cd playright
npm run build
npm run preview
```

### Test

Unit tests (Vitest, Node):

```bash
cd playright
npm test
```

Browser E2E (Playwright + Chromium, real OSMD sheet sync). First time only, install the browser:

```powershell
cd playright
npm run test:e2e:install
npm run test:e2e
```

E2E starts Vite with `VITE_E2E=1`, which attaches `window.__playrightE2E` so tests can load MusicXML without Clerk sign-in. Keep the suite small, with high-signal sheet paths only (`e2e/sheet-sync.spec.ts`).

## Project structure

```
playright/
├── e2e/                # Playwright browser E2E (sheet load/highlight/scroll/click/seek)
├── src/
│   ├── components/     # UI (Dashboard, Lid, SheetMusicDisplay, PianoKeyboard, …)
│   ├── core/           # Practice engine, playback, input, audio, parser, scroll sync
│   ├── store/          # Zustand (useEngineStore)
│   └── types/
├── supabase/           # RLS policies and schema helpers for score library
├── playwright.config.ts
└── public/
```

### Key modules

| Module | Role |
|--------|------|
| `PracticeEngine.ts` | Step progression, chords, pause/stop, one-hand notes and two-hand finger input |
| `FingeringProgramEngine.ts` | Program-mode MIDI-walk finger capture, cross-hand assignments, sheet click-jump (`seekToStep`), live reprogram on complete steps, refinger overwrite, step advance, and highlight sync |
| `programStepGuard.ts` | Allows only the program engine to change step index while program mode is active |
| `PlaybackEngine.ts` | Play mode rolling-window transport scheduling, per-note press/release tracking, auto-end and replay |
| `playbackTiming.ts` | Musical timing helpers (onsets, durations, articulation gap, piece end) |
| `playingMidiPressTracker.ts` | Tracks overlapping presses by unique id (same pitch repeated consecutively) |
| `AudioEngine.ts` | Tone.js sampler scheduling, release handling, and idle-time audio-node disposal under load |
| `InputManager.ts` | Keyboard → MIDI mapping for the active scope and two-hand finger routing |
| `scopeShift.ts` / `scopeAlign.ts` | Scope movement and alignment to the current step |
| `twoHandMapping.ts` | Finger key → hand/finger mapping for two-hand mode |
| `fingeringPredictor.ts` | Auto-fingering from score geometry and hand-span settings |
| `sheetMusicPracticeSync.ts` | OSMD highlighting and line-based scroll, plus play-mode incremental highlights, visual dedupe, and rAF-coalesced sync |
| `e2eHarness.ts` | Browser E2E control surface (`window.__playrightE2E` when `VITE_E2E=1`): load XML, practice/play seek, highlight/scroll probes |
| `parser/` | MusicXML/MXL → practice script (ties, chords, timing) |
| `scoreLibrary.ts` | Supabase CRUD, library duration/measure metrics from MusicXML, manual fingerings |

## Deployment

The Vercel project root directory is `playright/`. Ensure environment variables are set in the Vercel project settings. OpenSheetMusicDisplay is declared in the parent `package.json`, so install dependencies at the repo root before deploying if your CI does not do so automatically.

## Roadmap

- [ ] Additional practice modes and scoring
- [x] Browser OSMD E2E: load → render, practice highlight, line scroll, sheet click-jump, play-mode seek (Playwright)
- [x] Hand-independent sheet scroll with consistent line framing across LH/RH and one-hand/two-hand, a stable collapsible header, and a scrollable settings panel
- [x] Play mode with tempo control, seek, replay, and sheet/keyboard duration sync
- [x] Fermata playback: 2× hold, carry-forward into abutting sustained chords, integer Transport ticks, seek/release cleanup
- [x] Program mode with stable step progression, full-step highlights, sheet click-jump refingering, Supabase autosave, and auto-advance after re-finger
- [x] Cross-hand program assignments (MIDI-walk, physical-hand progress, practice matching via `playingHand`)
- [x] Live program reprogramming, where finger presses on complete steps overwrite fingerings in pitch order without a sheet click
- [x] In-sequence auto-fingering rule and cross-phrase seeding for phrase-boundary transitions
- [x] Play mode performance: rolling transport scheduling, Tone.js disposal under load, incremental highlights, rAF-coalesced sheet sync, line-scroll anti-wiggle
- [x] Score library UI: two-column saved-scores list, sort by date/name/duration
- [x] Play mode visual duration sync for overlapping held notes, and pedal markings restored on staff with OSMD crash fallback

## Checkpoints

Annotated git tags mark stable milestones:

| Tag | Description |
|-----|-------------|
| `checkpoint-sheet-e2e` | Playwright Chromium E2E for real OSMD sheet sync (load/render, practice highlight, system scroll, click-jump, play seek) via `VITE_E2E` harness, while Vitest remains the unit suite |
| `checkpoint-library-play-sync` | Score library two-column list + duration sort, play-mode visual release aligned to audio (overlapping holds), and pedal markings restored with OSMD fallback |
| `checkpoint-play-performance` | Play mode steady tempo on long/dense scores: rolling schedule window, rIC audio-node disposal, incremental highlight diff + visual dedupe, rAF-coalesced sheet sync off transport callbacks |
| `checkpoint-hand-scroll-ui` | Hand-independent sheet scroll across LH/RH/two-hand, a stable collapsible header, a scrollable settings panel, and keyboard shortcut and header layout polish |
| `checkpoint-scroll-top-staff` | Scroll anchored to treble staff top / highest line note with robust fallback and top buffer |
| `checkpoint-fermata-playback` | Fermata playback fixed: 2× hold, carry-forward into abutting chords (Constant Moderato m8–9), integer Transport ticks, seek/release cleanup |
| `checkpoint-program-reprogram` | Live program reprogramming, where finger presses on complete steps overwrite fingerings in pitch order and persist, without requiring a sheet click |
| `checkpoint-program-crossover` | Cross-hand program mode: MIDI-walk assignment, physical-hand progress, `{ finger, physicalHand }` persistence, practice matching via `playingHand` |
| `checkpoint-program-refinger` | Program mode complete: sheet green highlights, click-jump re-finger with auto-advance, Supabase fingering persistence |
| `checkpoint-program-mode` | Program mode: score-order fingering, full-step green highlights, engine-owned step index |
| `checkpoint-play-mode` | Play mode with tempo, seek, and duration-aligned highlights |
| `checkpoint-2026-06-19` | Earlier stable build |

## License

Private project.
