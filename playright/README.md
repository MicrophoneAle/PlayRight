# PlayRight

Keyboard-controlled piano practice in the browser. Load a MusicXML or MXL score, practice one hand or both hands, and play along with highlighted sheet music.

## Features

- **Sheet music practice** — Renders scores with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org); highlights the current note(s) in green
- **One-hand mode** — Practice left or right hand separately with an LH/RH toggle; computer keys map to a movable slice of the piano
- **Two-hand mode** — Press finger keys (`Q`–`R`, `V`, `N`, `I`–`P`, `[`) to match predicted or score-provided fingerings; click keys on the virtual piano to override fingerings
- **17-note core scope** — The playable window spans 17 semitones; the on-screen keyboard shows a 22-semitone display window (Shift through `]`) including low and high extension keys when needed
- **Smart scope mapping** — Extension keys (`Shift`, Caps Lock, Tab, `Q`, `'`, `]`) are assigned contextually so labels stay aligned as you shift the window
- **Scope shifting** — Arrow keys or `1`/`2` move the window; `↑`/`3` cycles shift distance (semitone, octave, or full 22-semitone range)
- **Auto-fingering** — Predicts fingerings from the score with adjustable hand size (small / medium / large); respects MusicXML fingering markings and manual overrides
- **Smart scrolling** — Anchors each staff line using the full vertical extent of that hand’s notes on the line; scrolls only when you reach a new line or content leaves the viewport
- **Practice controls** — Start, pause, restart, and stop; chord steps require all notes before advancing
- **Play mode** — Listen to the full piece with tempo-adjustable playback (0.5×–1.5×); sheet music and keyboard show green/grey highlights while each note sounds; click the score to seek; piece auto-ends and offers **Replay** to start from the top
- **Score library** — Sign in with Clerk to import, save, load, and delete personal MusicXML/MXL files (Supabase)
- **Settings** — Practice mode, **play mode**, playback tempo, auto-fingering, hand size, smooth vs instant line scroll, and scope shift mode
- **Collapsible header** — More room for sheet music (`Z` to toggle)

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
| `⇪` / `↹` / `'` / `]` | Extension keys when needed |
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
| Tests | Vitest |

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

```bash
cd playright
npm test
```

## Project structure

```
playright/
├── src/
│   ├── components/     # UI (Dashboard, Lid, SheetMusicDisplay, PianoKeyboard, …)
│   ├── core/           # Practice engine, input, audio, parser, scroll sync, fingering
│   ├── store/          # Zustand (useEngineStore)
│   └── types/
├── supabase/           # RLS policies and schema helpers for score library
└── public/
```

### Key modules

| Module | Role |
|--------|------|
| `PracticeEngine.ts` | Step progression, chords, pause/stop, one-hand notes and two-hand finger input |
| `PlaybackEngine.ts` | Play mode transport scheduling, note durations, ties, articulation gaps, auto-end and replay |
| `playbackTiming.ts` | Musical timing helpers (onsets, durations, piece end, articulation gap) |
| `InputManager.ts` | Keyboard → MIDI mapping for the active scope; two-hand finger routing |
| `scopeShift.ts` / `scopeAlign.ts` | Scope movement and alignment to the current step |
| `twoHandMapping.ts` | Finger key → hand/finger mapping for two-hand mode |
| `fingeringPredictor.ts` | Auto-fingering from score geometry and hand-span settings |
| `sheetMusicPracticeSync.ts` | OSMD highlighting and line-based scroll anchoring |
| `parser/` | MusicXML/MXL → practice script |
| `scoreLibrary.ts` | Supabase CRUD for saved scores and manual fingerings |

## Deployment

The Vercel project root directory is `playright/`. Ensure environment variables are set in the Vercel project settings. OpenSheetMusicDisplay is declared in the parent `package.json`; install dependencies at the repo root before deploying if your CI does not do so automatically.

## Roadmap

- [ ] Additional practice modes and scoring
- [ ] Deeper OSMD integration tests (scroll/highlight behavior in browser)
- [x] Play mode with tempo control, seek, and replay

## License

Private project.
