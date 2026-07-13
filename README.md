# PlayRight

Keyboard-controlled piano practice in the browser. Load a MusicXML or MXL score, practice one hand or both hands, and play along with highlighted sheet music.

## Features

- **Sheet music practice** — Renders scores with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org); highlights the current note(s) in green
- **One-hand mode** — Practice left or right hand separately with an LH/RH toggle; computer keys map to a movable slice of the piano
- **Two-hand mode** — Press finger keys (`Q`–`R`, `V`, `N`, `I`–`P`, `[`) to match predicted or score-provided fingerings; click keys on the virtual piano to override fingerings
- **Program mode** — Step through the score and assign fingerings in ascending pitch order; any LH or RH finger key binds to the current lowest-unassigned note (including cross-hand crossovers); all notes in the current step highlight green on the sheet and keyboard, with an amber ring on the next note to assign; advances automatically when every note in the step is set; click a note on the staff to jump back and re-finger a step, or play different fingers over an already-programmed step to reprogram in pitch order; fingerings autosave to the score library when signed in
- **17-note core scope** — The playable window spans 17 semitones; the on-screen keyboard shows a 22-semitone display window (Shift through `]`) including low and high extension keys when needed
- **Smart scope mapping** — Extension keys (`Shift`, Caps Lock, Tab, `Q`, `'`, `]`) are assigned contextually so labels stay aligned as you shift the window
- **Scope shifting** — Arrow keys or `1`/`2` move the window; `↑`/`3` cycles shift distance (semitone, octave, or full 22-semitone range)
- **Auto-fingering** — Predicts fingerings from the score with adjustable hand size (small / medium / large); respects MusicXML fingering markings and manual overrides
- **Smart scrolling** — Anchors each staff line to the treble staff top and the highest note on the full grand-staff line; scroll position stays consistent when switching LH/RH or one-hand/two-hand practice (hand-independent scroll index)
- **Practice controls** — Start, pause, restart, and stop; practice mode is the default; chord steps require all notes before advancing
- **Play mode** — Listen to the full piece with tempo-adjustable playback (0.5×–1.5×). Sheet music and keyboard stay visually in sync for each note’s full sounding duration (including half notes and ties). Click the score to seek. The piece auto-ends at the final release and offers **Replay** to start from the top.
- **Score library** — Sign in with Clerk to import, save, load, and delete personal MusicXML/MXL files (Supabase). Saved scores open in a two-column list with inline sort by date, name, or playback duration (parsed from each score’s MusicXML).
- **Settings** — Fingering mode (Off / Program), **play mode**, playback tempo, auto-fingering, hand size, smooth vs instant line scroll, and scope shift mode; scrollable panel with a slim edge scrollbar when content overflows
- **Collapsible header** — More room for sheet music (`Z` to toggle); fixed-position collapse control that does not jump when toggled

### Program mode behavior

Enable **Program** in Settings (under Fingering mode):

- **MIDI-walk assignment** — Notes are assigned in ascending pitch order across both hands. Press any LH or RH finger key to bind the current lowest-unassigned note in the step. Cross-hand assignments are supported (e.g. RH finger on a bass note).
- **Physical-hand progress** — The status bar `LH x/y · RH x/y` counts assignments by the physical hand that plays each note, not the notated staff hand; totals shift live as crossovers are made.
- **Full-step highlights** — Every note in the current step is green on the sheet music and virtual keyboard.
- **Next-note hint** — The keyboard shows an amber ring on the next note to assign (or the first note when reprogramming a complete step); the status bar shows LH/RH progress, the next pitch, and the upcoming step number.
- **Chord steps** — Steps with multiple notes (e.g. LH chord + RH melody) require a finger press for each note before advancing.
- **Sheet click-jump** — Click a note on the staff (deliberate click only; scroll/drag does not jump) to move the program step to that beat and re-finger its notes in pitch order. After the last note in that step is reassigned, the program advances to the next step automatically.
- **Live reprogramming** — On a step where every note is already assigned, finger presses walk ascending MIDI order and overwrite each note with the new finger—no sheet click required. The status bar and amber ring show the next note in the reprogram pass. Changes persist to Supabase when signed in; after the last note is reassigned, the program advances to the next step.
- **Practice crossover** — Cross-hand assignments carry into two-hand practice: a bass note assigned to RH finger 2 is triggered by RH `I`, not the LH key. Notated `hand` stays on the correct staff for engraving; `playingHand` drives keyboard matching.
- **Stable step index** — The program engine owns step progression; external code cannot change the step index in program mode. On session start, already-fingered steps from saved library data are skipped forward to the first incomplete step.
- **Persistence** — Assignments are stored in `scores.manual_fingerings` as plain finger numbers (same hand) or `{ finger, physicalHand }` objects (crossovers), keyed by `onset:notatedHand:midi`. Syncs to Supabase when signed in (requires Clerk + Supabase + `manual_fingerings.sql`).

### Play mode behavior

When play mode is enabled in Settings:

- **Practice is the default** — Toggle play mode on to listen instead of step through manually.
- **Visual sync** — Green highlights on the sheet music and keyboard follow the same press/release schedule. Longer notes stay highlighted until their scheduled release, not just until the next step in the script. Overlapping held notes (e.g. a LH whole note under RH eighths) stay lit for their full written duration.
- **Ties and chords** — Tied notes play through their combined duration; chord tones on the same beat start and release together.
- **Articulation** — Non-tied notes include a short release gap before the next attack so repeated pitches re-articulate cleanly.
- **Fermatas** — Fermata-marked notes hold for **2×** their normal played duration. When the score places a fermata on a short pickup into an immediately following sustained chord (e.g. Constant Moderato measure 8), the extended hold applies to that chord step. Transport events use integer ticks so fractional fermata offsets still fire; seek and step advance release lingering notes.
- **Keyboard in play mode** — Keys show green while a note is held and grey while it is sounding; scope labels and purple scope highlights are hidden. Computer piano keys are disabled.
- **Transport** — Pause clears sounding highlights; stop returns to the beginning; **Replay** appears after the piece finishes.
- **Steady tempo on long pieces** — Playback schedules notes in a rolling window (~24 quarter-note beats ahead) instead of the entire score upfront, keeping the Tone transport timeline bounded on dense pieces. Tone.js audio-node disposal is guaranteed under sustained load so finished voices do not accumulate and gradually slow playback.
- **Efficient visuals** — Sheet highlights diff incrementally (only changed noteheads recolor), cursor walks only when the step moves, and live sync is coalesced to one update per animation frame so transport callbacks stay off the critical path.
- **Pedal markings** — Sustain pedal brackets and signs render on the staff by default; if OSMD fails to lay out a score’s pedals, the display falls back to a pedal-free copy automatically.

### Score library panel

When signed in, **Saved Scores** opens a modal with:

- **Two-column layout** — More scores visible without scrolling.
- **Inline sort** — Dropdown beside the title: date (newest/oldest), name (A–Z), or duration (shortest/longest). Duration is computed from each file’s parsed playback length at written tempo (measure count as fallback).
- **Per-score actions** — Load on title click; download MusicXML; delete with confirmation.

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

During play mode, computer piano keys are disabled; LH/RH toggle and scope shift are disabled.

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

Clerk and Supabase are optional for local practice: you can import a file and practice in-session without signing in. Saving to the library requires both services configured.

### Supabase setup

1. Create a `scores` table with `id`, `title`, `raw_xml`, `user_id`, and `created_at`.
2. Enable [Clerk third-party auth](https://supabase.com/docs/guides/auth/third-party/clerk) in the Supabase dashboard.
3. Run `supabase/scores_rls.sql` in the SQL editor to apply row-level security.
4. Run `supabase/manual_fingerings.sql` to persist per-score manual fingering overrides.

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

Browser E2E (Playwright + Chromium; real OSMD sheet sync). First time only, install the browser:

```powershell
cd playright
npm run test:e2e:install
npm run test:e2e
```

E2E starts Vite with `VITE_E2E=1`, which attaches `window.__playrightE2E` so tests can load MusicXML without Clerk sign-in. Keep the suite small — high-signal sheet paths only (`e2e/sheet-sync.spec.ts`).

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
| `InputManager.ts` | Keyboard → MIDI mapping for the active scope; two-hand finger routing |
| `scopeShift.ts` / `scopeAlign.ts` | Scope movement and alignment to the current step |
| `twoHandMapping.ts` | Finger key → hand/finger mapping for two-hand mode |
| `fingeringPredictor.ts` | Auto-fingering from score geometry and hand-span settings |
| `sheetMusicPracticeSync.ts` | OSMD highlighting and line-based scroll; play-mode incremental highlights, visual dedupe, and rAF-coalesced sync |
| `e2eHarness.ts` | Browser E2E control surface (`window.__playrightE2E` when `VITE_E2E=1`): load XML, practice/play seek, highlight/scroll probes |
| `parser/` | MusicXML/MXL → practice script (ties, chords, timing) |
| `scoreLibrary.ts` | Supabase CRUD, library duration/measure metrics from MusicXML, manual fingerings |

## Deployment

The Vercel project root directory is `playright/`. Ensure environment variables are set in the Vercel project settings. OpenSheetMusicDisplay is declared in the parent `package.json`; install dependencies at the repo root before deploying if your CI does not do so automatically.

## Roadmap

- [ ] Additional practice modes and scoring
- [x] Browser OSMD E2E: load → render, practice highlight, line scroll, sheet click-jump, play-mode seek (Playwright)
- [x] Hand-independent sheet scroll: consistent line framing across LH/RH and one-hand/two-hand; stable collapsible header; scrollable settings panel
- [x] Play mode with tempo control, seek, replay, and sheet/keyboard duration sync
- [x] Fermata playback: 2× hold, carry-forward into abutting sustained chords, integer Transport ticks, seek/release cleanup
- [x] Program mode with stable step progression, full-step highlights, sheet click-jump refingering, Supabase autosave, and auto-advance after re-finger
- [x] Cross-hand program assignments (MIDI-walk, physical-hand progress, practice matching via `playingHand`)
- [x] Live program reprogramming: finger presses on complete steps overwrite fingerings in pitch order without a sheet click
- [x] In-sequence auto-fingering rule and cross-phrase seeding for phrase-boundary transitions
- [x] Play mode performance: rolling transport scheduling, Tone.js disposal under load, incremental highlights, rAF-coalesced sheet sync, line-scroll anti-wiggle
- [x] Score library UI: two-column saved-scores list, sort by date/name/duration
- [x] Play mode visual duration sync for overlapping held notes; pedal markings restored on staff with OSMD crash fallback

## Checkpoints

Annotated git tags mark stable milestones:

| Tag | Description |
|-----|-------------|
| `checkpoint-sheet-e2e` | Playwright Chromium E2E for real OSMD sheet sync (load/render, practice highlight, system scroll, click-jump, play seek) via `VITE_E2E` harness; Vitest remains the unit suite |
| `checkpoint-library-play-sync` | Score library two-column list + duration sort; play-mode visual release aligned to audio (overlapping holds); pedal markings restored with OSMD fallback |
| `checkpoint-play-performance` | Play mode steady tempo on long/dense scores: rolling schedule window, rIC audio-node disposal, incremental highlight diff + visual dedupe, rAF-coalesced sheet sync off transport callbacks |
| `checkpoint-hand-scroll-ui` | Hand-independent sheet scroll across LH/RH/two-hand; stable collapsible header; scrollable settings panel; keyboard shortcuts and header layout polish |
| `checkpoint-scroll-top-staff` | Scroll anchored to treble staff top / highest line note with robust fallback and top buffer |
| `checkpoint-fermata-playback` | Fermata playback fixed: 2× hold, carry-forward into abutting chords (Constant Moderato m8–9), integer Transport ticks, seek/release cleanup |
| `checkpoint-program-reprogram` | Live program reprogramming: finger presses on complete steps overwrite fingerings in pitch order and persist, without requiring a sheet click |
| `checkpoint-program-crossover` | Cross-hand program mode: MIDI-walk assignment, physical-hand progress, `{ finger, physicalHand }` persistence, practice matching via `playingHand` |
| `checkpoint-program-refinger` | Program mode complete: sheet green highlights, click-jump re-finger with auto-advance, Supabase fingering persistence |
| `checkpoint-program-mode` | Program mode: score-order fingering, full-step green highlights, engine-owned step index |
| `checkpoint-play-mode` | Play mode with tempo, seek, and duration-aligned highlights |
| `checkpoint-2026-06-19` | Earlier stable build |

## License

Private project.
