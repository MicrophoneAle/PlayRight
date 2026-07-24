# Repeat / Ending / Jump Support Architecture

This document has two parts: the **original architecture proposal**, reproduced verbatim from
the investigation phase before any implementation began (it was never committed and lived only
in the planning conversation until now), and an **implementation notes appendix** covering what
R0/R1/R2 actually built on top of it, including where the shipped code diverged from or extended
beyond the original design questions.

---

## Part 1: Original Proposal (verbatim)

> This was investigation only, with nothing implemented. Two scratch scans were run and deleted,
> and the tree is clean.

### 0. What exists today

The parser has zero support. `MusicXMLNormalizer.ts` never surfaces `<barline>` children
(`<repeat>`, `<ending>`) or `<sound>` jump attributes, and `MusicXMLMapper.ts` walks measures
once in document order. Every grep hit for "repeat/barline" in the parser is coincidental
(accidental-reset-per-measure, "repeated pitches" test). Repeated sections currently play once,
as written.

The four consumers, and whether each is safe or needs change:

| Consumer | Verdict | Why |
|---|---|---|
| `PracticeEngine` | Safe (v1 scope, Q4) | Practices as written, so no change is needed if v1 keeps practice linear |
| `FingeringProgramEngine` + `programStepGuard` | Safe | Walks document steps, and fingering identity is document-order-based (fingered once, works out for free) |
| `PlaybackEngine` + `playbackTiming` | Real change | Everything assumes "next played step = stepIndex+1" and "attack time = f(step.onset)". The rolling window (`lastScheduledStep = stepIndex + 1`) and the per-step tables in `playbackTiming` (`buildPlaybackFermataOffsetsByStep`, `buildStepPlaybackDurationQuarterNotesByStep`, `buildConsecutiveSameNoteKeySet`, `buildFinalNoteKeySet`, `pieceEndQuarterNotes`) are all indexed by document order |
| `sheetMusicPracticeSync` | Real change, and it has a live latent interaction today (below) | One cursor walk, monotonic `searchStart`, one slot per step |

A **key discovery** is that OSMD's cursor already follows repeats internally. OSMD's own cursor
iterator has full repetition machinery (`backJumpOccurred`, `CurrentRepetitionIteration`,
`repetitionIterationCountDict`…), and the shipped bundle contains
`handleRepetitionsAtMeasureEnd()` executing jumps at measure ends. So on unwelcome-school today,
`walkCursorSnapshots` already visits repeated measures multiple times. Our script has each
measure once, so `findSequentialStepMatch`'s forward scan silently skips the duplicates. This
happens to work, but it's untested, implicit behavior, and it means half of the visual-index
problem (per-pass snapshots of the same engraving) is already handed to us by OSMD. This could
not be verified in a live browser (score loading is Clerk-gated), so the R2 gate includes making
this explicit under test.

### 1. Fixture inventory

A scan of all 10 bundled assets for `<repeat>`, `<ending>`, `<segno>`, `<coda>`, dacapo,
dalsegno, tocoda, and fine found that unwelcome-school is the only fixture with any repeat
structure. It's a rich one, with 4 repeat pairs, 14 ending marks, and 3 notation quirks worth
testing:

| Section | Structure |
|---|---|
| m9–m17 | forward repeat at m9, ending 1 is start+stop with repeat backward, ending 2 at m17 (discontinue) |
| m18–m28 | multi-measure endings: ending 1 = m23–25 (backward at 25), ending 2 = m26–28 (discontinue) |
| m29–m37 | same shape as the first: ending 1 = m36 alone, ending 2 = m37 |
| m54–m62 | ending 1 = m59–61 (backward at 61) with no ending 2 marked at all, so the second pass must skip m59–61 and fall through to m62 unmarked |

No fixture anywhere has segno/coda/D.C./D.S. The recommendation is that unwelcome-school is the
primary test case for repeats+endings and that a small hand-authored fixture must be added for
the jump family (deferred, see scope).

Expected logical measure order for unwelcome-school (the "playback order table" for the new
gate): `1–16, 9–15, 17–25, 18–22, 26–36, 29–35, 37–61, 54–58, 62–66`

### 2. The six design questions

**Q1. Where does expansion happen?**

Option (a), a materialized flat script, has these tradeoffs:
- Every consumer keeps a flat array, so there are zero downstream changes in theory.
- Breaks manual-fingering identity. Keys are `onset:hand:midi`. A duplicated pass gets new
  onsets → the same written note has different keys per pass → a fingering captured on pass 1
  doesn't apply on pass 2, program mode makes you finger the piece twice, and every existing
  saved score's keys shift wherever onsets move. This collides head-on with the entire
  persistence design.
- Practice/program mode would be forced through every pass (out of scope) or need
  pass-deduplication logic anyway.
- The P0-1 gate churns, because step counts and total timeline divisions change for
  unwelcome-school, weakening the one gate that has caught real timeline drift.

Option (b), a separate playback-order index, has these tradeoffs:
- The script stays byte-identical, so fingering identity, persistence, and the P0-1 gate are all
  unaffected by construction.
- Playback-side consumers must consult the index.

**The recommendation is (b), but expanded per-entry rather than as ranges.** At parse time, resolve
repeat structure into:

```ts
interface PlaybackOrderEntry {
  stepIndex: number;        // back-reference into the document-order script
  playbackOnset: number;    // logical divisions on the expanded timeline
  passIndex: number;        // 0-based iteration count (0 for unrepeated)
}
type PlaybackOrder = PlaybackOrderEntry[];  // identity mapping when no repeats
```

Flat per-step entries (not ranges) because the consuming rolling scheduler wants exactly "next
entry, next onset". Ranges would just be re-flattened inside it. Memory is negligible (a few
thousand small objects). When a score has no repeats, `PlaybackOrder` is the identity mapping and
every playback code path reduces to today's behavior, which is the zero-diff argument for the
other nine fixtures.

Note which per-step tables are pass-invariant versus pass-dependent. Note durations are
pass-invariant and stay per-step. Fermata cumulative offsets, consecutive-same-note adjacency,
and final-note detection are pass-dependent, since a backward jump creates a new adjacency (the
last note of m16 against the first note of m9 on pass 2), so those tables move to
per-`PlaybackOrder`-entry.

**Q2. First/second endings**

These are handled entirely inside the parse-time resolver that builds `PlaybackOrder`, so no
downstream consumer ever sees an ending. The resolver walks measures with a repeat-region stack.
Pass 1 includes ending-1 measures and jumps back at the backward barline. Pass 2 skips measures
whose ending list excludes the current pass number and continues into ending 2 (or, per
unwelcome-school's fourth repeat, falls through past the ending-1 region when no ending 2
exists). `type="discontinue"` matters only for engraving (open bracket). For playback order it's
identical to `stop`. `<repeat times="N">` should be parsed from day one, since they're cheap in
the resolver and common in the wild.

**Q3. Segno / Coda / D.C. / D.S. encoding and resolution**

MusicXML encodes targets as `<direction><direction-type>... <sound segno="ID"/></direction>`
(same shape for `<coda/>` + `sound coda="ID"`), and jumps as `<sound dacapo="yes"/>`,
`<sound dalsegno="ID"/>`, `<sound tocoda="ID"/>`, `<sound fine="yes"/>` (usually on a
`<direction>` at the jump measure, occasionally on `<barline>`). In the resolution model, the
normalizer surfaces these as per-measure instructions. The resolver keeps a symbol table
`targetId → measureIndex` from a first pass, then during expansion a dalsegno/dacapo sets the
walk position to the target measure with "jumps disarmed, tocoda/fine armed" state (the standard
convention, where repeats inside a D.S. replay are not re-taken and fine/tocoda only fire on the
post-jump pass). A step position is derived from a measure index as "first script step whose
measure matches." Practically, the resolver should be built as a small instruction interpreter
over per-measure instruction lists from the start. Repeats/endings are then just two
instruction kinds, and the jump family adds instructions to an existing machine rather than a
bolt-on.

**Q4. Practice mode scope**

In v1, practice and program modes play AS WRITTEN, and only play mode honors repeats.

This is a real scope decision. Repeat-aware practice requires a pass-aware position
(`(stepIndex, passIndex)`) that would ripple through step completion, the grace-position walk,
`programStepGuard`'s single-index invariant, skip-forward, and seek, which amounts to a full
engine redesign. It's also pedagogically defensible. You drill a passage once, and the
performance rendering (play mode) honors the form. Deferred with a named future phase, not
silently dropped.

**Q5. Sheet sync / visual index**

The existing `buildPracticeVisualIndex` cannot represent this as-is. `stepCursorOffsets` is one
offset per step, but a repeated measure needs to highlight at two logical times, with the same
GraphicalNotes/engraving (highlighting the same glyphs on both passes is correct) but different
cursor offsets per pass. Because OSMD's cursor walk already yields one snapshot per pass, the
fix is structural rather than algorithmic. Key cursor offsets by `PlaybackOrder` index (or
equivalently `stepCursorOffsets: number[][]`, per step per pass), with the matcher consuming
duplicate passes guided by the same `PlaybackOrder` the audio uses. `stepGraphicalNotes` stays
shared across passes. Play-mode sync then keys scroll/cursor by playback-order position rather
than raw `currentStepIndex`, which becomes non-monotonic during play mode, so the store likely
wants a `currentPlaybackOrderIndex` alongside it to keep practice-mode consumers from ever
seeing non-monotonic step indices. Backward seeks mean `moveCursorToOffset` must handle a target
offset smaller than the current one (reset-and-advance). Q5 should pin today's implicit
duplicate-pass-skipping behavior under test, since it's currently load-bearing and invisible.

**Q6. Program mode: finger once per written note**

Yes, and it's free. Under the recommended model this isn't even a decision to enforce. The
script has one entry per written note and fingering keys are document-onset-based, so a
repeated section is fingered once and both passes render that fingering. There is no conflict
with Q1, and this is the main reason for Q1's recommendation. (Play-mode fingering overlays
already resolve notes per step, so they display correctly on every pass.)

### 3. Recommended v1 scope

**In:** the parser surfaces `<repeat>` (incl. `times`) and `<ending>` (incl. comma lists,
`discontinue`). The resolver builds `PlaybackOrder`. Play-mode audio + sheet visuals honor
repeats/endings, and seek maps a document step to its first pass. Library duration
(`deriveLibraryEntryMetrics`) switches to expanded length (repeats make pieces genuinely longer,
which is small but user-visible and worth including).

**Explicitly deferred:** D.C./D.S./Fine/Coda execution (parse and warn via the existing
`parseWarnings` channel in v1, so users are told a score has a D.S. al Coda that won't be
honored yet), repeat-aware practice/program modes, per-pass `<sound tempo>` re-application (the
app has a single global `tempoBpm` today anyway), and voltas beyond pass 2 in UI messaging.

### 4. Phased plan with gates

**R0: Parse + resolve (no behavior change).** The normalizer surfaces barline/ending/sound
instructions per measure (verify cross-part agreement, read from the first part). The resolver
builds `PlaybackOrder`, and the parse result carries it alongside the untouched script.

The gate has two parts: (1) P0-1 stays byte-identical, which should hold by construction but is
verified anyway, and (2) a new playback-order table gate, meaning an actual-vs-expected measure
sequence test asserted for the nine linear fixtures (locking in that non-repeat scores can never
be perturbed) plus the hand-derived unwelcome-school sequence from §1 asserted exactly. This is
the analogue of P0-1 for logical order, and it must be written against the hand-derived table
before the resolver exists (verified-failing first, per this project's pattern).

**R1: PlaybackEngine over PlaybackOrder.** The rolling window iterates entries, with attack
times from `playbackOnset`. Fermata offsets, same-note gaps, and final-note detection are
re-derived over entry adjacency. Release-all-style cleanup happens at jump boundaries (nothing
may keep sounding across a backward jump). `isRepeatedPlaybackAttack` consults entry adjacency,
not stepIndex adjacency, and seek maps a document step to its first pass.

The gate keeps the entire existing playback suite unchanged (scheduling and draw tests are all
zero-diff via the identity mapping) and adds a new unwelcome-school scheduling test asserting
the emitted attack sequence (stepIndex, onset-quarters) matches the R0 table with correct
logical times.

**R2: Sheet sync.** Per-pass cursor offsets are keyed by playback-order position, the store
gains a playback-order position, `moveCursorToOffset` becomes backward-safe, and today's
duplicate-pass-skipping behavior is pinned explicitly.

The gate requires the existing sheet-sync suite green, new mocked-snapshot tests for per-pass
offsets and a backward jump, and manual browser verification on unwelcome-school (needs a
signed-in session).

**R3 (v2): Jump family.** The instruction interpreter grows dacapo/dalsegno/tocoda/fine, a
minimal fixture is authored (none exists), and the playback-order table gate extends to it.

The R0 table gate is the backbone. Every later phase re-runs it unchanged, exactly like P0-1 has
anchored the grace-note work.

---

## Part 2: Implementation Notes (R0 / R1 / R2, as actually shipped)

Written from the shipped code and test suite on `main` as of the merge that landed R0+R1
(commit `55bec31`, "added jump boundaries + transport for repeats, reorderings") and the R2 work
done in the same session, both verified against the real `unwelcome-school.mxl` fixture.

### R0: Parser resolution (`playright/src/core/parser/PlaybackOrderResolver.ts`)

Matches the proposal closely. `PlaybackOrderEntry` shipped with exactly the proposed fields
(`stepIndex`, `playbackOnset`, `passIndex`), and `ParseMusicXmlResult` carries `playbackOrder`
alongside the untouched `script`. The resolver walks a repeat-region stack over measure
boundaries computed from the first part's normalized elements (`computeMeasureBounds`), and
falls back to the identity mapping, with a logged warning, on any detected inconsistency
rather than emitting a partial unroll.

**Gate, as shipped:** `playback-order.repeats.test.ts` asserts the identity mapping for all nine
non-repeat fixtures (`IDENTITY_ASSETS`), and for unwelcome-school asserts the exact hand-derived
measure walk from §1 of the proposal (`1–16, 9–15, 17–25, 18–22, 26–36, 29–35, 37–61, 54–58,
62–66`) verbatim, plus an entry-count invariant (`document steps + one extra visit per step in
replayed measures`) and a strictly-increasing `playbackOnset` / correct-`passIndex` invariant.
Direct measurement confirmed 625 document steps and 822 unrolled entries (197 extra visits from
the four replayed regions).

### R1: PlaybackEngine over PlaybackOrder (`playright/src/core/PlaybackEngine.ts`)

Matches the proposal's design. `ScheduleDerivedData` splits tables exactly along the
pass-invariant / pass-dependent line the proposal called out. Note durations, fermata context,
consecutive-same-note keys, and per-step durations stay document-indexed (pass-invariant), while
`entryFinalNoteKeys`, `entryFermataOffsets`, and `entryAttackQuarters` are entry-indexed
(pass-dependent, computed over `entryScript`, the playbackOrder projected back into
`StepOrder`-shaped virtual steps). The rolling schedule window iterates `PlaybackOrder` entries.
`firstEntryIndexByStep` resolves a seek/click to a document step's first pass, exactly as
proposed.

In one place the shipped code generalized beyond the proposal's literal language. `jumpBoundaryAfterEntry`
is defined as **any** break in document-step contiguity (`next.stepIndex !== entry.stepIndex + 1`),
not specifically a *backward* jump. See Divergences below. This generalization is what made the
skip-only boundary cases (discovered during today's real-fixture R2 verification) work correctly
without any additional code.

**Gate, as shipped:** `PlaybackEngine.playback-order.test.ts` replays unwelcome-school through a
mocked Tone transport and asserts the emitted attack sequence's `(stepIndex, tick)` pairs match
`playbackOrder`'s `(stepIndex, playbackOnset)` exactly (the fixture has no fermatas, so
`playbackOnset` directly gives the expected tick). `MockTransport.diagnostics` watches for the
project's three known live failure modes (scheduleOnce throw wedging the queue, fractional-tick
stranding, uncleared events) on every replay, not just asserted-away.

### R2: Sheet sync (`playright/src/core/sheetMusicPracticeSync.ts`, `PlaybackEngine.ts`,
`useEngineStore.ts`, `SheetMusicDisplay.tsx`)

Matches the proposal's recommended design, and picked the **first** of the two equivalent
options Q5 offered (`stepCursorOffsets: number[][]` was the other). Cursor offsets are keyed by
flat `PlaybackOrder` index, as `orderCursorOffsets: number[]` with one entry per playback-order
position, rather than a nested per-step-per-pass array. `stepGraphicalNotes` stays shared
across passes as proposed (pass-0 entries alone populate the per-step arrays, so practice-mode
consumers are structurally unaffected by construction, not by convention).

Store gained `currentPlaybackOrderIndex` + `setPlaybackOrderIndex`, exactly the field the
proposal predicted the store "likely wants." `PlaybackEngine.applyStepVisual(stepIndex,
entryIndex)` sets both `currentStepIndex` and `currentPlaybackOrderIndex` together at every call
site (play start, restart, seek, and the fire-time attack callback). Every caller already knows
its entry index natively, so no reverse lookup was needed. `moveCursorToOffset` was exported and
its backward reset-and-advance behavior (already present in the pre-R2 code, since practice-mode
seeks needed it) is now explicitly pinned under test rather than incidental.

**The implicit duplicate-pass-skipping behavior the proposal called out ("today's
implicit... invisible") was pinned as an explicit named regression test**
(`implicit duplicate-pass skipping (named regression guard)` in
`sheetMusicPracticeSync.repeats.test.ts`). Identity-order matching, run against a cursor walk
that already contains OSMD's duplicated repeat snapshots, must still resolve every document step
via forward scan without consuming a step, which is exactly the "OSMD already hands us half the
problem" mechanism §0 of the proposal identified.

**Gate, as shipped and verified today against the real fixture** (not a synthetic stand-in, see
Divergences): all 15 R2 tests pass against `unwelcome-school.mxl` loaded through the project's
real parser (`loadUnwelcomeSchoolScript()`), with a mocked OSMD cursor driven position-for-position
from the real `playbackOrder` (OSMD's actual repeat-executing cursor walk cannot be observed in
this environment, see below):

- The named regression guard holds for all 625 real document steps.
- Per-pass offsets hold, with `orderCursorOffsets` exactly `[0..821]`, confirmed at all 8 real
  boundary transitions (4 back-jumps + 4 forward skips, see Divergences).
- `moveCursorToOffset` forward/backward-reset behavior: holds.
- `syncSheetMusicPlaybackVisuals` per-pass sync, stale-order fallback, genuine backward seek:
  all hold against real region boundaries.
- Practice-mode linearity (`PracticeEngine.repeatLinearity.test.ts`): one-hand practice over the
  real 625-step script with the real unrolled order sitting unused in the store advances
  strictly through the distinct document steps it visits (594 of 625 have R-hand content),
  never revisits a step once left, and `currentPlaybackOrderIndex` stays `0` at every single
  tick, confirming Q4 by construction (`PracticeEngine` never reads `playbackOrder` or
  `currentPlaybackOrderIndex` anywhere in its source).

**Manual browser verification (called for by the R2 gate) is still outstanding.** This
environment cannot sign in behind Clerk, so the standing assumption underlying every R2 test
(that OSMD's real rendered cursor iterator performs the same measure traversal R0's resolver
computes from the barline markup) remains unverified against a live render. It is verified
against the *resolver's own output*, which is the closest available proxy.

### R3: Jump family (segno/coda/D.C./D.S.)

Not implemented. No fixture authored. Remains exactly as scoped in the original proposal, fully
deferred to v2.

---

## Divergences from the original proposal

1. **Skip-only boundaries were not explicitly anticipated by Q1/Q2, but the shipped design
   handles them for free.** The proposal's design questions and Q5 in particular are framed
   almost entirely around *backward* jumps ("a backward jump creates a new adjacency," "Q5...
   `moveCursorToOffset` must handle a target offset smaller than the current one"). Today's
   real-fixture verification found that unwelcome-school's four repeat regions actually produce
   **eight** boundary transitions, not four. Each region has a backward repeat jump (e.g.
   m16→m9) *and* a separate forward "skip" past a dropped ending-1-only measure or an unmarked
   tail once the replay pass reaches the point where the first pass's ending diverges from the
   second pass's continuation (e.g. m15→m17, skipping m16, and m58→m62, skipping the unmarked
   m59–61 tail in region 4, the "no ending 2 at all" case the proposal's fixture table already
   flagged as a parsing quirk, but did not connect to a *second, distinct* boundary-handling
   requirement). R1's actual definition of `jumpBoundaryAfterEntry`, any break in document-step
   contiguity rather than specifically `stepIndex` decreasing, already generalizes over both
   cases correctly. This was not a design gap in the shipped code, just a scope the original six
   questions didn't explicitly name. The general "entry adjacency, not stepIndex adjacency"
   principle Q1 and R1 do state was sufficient to cover it without modification.

2. **Q5's two offered designs for per-pass cursor offsets** (`PlaybackOrder`-indexed flat array
   vs. `stepCursorOffsets: number[][]`) were presented as equivalent alternatives, and the
   shipped R2 code took the flat `orderCursorOffsets: number[]` form. There is no behavioral
   difference. This is noted here only so a future reader comparing the proposal's Q5 text to
   the shipped `PracticeVisualIndex` interface doesn't read the difference as a departure from
   spec.

3. **The proposal's §1 fixture table describes each repeat's full structural span** (repeat
   sign through where the ending-2 bracket resolves, e.g. "m9–m17"), while R0's
   `REPLAYED_MEASURES` test constant (and this document's updated fixture table below) describes
   the narrower **replayed sub-range only** (e.g. m9–15, since m16 is ending-1-only and m17 is
   ending-2, each played exactly once). These are two consistent framings of the same structure,
   not a contradiction. They were reconciled and cross-checked measure-by-measure against the
   real fixture's confirmed `playbackOrder` during today's verification (see the updated table
   below).

4. **Manual browser verification, called for explicitly in the R2 gate, has not happened** and
   cannot happen in this environment (Clerk-gated score loading, no browser access). Every R2
   assertion today is verified against the *parser's resolved `playbackOrder`* driving a mocked
   OSMD cursor, not against OSMD's own live cursor iterator. The proposal's §0 standing
   assumption, that OSMD's cursor executes the same measure traversal the resolver computes,
   is still unverified against a live render, exactly as the proposal anticipated it might
   remain ("This could not be verified in a live browser... the R2 gate includes making this
   explicit under test"). The explicit test exists, but the live-browser verification does not.

5. **R3 (jump family) fixture was never authored.** The proposal deferred this to v2 and named
   it as a to-do ("a small hand-authored fixture must be added"). It remains un-started, not
   partially started.

## Updated fixture inventory (confirmed against real R0/R1/R2 measurements)

| Fixture | Repeats? | Confirmed structure |
|---|---|---|
| `unwelcome-school.mxl` | Yes, with 4 regions and 8 boundary transitions | 625 document steps, 822 unrolled `playbackOrder` entries (197 extra visits). Region spans (full structural span / confirmed replayed sub-range): m1–16 / replay **m9–15** (ending 1 = m16 only, ending 2 = m17); m17–25 / replay **m18–22** (ending 1 = m23–25, ending 2 = m26–28); m26–36 / replay **m29–35** (ending 1 = m36 only, ending 2 = m37); m37–61 / replay **m54–58** (ending 1 = m59–61, **no ending 2 marked**, so it falls through to m62 unmarked). Zero ties. 12 steps carry a `graceBefore` (grace notes interact correctly with the per-pass walk, verified in `PracticeEngine.repeatLinearity.test.ts`). |
| `chase-setsuna-yuki.musicxml` | No | Confirmed exact identity `PlaybackOrder` |
| `constant-moderato.musicxml` | No | Confirmed exact identity `PlaybackOrder` |
| `if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml` | No | Confirmed exact identity `PlaybackOrder` |
| `morns-like-these-honkai-star-rail.musicxml` | No | Confirmed exact identity `PlaybackOrder` |
| `playright-fanfare.musicxml` | No | Confirmed exact identity `PlaybackOrder` |
| `glimpse-of-us-joji.mxl` | No | Confirmed exact identity `PlaybackOrder` |
| `kyrie-eleison.mxl` | No | Confirmed exact identity `PlaybackOrder` |
| `river-flows-in-you.mxl` | No | Confirmed exact identity `PlaybackOrder` |
| `tetoris.mxl` | No | Confirmed exact identity `PlaybackOrder` |

No fixture anywhere has segno/coda/D.C./D.S. markup (R3 remains fixture-less, as noted above).
