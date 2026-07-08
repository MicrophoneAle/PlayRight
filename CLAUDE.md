# Project Context & AI Guidelines (`claude.md`)

## 1. Project Overview & Tech Stack

- **Core Mission:** Browser-based piano practice app. Load MusicXML/MXL scores, practice one or both hands with a computer keyboard mapped to a movable piano scope, assign fingerings in program mode, and play along with OSMD-rendered sheet music and synchronized highlights.
- **Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, Tone.js, OpenSheetMusicDisplay 2, Clerk (auth), Supabase (Postgres + RLS), custom MusicXML parser (`fast-xml-parser`, Zod), Vitest.
- **Architectural Patterns:**
  - **Client-only SPA** — no Next.js/server actions; all logic runs in the browser.
  - **Singleton engines** — `PracticeEngine`, `FingeringProgramEngine`, and `PlaybackEngine` are module singletons wired once in `App.tsx` with shared `AudioEngine` and `InputManager`.
  - **Zustand store** — `useEngineStore` is the single source of truth for script, step index, fingering state, scope, and UI settings.
  - **Script pipeline** — MusicXML → `PlaybackScript` (`StepOrder[]`) via `parser/`; engines consume script, OSMD renders from raw XML separately.
  - **Mode routing** — `App.tsx` routes finger input to `FingeringProgramEngine` or `PracticeEngine` based on `fingeringMode`; play mode uses `PlaybackEngine`.

## 2. Codebase Structure & Key Files

```
PlayRight/
├── claude.md                 # This file
├── README.md                 # User-facing docs and checkpoints
├── package.json              # Root deps (includes opensheetmusicdisplay)
└── playright/                # Vite app (Vercel root directory)
    ├── src/
    │   ├── App.tsx           # Engine wiring, input routing, auth ref
    │   ├── components/       # Dashboard, SheetMusicDisplay, PianoKeyboard, …
    │   ├── core/             # Engines, parser, input, audio, sync
    │   ├── store/            # useEngineStore (Zustand)
    │   └── types/            # Shared TS types (ScriptNote, ManualFingeringMap, …)
    ├── supabase/             # RLS + manual_fingerings SQL (run in dashboard)
    └── public/
```

**Crucial Files:**

| File | Role |
|------|------|
| `playright/src/store/useEngineStore.ts` | Central state, script load, manual fingering persistence hooks, guarded `setStepIndex` in program mode |
| `playright/src/core/FingeringProgramEngine.ts` | Program mode: MIDI-walk assignment, cross-hand capture, sheet `seekToStep`, live reprogram on complete steps, step advance |
| `playright/src/core/PracticeEngine.ts` | Practice/play step progression, chord completion, two-hand finger matching (uses `playingHand`) |
| `playright/src/core/PlaybackEngine.ts` | Play mode transport, per-note press/release scheduling, seek, replay |
| `playright/src/core/programStepGuard.ts` | Only `FingeringProgramEngine` may change `currentStepIndex` while program mode is active |
| `playright/src/core/practiceSteps.ts` | Step helpers: `programCurrentNote`, `programActiveTargetNote`, `isProgramStepComplete`, two-hand key maps |
| `playright/src/core/parser/MusicXMLMapper.ts` | MusicXML → script timing and note extraction (ties, chords, measures) |
| `playright/src/core/fingeringPredictor.ts` | Auto-fingering; applies manual fingerings and sets `playingHand` for crossovers |
| `playright/src/core/sheetMusicPracticeSync.ts` | OSMD highlight + line-based scroll sync |
| `playright/src/core/scoreLibrary.ts` | Supabase CRUD for scores and `manual_fingerings` |
| `playright/src/types/index.ts` | `ManualFingeringValue`, `fingeringKey()`, `resolveManualAssignment()` |
| `playright/src/components/SheetMusicDisplay.tsx` | OSMD mount, deliberate click → program seek |
| `playright/src/components/PianoKeyboard.tsx` | Virtual keyboard, program status bar, scope labels |
| `playright/supabase/manual_fingerings.sql` | Schema/docs for persisted fingering overrides |

## 3. Constraints & "Don't Touch" Zones

- **Program step index:** Do not call `setStepIndex` from UI/sync code during program mode. Use `FingeringProgramEngine.seekToStep()` for sheet jumps or `runWithProgramStepIndexWrite()` inside the program engine only.
- **Hand semantics:** `ScriptNote.hand` is the **notated staff hand** (engraving). `playingHand` is the **physical hand** that plays the key (crossovers). Never swap these when persisting or matching input.
- **Manual fingering keys:** Always `onset:notatedHand:midi` via `fingeringKey()`. Crossovers persist as `{ finger, physicalHand }`; same-hand assignments are plain finger numbers.
- **Supabase schema:** Do not alter `scores` or RLS in app code. Add/update SQL under `playright/supabase/` and document in README.
- **Edit mode removed:** Fingering capture is program mode only; do not reintroduce a separate edit mode without explicit request.
- **Cross-hand crossovers:** Persist as `{ finger, physicalHand }` on `onset:notatedHand:midi` via `manual_fingerings`. Legacy `manualHandOverrides` localStorage is migrated on score load (`manualHandOverrideMigration.ts`) and no longer rewrites `note.hand`.
- **Deploy layout:** Vercel project root is `playright/`. OpenSheetMusicDisplay lives in the **repo root** `package.json`—CI/deploy must install root deps before building the app.
- **Style / lint:**
  - TypeScript strict; use `.ts` / `.tsx` import extensions (e.g. `'../core/foo.ts'`).
  - Functional React components; hooks for side effects.
  - ESLint flat config (`playright/eslint.config.js`); run `npm run lint` and `npm test` in `playright/`.
  - Prefer minimal, focused diffs; match existing naming and module boundaries.
  - Do not add markdown docs unless asked (README / this file are exceptions).

## 4. Known Roadblocks & Historical Pitfalls

- **Program step index fights:** Multiple subsystems (sheet sync, scope align, keyboard) used to overwrite `currentStepIndex` in program mode, causing jumps (e.g. reverting to measure 2). Guarded by `programStepGuard`; watch any new subscriber that calls `setStepIndex`.
- **Complete-step finger presses:** Previously advanced to the next step instead of reprogramming. Fix: start a refinger pass (`programRefingerNoteIndex = 0`) when `programCurrentNote` is null but the step is complete.
- **Sheet click vs scroll:** Only **deliberate** note clicks should call `seekToStep`; drag/scroll must not jump steps. Engine also locks sheet seeks for ~500ms after auto-advance (`sheetSeekLockedUntil`).
- **Skip-forward on program start:** Fully fingered steps from saved library data are skipped to the first incomplete step—navigation back requires sheet click or landing on that step index manually.
- **Cross-hand regression surface:** Physical-hand progress counts, keyboard next-note hints, practice matching, and Supabase round-trip must stay aligned. Tests live in `fingeringModes.test.ts`.
- **MusicXML timeline drift:** `MusicXMLMapper` can advance time on tie-stop before chord tones on the same beat, inflating onsets (seen on complex scores like `morns-like-these-honkai-star-rail.musicxml`). Grace notes ride as `graceBefore` metadata (play-mode scheduled, no timeline advance)—parser changes need fixture tests.
- **Octave-shift is display-only (do NOT "fix" it):** MusicXML `<pitch>` is the *sounding* pitch; `<octave-shift>` only tells the renderer to engrave the passage an octave lower/higher with an 8va/8vb bracket. The parser correctly uses pitch data as-is. Applying a naive ±12 would push morns' final E7 to off-piano E8 (MIDI 112) and the range guard would drop the note. Locked by `octave-shift.parser.test.ts`.
- **Play mode duration sync:** Highlights must follow note **release** time (ties, half notes), not just step onsets. `playingMidiPressTracker` handles repeated same-pitch attacks.
- **Fermata playback (fixed):** Play mode previously froze or lingered at fermatas (notably Constant Moderato measure 8–9): fractional Transport ticks never fired, pickup fermatas on short notes did not extend the following whole-note chord, and seek/advance left notes sounding. Fixed in `playbackTiming.ts` (2× hold, `buildFermataPlaybackContext` carry-forward, release-aligned offsets) and `PlaybackEngine.ts` (`safeTickTime` integer rounding, callback error isolation, `releaseAll` on seek). Regression: `constant-moderato-fermata.test.ts`.
- **Audio init:** Tone.js requires a user gesture; `App.tsx` warms audio on first pointer/keydown.
- **Large score assets:** Bundled `.musicxml` files (especially multi-thousand-line scores) are for fixtures/regression—do not read or diff them unless working on parser/load behavior.
- **Build hygiene:** Unused imports and strict `ManualFingeringMap` literals have broken Vercel builds before—keep `npm run build` clean.

## 5. Token Efficiency & Output Protocols (Strict)

- **Code modifications:** Provide targeted snippets or diffs. Do not output unchanged wrapper code or entire files.
- **Exclusions:** Do not read or analyze `node_modules/`, `dist/`, large bundled `.musicxml` assets, log dumps, or minified scripts unless the task explicitly requires it.
- **Brevity:** Omit conversational fluff and lengthy post-code explanations. Let the code speak for itself.
- **Verification:** After substantive changes, run `npm test` and `npm run build` from `playright/` (not the repo root).
- **Checkpoints:** Stable milestones use annotated git tags (`checkpoint-*`); update README Checkpoints table when tagging. Latest: `checkpoint-library-play-sync` (score library sort UI, play-mode visual duration sync, pedal display restore).
