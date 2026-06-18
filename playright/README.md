# PlayRight

Keyboard-controlled piano practice in the browser. Load a MusicXML score, practice one hand at a time, and play notes on your computer keyboard mapped to a sliding window on a virtual piano.

## Features

- **Sheet music practice** — Renders scores with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org); highlights the current note(s) in green
- **One-hand mode** — Practice left hand or right hand separately with LH/RH toggle
- **17-key scope** — White keys (`A`–`;`) and black keys (`Q`–`P`, `[`) map to a movable slice of the keyboard; arrow keys or `1`/`2` shift the scope
- **Smart scrolling** — Anchors each staff line using the full vertical extent of that hand’s notes on the line (noteheads, stems, ledger lines, beams, ties); scrolls only when you reach a new line or content leaves the viewport
- **Practice controls** — Start, pause, restart, and stop; chord steps require all notes before advancing
- **Score library** — Sign in with Clerk to import, save, load, and delete personal MusicXML/MXL files (Supabase)
- **Settings** — Smooth vs instant line scroll; scope shift mode (semitone, octave, full range)
- **Collapsible header** — More room for sheet music (`Z` to toggle)

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Start practice |
| `Space` | Pause / resume |
| `X` | Stop and return to start |
| `Z` | Toggle header |
| `A` – `;` | White keys in scope |
| `Q` – `P`, `[` | Black keys in scope |
| `←` / `1` | Move scope down |
| `→` / `2` | Move scope up |
| `↑` / `3` | Cycle scope shift distance |

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

## Project structure

```
playright/
├── src/
│   ├── components/     # UI (Dashboard, Lid, SheetMusicDisplay, PianoKeyboard, …)
│   ├── core/           # Practice engine, input, audio, parser, scroll sync
│   ├── store/          # Zustand (useEngineStore)
│   └── types/
├── supabase/           # RLS policies for score library
└── public/
```

### Key modules

| Module | Role |
|--------|------|
| `PracticeEngine.ts` | Step progression, chords, pause/stop, scope alignment |
| `InputManager.ts` | Keyboard → MIDI mapping for the active scope |
| `sheetMusicPracticeSync.ts` | OSMD highlighting and line-based scroll anchoring |
| `parser/` | MusicXML → practice script |
| `scoreLibrary.ts` | Supabase CRUD for saved scores |

## Deployment

The Vercel project root directory is `playright/`. Ensure environment variables are set in the Vercel project settings. OpenSheetMusicDisplay is declared in the parent `package.json`; install dependencies at the repo root before deploying if your CI does not do so automatically.

## Roadmap

- [ ] Two-hand practice mode (UI stub exists, not yet implemented)
- [ ] Additional practice modes and scoring

## License

Private project.
