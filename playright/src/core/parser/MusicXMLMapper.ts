import type {
  Finger,
  GraceNoteInfo,
  Hand,
  PlaybackScript,
  ScriptNote,
  StepOrder,
} from '../../types/index.ts';
import { formatPitch, getMidiNumber } from './pitch.ts';
import type { NormalizedControl, NormalizedElement, NormalizedNote } from './MusicXMLNormalizer.ts';

function mapStaffToHand(
  staff: number,
  partIndex: number,
  partCount: number,
  partUsesMultipleStavesInPart: boolean,
): Hand {
  if (partCount === 2 && !partUsesMultipleStavesInPart) {
    return partIndex === 0 ? 'R' : 'L';
  }

  return staff === 2 ? 'L' : 'R';
}

function mapScoreFingering(fingering: number): Finger | null {
  if (fingering >= 1 && fingering <= 5) {
    return fingering as Finger;
  }

  return null;
}

function voiceStreamKey(element: NormalizedNote): string {
  // Staff is intentional: MuseScore (and others) reuse the same voice number on
  // each staff after <backup>, so staff+voice is the stream identity for slurs
  // and default tie lookup. Cross-staff chords and cross-voice ties are handled
  // separately — do not drop staff from this key.
  const partPrefix = element.partCount > 1 ? `${element.partIndex}:` : '';
  return `${partPrefix}${element.staff}:${element.voice}`;
}

function isPlayableNormalizedNote(element: NormalizedElement): element is NormalizedNote {
  return (
    element.type === 'note' &&
    !element.isGrace &&
    !element.isRest &&
    element.hasPlayablePitch
  );
}

function nextPlayableNote(
  elements: NormalizedElement[],
  fromIndex: number,
): NormalizedNote | null {
  for (let index = fromIndex + 1; index < elements.length; index += 1) {
    const element = elements[index];
    if (isPlayableNormalizedNote(element)) {
      return element;
    }
  }

  return null;
}

/**
 * MusicXML `<chord/>` means "same onset as the immediately preceding note in
 * document order". That is positional, not voice-scoped — cross-staff chord
 * tones keep the tag while changing `<staff>`. Do not consult voiceStreamKey.
 */
function canFollowWithChordTone(nextNote: NormalizedNote | null): boolean {
  return nextNote !== null && nextNote.isChord;
}

function tieKeyForElement(element: NormalizedNote): string {
  // Pitch identity for ties is step+octave (not alter): MusicXML cross-measure
  // ties often disagree on written alter after a natural/accidental while still
  // naming the same tied pitch. Dense same-pitch polyphony is disambiguated by
  // voiceStreamKey first and by refusing ambiguous pitch-only fallbacks.
  return `${voiceStreamKey(element)}:${element.step}:${element.octave}`;
}

function tiePitchSuffix(element: NormalizedNote): string {
  return `${element.step}:${element.octave}`;
}

function tieKeyPartPrefix(element: NormalizedNote): string {
  return element.partCount > 1 ? `${element.partIndex}:` : '';
}

/**
 * Resolve an open-tie entry for a stop/continue. Strict staff:voice:pitch first;
 * then a unique same-pitch open tie in the same part (MuseScore often reassigns
 * voice on export). Ambiguous pitch matches are refused so dense polyphony
 * cannot graft onto the wrong note — caller must create a normal note instead.
 */
function findOpenTieMatch(
  openTies: Map<string, number>,
  element: NormalizedNote,
): { key: string; index: number } | null {
  const strictKey = tieKeyForElement(element);
  const strictIndex = openTies.get(strictKey);
  if (strictIndex !== undefined) {
    return { key: strictKey, index: strictIndex };
  }

  const partPrefix = tieKeyPartPrefix(element);
  const pitchSuffix = tiePitchSuffix(element);
  const pitchMatches: Array<{ key: string; index: number }> = [];

  for (const [key, index] of openTies) {
    if (partPrefix && !key.startsWith(partPrefix)) {
      continue;
    }
    if (!key.endsWith(`:${pitchSuffix}`)) {
      continue;
    }
    // Multi-part keys look like "0:1:1:C:4"; single-part like "1:1:C:4".
    // When this element has no part prefix, skip keys that carry one.
    if (!partPrefix && /^\d+:\d+:\d+:/.test(key)) {
      continue;
    }
    pitchMatches.push({ key, index });
  }

  if (pitchMatches.length === 1) {
    return pitchMatches[0];
  }

  return null;
}

function toCanonicalDuration(
  duration: number,
  divisionsAtNote: number,
  canonicalDivisionsPerQuarter: number,
): number {
  if (duration === 0) {
    return 0;
  }

  if (divisionsAtNote <= 0) {
    return duration;
  }

  return Math.round((duration * canonicalDivisionsPerQuarter) / divisionsAtNote);
}

function mergeOpenTie(
  openTies: Map<string, number>,
  tieKey: string,
  absoluteNotes: Array<{ note: ScriptNote; onset: number }>,
  addedDuration: number,
  closeTie: boolean,
): boolean {
  const tiedNoteIndex = openTies.get(tieKey);
  if (tiedNoteIndex === undefined) {
    return false;
  }

  const tiedNote = absoluteNotes[tiedNoteIndex].note;
  tiedNote.durationDivisions = (tiedNote.durationDivisions ?? 0) + addedDuration;

  if (closeTie) {
    tiedNote.tiedToNext = false;
    openTies.delete(tieKey);
  }

  return true;
}

function clearDanglingOpenTies(
  openTies: Map<string, number>,
  absoluteNotes: Array<{ note: ScriptNote; onset: number; measureNumber: number }>,
  warnings: string[],
): void {
  for (const tiedNoteIndex of openTies.values()) {
    const entry = absoluteNotes[tiedNoteIndex];
    entry.note.tiedToNext = false;
    warnings.push(
      `A tie starting at onset ${entry.onset} (measure ${entry.measureNumber}, ${entry.note.pitch}) has no matching stop; treating as a non-tied note.`,
    );
  }

  openTies.clear();
}

function registerOpenTie(
  openTies: Map<string, number>,
  tieKey: string,
  absoluteNotes: Array<{ note: ScriptNote; onset: number }>,
  noteIndex: number,
): void {
  const existingIndex = openTies.get(tieKey);
  if (existingIndex !== undefined) {
    absoluteNotes[existingIndex].note.tiedToNext = false;
  }

  openTies.set(tieKey, noteIndex);
}

function slurKeyFor(voiceKey: string, slurNumber: number): string {
  return `${voiceKey}:${slurNumber}`;
}

function addOpenSlurNumber(
  openSlurNumbersByVoice: Map<string, Set<number>>,
  voiceKey: string,
  slurNumber: number,
): void {
  const existing = openSlurNumbersByVoice.get(voiceKey);
  if (existing) {
    existing.add(slurNumber);
  } else {
    openSlurNumbersByVoice.set(voiceKey, new Set([slurNumber]));
  }
}

function removeOpenSlurNumber(
  openSlurNumbersByVoice: Map<string, Set<number>>,
  voiceKey: string,
  slurNumber: number,
): void {
  openSlurNumbersByVoice.get(voiceKey)?.delete(slurNumber);
}

/**
 * Every genuinely new note created in a voice while a slur is open becomes a
 * member. The XML `<slur>` tag only marks the start/stop note, and notes in
 * between inherit membership implicitly (mirrors how a chord sibling inherits
 * onset from its anchor by document-order position, not an explicit tag).
 * Tie-continuation notes (merge into an earlier ScriptNote, create nothing
 * new) and grace notes (never become members) must never call this.
 */
function appendToOpenSlurs(
  openSlurs: Map<string, number[]>,
  openSlurNumbersByVoice: Map<string, Set<number>>,
  voiceKey: string,
  noteIndex: number,
): void {
  const numbers = openSlurNumbersByVoice.get(voiceKey);
  if (!numbers) {
    return;
  }

  for (const slurNumber of numbers) {
    openSlurs.get(slurKeyFor(voiceKey, slurNumber))?.push(noteIndex);
  }
}

/**
 * Open a slur accumulator. `firstMemberIndex` is null when the start lands on
 * a grace note (delegates to whatever main note appends next). A colliding
 * re-start silently discards the orphaned prior members (never finalized, so
 * nothing is ever mismarked), the same degrade-safe posture as registerOpenTie.
 */
function openSlur(
  openSlurs: Map<string, number[]>,
  openSlurNumbersByVoice: Map<string, Set<number>>,
  voiceKey: string,
  slurNumber: number,
  firstMemberIndex: number | null,
): void {
  openSlurs.set(
    slurKeyFor(voiceKey, slurNumber),
    firstMemberIndex === null ? [] : [firstMemberIndex],
  );
  addOpenSlurNumber(openSlurNumbersByVoice, voiceKey, slurNumber);
}

/**
 * Close a slur. Every accumulated member except the last connects legato into
 * the next note (the last member is the phrase-ending note and keeps its own
 * normal gap). A dangling/unopened stop or an empty (grace-to-grace) member
 * list is a safe no-op, since there is nothing to mark either way.
 */
function closeSlur(
  openSlurs: Map<string, number[]>,
  openSlurNumbersByVoice: Map<string, Set<number>>,
  absoluteNotes: Array<{ note: ScriptNote; onset: number }>,
  voiceKey: string,
  slurNumber: number,
): void {
  const key = slurKeyFor(voiceKey, slurNumber);
  const members = openSlurs.get(key);
  if (members === undefined) {
    return;
  }

  for (let index = 0; index < members.length - 1; index += 1) {
    absoluteNotes[members[index]].note.slurLegatoNext = true;
  }

  openSlurs.delete(key);
  removeOpenSlurNumber(openSlurNumbersByVoice, voiceKey, slurNumber);
}

/** Slur starts with no matching stop by end of the voice/piece are discarded with a warning, never inventing legato to end-of-piece. */
function clearDanglingOpenSlurs(
  openSlurs: Map<string, number[]>,
  absoluteNotes: Array<{ note: ScriptNote; onset: number; measureNumber: number }>,
  warnings: string[],
): void {
  for (const members of openSlurs.values()) {
    if (members.length === 0) {
      warnings.push(
        'A slur start on a grace run has no matching stop before the next main note; no legato applied.',
      );
      continue;
    }

    const first = absoluteNotes[members[0]];
    warnings.push(
      `A slur starting at onset ${first.onset} (measure ${first.measureNumber}) has no matching stop; no legato applied.`,
    );
  }

  openSlurs.clear();
}

function fullMeasureDurationDivisions(
  element: NormalizedNote,
  canonicalDivisionsPerQuarter: number,
): number {
  const measureDuration =
    (element.timeBeats * element.divisionsAtNote * 4) / element.timeBeatType;

  return toCanonicalDuration(
    measureDuration,
    element.divisionsAtNote,
    canonicalDivisionsPerQuarter,
  );
}

function timeAdvanceForSkippedNote(
  element: NormalizedNote,
  canonicalDivisionsPerQuarter: number,
): number {
  if (element.duration > 0) {
    return toCanonicalDuration(
      element.duration,
      element.divisionsAtNote,
      canonicalDivisionsPerQuarter,
    );
  }

  if (element.isRest && element.isMeasureRest) {
    return fullMeasureDurationDivisions(element, canonicalDivisionsPerQuarter);
  }

  return 0;
}

function controlTimeAdvance(
  element: NormalizedControl,
  canonicalDivisionsPerQuarter: number,
): number {
  return toCanonicalDuration(
    element.duration,
    element.divisionsAtNote,
    canonicalDivisionsPerQuarter,
  );
}

/**
 * Piano cannot strike the same key twice at one onset. Piano scores often
 * encode that pitch twice anyway: a visible short value plus a hidden
 * (`print-object="no"`) sustain voice after `<backup>`. Keeping both makes
 * play mode triggerAttack/triggerRelease the same Sampler pitch at the same
 * audio time, which can swallow the rest of that step's attacks.
 *
 * Collapse to one ScriptNote per (hand, midi), keeping the longest written
 * duration so the hidden sustain still holds.
 */
function mergeUnisonNotes(existing: ScriptNote, incoming: ScriptNote): ScriptNote {
  const existingDuration = existing.durationDivisions ?? 0;
  const incomingDuration = incoming.durationDivisions ?? 0;
  const longer = incomingDuration > existingDuration ? incoming : existing;
  const merged: ScriptNote = { ...longer };

  merged.finger = existing.finger ?? incoming.finger;
  if (existing.fingerSource !== undefined) {
    merged.fingerSource = existing.fingerSource;
  } else if (incoming.fingerSource !== undefined) {
    merged.fingerSource = incoming.fingerSource;
  }
  if (existing.playingHand !== undefined) {
    merged.playingHand = existing.playingHand;
  } else if (incoming.playingHand !== undefined) {
    merged.playingHand = incoming.playingHand;
  }

  if (existing.tiedToNext || incoming.tiedToNext) {
    merged.tiedToNext = true;
  }
  if (existing.hasFermata || incoming.hasFermata) {
    merged.hasFermata = true;
  }
  if (existing.slurLegatoNext || incoming.slurLegatoNext) {
    merged.slurLegatoNext = true;
  }
  if (existing.hasAccent || incoming.hasAccent) {
    merged.hasAccent = true;
  }

  return merged;
}

function collapseSimultaneousUnisonNotes(notes: ScriptNote[]): ScriptNote[] {
  const merged: ScriptNote[] = [];
  const indexByKey = new Map<string, number>();

  for (const note of notes) {
    const key = `${note.hand}:${note.midi}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...note });
      continue;
    }

    merged[existingIndex] = mergeUnisonNotes(merged[existingIndex], note);
  }

  return merged;
}

function groupByOnset(
  absoluteNotes: Array<{
    note: ScriptNote;
    onset: number;
    measureNumber: number;
    graceBefore?: GraceNoteInfo[];
  }>,
): PlaybackScript {
  const sorted = [...absoluteNotes].sort((left, right) => left.onset - right.onset);

  const script: PlaybackScript = [];
  let order = 0;

  for (let index = 0; index < sorted.length; ) {
    const onset = sorted[index].onset;
    const measureNumber = sorted[index].measureNumber;
    const notes: ScriptNote[] = [];
    let graceBefore: GraceNoteInfo[] | undefined;

    while (index < sorted.length && sorted[index].onset === onset) {
      notes.push(sorted[index].note);
      if (sorted[index].graceBefore) {
        graceBefore = sorted[index].graceBefore;
      }
      index += 1;
    }

    const step: StepOrder = {
      order,
      onset,
      measureNumber,
      notes: collapseSimultaneousUnisonNotes(notes),
      ...(graceBefore ? { graceBefore } : {}),
    };
    script.push(step);
    order += 1;
  }

  return script;
}

function partUsesMultipleStaves(elements: NormalizedElement[]): boolean {
  const staves = new Set<number>();

  for (const element of elements) {
    if (element.type === 'note' && element.hasPlayablePitch && !element.isGrace) {
      staves.add(element.staff);
    }
  }

  return staves.size > 1;
}

function createScriptNote(
  element: NormalizedNote,
  canonicalDivisionsPerQuarter: number,
  partUsesMultipleStavesInPart: boolean,
): ScriptNote {
  const finger = mapScoreFingering(element.fingering);

  return {
    pitch: formatPitch(element.step, element.octave, element.alter),
    midi: getMidiNumber(element.step, element.octave, element.alter),
    hand: mapStaffToHand(
      element.staff,
      element.partIndex,
      element.partCount,
      partUsesMultipleStavesInPart,
    ),
    finger,
    durationDivisions: toCanonicalDuration(
      element.duration,
      element.divisionsAtNote,
      canonicalDivisionsPerQuarter,
    ),
    ...(element.isTieStart ? { tiedToNext: true } : {}),
    ...(element.hasFermata ? { hasFermata: true } : {}),
    ...(element.hasStaccato ? { hasStaccato: true } : {}),
    ...(element.hasStaccatissimo ? { hasStaccatissimo: true } : {}),
    ...(element.hasAccent ? { hasAccent: true } : {}),
    ...(element.hasMarcato ? { hasMarcato: true } : {}),
    ...(element.hasTenuto ? { hasTenuto: true } : {}),
    ...(element.hasDetachedLegato ? { hasDetachedLegato: true } : {}),
    ...(finger !== null ? { fingerSource: 'score' as const } : {}),
  };
}

function createGraceNoteInfo(
  element: NormalizedNote,
  partUsesMultipleStavesInPart: boolean,
): GraceNoteInfo {
  return {
    midi: getMidiNumber(element.step, element.octave, element.alter),
    pitch: formatPitch(element.step, element.octave, element.alter),
    hand: mapStaffToHand(
      element.staff,
      element.partIndex,
      element.partCount,
      partUsesMultipleStavesInPart,
    ),
    kind: element.graceSlash ? 'acciaccatura' : 'appoggiatura',
    ...(element.graceStealTime ? { stealTime: element.graceStealTime } : {}),
  };
}

function mergePlaybackScripts(scripts: PlaybackScript[]): PlaybackScript {
  const byOnset = new Map<
    number,
    { measureNumber: number; notes: ScriptNote[]; graceBefore?: GraceNoteInfo[] }
  >();

  for (const script of scripts) {
    for (const step of script) {
      const existing = byOnset.get(step.onset);

      if (existing) {
        existing.notes.push(...step.notes);
        if (step.graceBefore) {
          existing.graceBefore = [...(existing.graceBefore ?? []), ...step.graceBefore];
        }
        continue;
      }

      byOnset.set(step.onset, {
        measureNumber: step.measureNumber,
        notes: [...step.notes],
        ...(step.graceBefore ? { graceBefore: [...step.graceBefore] } : {}),
      });
    }
  }

  const sortedOnsets = [...byOnset.keys()].sort((left, right) => left - right);

  return sortedOnsets.map((onset, order) => {
    const entry = byOnset.get(onset)!;
    return {
      order,
      onset,
      measureNumber: entry.measureNumber,
      notes: collapseSimultaneousUnisonNotes(entry.notes),
      ...(entry.graceBefore ? { graceBefore: entry.graceBefore } : {}),
    };
  });
}

export interface MapToDomainResult {
  script: PlaybackScript;
  /** Canonical-division cursor after walking the full part timeline (includes rests). */
  finalTimelineDivisions: number;
  /** Non-fatal parse notices (currently dangling slur starts). */
  warnings: string[];
}

export { getMidiNumber, formatPitch } from './pitch.ts';
export { mergePlaybackScripts };

export class MusicXMLMapper {
  static mapToDomain(
    elements: NormalizedElement[],
    canonicalDivisionsPerQuarter: number,
  ): MapToDomainResult {
    let currentTime = 0;
    let chordAnchorEligible = false;
    let chordAnchorOnset = 0;
    let pendingTimeAdvance = 0;
    let pendingGraceNotes: GraceNoteInfo[] = [];
    const absoluteNotes: Array<{
      note: ScriptNote;
      onset: number;
      measureNumber: number;
      graceBefore?: GraceNoteInfo[];
    }> = [];
    const openTies = new Map<string, number>();
    const openSlurs = new Map<string, number[]>();
    const openSlurNumbersByVoice = new Map<string, Set<number>>();
    const warnings: string[] = [];
    const multiStaffPart = partUsesMultipleStaves(elements);

    const flushPendingTimeAdvance = (): void => {
      if (pendingTimeAdvance > 0) {
        currentTime += pendingTimeAdvance;
        pendingTimeAdvance = 0;
      }
    };

    const invalidateChordAnchor = (): void => {
      chordAnchorEligible = false;
      flushPendingTimeAdvance();
    };

    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];

      if (element.type === 'backup') {
        currentTime = Math.max(
          0,
          currentTime - controlTimeAdvance(element, canonicalDivisionsPerQuarter),
        );
        invalidateChordAnchor();
        continue;
      }

      if (element.type === 'forward') {
        currentTime += controlTimeAdvance(element, canonicalDivisionsPerQuarter);
        invalidateChordAnchor();
        continue;
      }

      if (element.type !== 'note') {
        continue;
      }

      if (element.isGrace) {
        if (element.hasPlayablePitch) {
          pendingGraceNotes.push(createGraceNoteInfo(element, multiStaffPart));

          // Graces never become slur members (GraceNoteInfo carries no flag).
          // A stop delegates to whatever main note(s) already accumulated
          // since the slur opened (empty when it never reached one, as in a
          // grace-to-grace slur, which is a correct no-op). A start delegates
          // forward, opened with no first member and seeded by the next new
          // note appended via appendToOpenSlurs below.
          const graceVoiceKey = voiceStreamKey(element);
          for (const slurNumber of element.slurStops) {
            closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, graceVoiceKey, slurNumber);
          }
          for (const slurNumber of element.slurStarts) {
            openSlur(openSlurs, openSlurNumbersByVoice, graceVoiceKey, slurNumber, null);
          }
        }
        continue;
      }

      const noteDuration = toCanonicalDuration(
        element.duration,
        element.divisionsAtNote,
        canonicalDivisionsPerQuarter,
      );

      if (element.isRest) {
        currentTime += timeAdvanceForSkippedNote(element, canonicalDivisionsPerQuarter);
        invalidateChordAnchor();
        continue;
      }

      if (!element.hasPlayablePitch) {
        currentTime += timeAdvanceForSkippedNote(element, canonicalDivisionsPerQuarter);
        invalidateChordAnchor();
        continue;
      }

      const voiceKey = voiceStreamKey(element);
      // Chord stacking is document-order positional (see canFollowWithChordTone).
      // Do not require a matching voiceStreamKey — cross-staff <chord/> tones
      // change staff while remaining chord siblings of the prior note.
      const effectiveIsChord =
        element.isChord &&
        chordAnchorEligible &&
        (currentTime === chordAnchorOnset ||
          (pendingTimeAdvance > 0 &&
            currentTime === chordAnchorOnset + pendingTimeAdvance));
      const nextNote = nextPlayableNote(elements, elementIndex);

      if (!effectiveIsChord) {
        flushPendingTimeAdvance();
      }

      const tieKey = tieKeyForElement(element);
      const isTieEnd = element.isTieStop && !element.isTieStart;
      const isTieMiddle = element.isTieStop && element.isTieStart;
      const openTieMatch =
        element.isTieStop || element.isTieStart
          ? findOpenTieMatch(openTies, element)
          : null;
      const isImplicitTieContinue =
        element.isTieStart &&
        !element.isTieStop &&
        openTieMatch !== null &&
        openTieMatch.key === tieKey;

      if (isTieEnd || isTieMiddle || isImplicitTieContinue) {
        if (openTieMatch !== null) {
          // Captured BEFORE merging, because mergeOpenTie may delete this tie's
          // entry when it closes. A tie-stop merges into an earlier ScriptNote
          // rather than creating a new one, so a slur boundary on this element
          // must resolve to that MERGED note, never a phantom new entry.
          const tieMergeTargetIndex = openTieMatch.index;
          mergeOpenTie(
            openTies,
            openTieMatch.key,
            absoluteNotes,
            noteDuration,
            isTieEnd,
          );

          // No appendToOpenSlurs here. This note isn't a new voice member
          // but extends the already-accumulated merge target.
          for (const slurNumber of element.slurStops) {
            closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, voiceKey, slurNumber);
          }
          for (const slurNumber of element.slurStarts) {
            openSlur(
              openSlurs,
              openSlurNumbersByVoice,
              voiceKey,
              slurNumber,
              tieMergeTargetIndex,
            );
          }

          // Chord tie segments share the cursor advance of their anchor note.
          if (effectiveIsChord) {
            continue;
          }

          invalidateChordAnchor();

          if (canFollowWithChordTone(nextNote)) {
            chordAnchorEligible = true;
            chordAnchorOnset = currentTime;
            pendingTimeAdvance = noteDuration;
          } else {
            currentTime += noteDuration;
          }
          continue;
        }

        // Unmatched tie-stop/continue: never drop the note. Warn and fall
        // through to create it as a normal (or tie-start) note.
        warnings.push(
          `Tie stop for ${element.step}${element.octave} at measure ${element.measureNumber} has no matching start; treating as a normal note.`,
        );
      }

      const scriptNote = createScriptNote(
        element,
        canonicalDivisionsPerQuarter,
        multiStaffPart,
      );

      if (effectiveIsChord && absoluteNotes.length > 0) {
        absoluteNotes.push({
          note: scriptNote,
          onset: chordAnchorOnset,
          measureNumber: element.measureNumber,
        });
        if (element.isTieStart) {
          registerOpenTie(openTies, tieKey, absoluteNotes, absoluteNotes.length - 1);
        }
        appendToOpenSlurs(openSlurs, openSlurNumbersByVoice, voiceKey, absoluteNotes.length - 1);
        for (const slurNumber of element.slurStops) {
          closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, voiceKey, slurNumber);
        }
        for (const slurNumber of element.slurStarts) {
          openSlur(openSlurs, openSlurNumbersByVoice, voiceKey, slurNumber, absoluteNotes.length - 1);
        }

        if (!canFollowWithChordTone(nextNote)) {
          flushPendingTimeAdvance();
        }
      } else {
        absoluteNotes.push({
          note: scriptNote,
          onset: currentTime,
          measureNumber: element.measureNumber,
          ...(pendingGraceNotes.length > 0 ? { graceBefore: pendingGraceNotes } : {}),
        });
        pendingGraceNotes = [];
        if (element.isTieStart) {
          registerOpenTie(openTies, tieKey, absoluteNotes, absoluteNotes.length - 1);
        }
        appendToOpenSlurs(openSlurs, openSlurNumbersByVoice, voiceKey, absoluteNotes.length - 1);
        for (const slurNumber of element.slurStops) {
          closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, voiceKey, slurNumber);
        }
        for (const slurNumber of element.slurStarts) {
          openSlur(openSlurs, openSlurNumbersByVoice, voiceKey, slurNumber, absoluteNotes.length - 1);
        }

        chordAnchorEligible = true;
        chordAnchorOnset = currentTime;

        if (canFollowWithChordTone(nextNote)) {
          pendingTimeAdvance = noteDuration;
        } else {
          currentTime += noteDuration;
        }
      }
    }

    flushPendingTimeAdvance();
    clearDanglingOpenTies(openTies, absoluteNotes, warnings);
    clearDanglingOpenSlurs(openSlurs, absoluteNotes, warnings);

    return {
      script: groupByOnset(absoluteNotes),
      finalTimelineDivisions: currentTime,
      warnings,
    };
  }
}
