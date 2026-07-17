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

function canFollowWithChordTone(
  note: NormalizedNote,
  nextNote: NormalizedNote | null,
): boolean {
  if (nextNote === null || !nextNote.isChord) {
    return false;
  }

  return voiceStreamKey(note) === voiceStreamKey(nextNote);
}

function tieKeyForElement(element: NormalizedNote): string {
  return `${voiceStreamKey(element)}:${element.step}:${element.octave}`;
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
  absoluteNotes: Array<{ note: ScriptNote; onset: number }>,
): void {
  for (const tiedNoteIndex of openTies.values()) {
    absoluteNotes[tiedNoteIndex].note.tiedToNext = false;
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
 * member - the XML `<slur>` tag only marks the start/stop note; notes in
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
 * a grace note (delegates to whatever main note appends next); a colliding
 * re-start silently discards the orphaned prior members (never finalized, so
 * nothing is ever mismarked) - same degrade-safe posture as registerOpenTie.
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
 * Close a slur: every accumulated member except the last connects legato into
 * the next note (the last member is the phrase-ending note and keeps its own
 * normal gap). A dangling/unopened stop or an empty (grace-to-grace) member
 * list is a safe no-op - nothing to mark either way.
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

/** Slur starts with no matching stop by end of the voice/piece: discard, warn, never invent legato to end-of-piece. */
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
      notes,
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
      notes: entry.notes,
      ...(entry.graceBefore ? { graceBefore: entry.graceBefore } : {}),
    };
  });
}

export interface MapToDomainResult {
  script: PlaybackScript;
  /** Canonical-division cursor after walking the full part timeline (includes rests). */
  finalTimelineDivisions: number;
  /** Non-fatal parse notices (currently: dangling slur starts). */
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
    let chordAnchorVoiceKey: string | null = null;
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
      chordAnchorVoiceKey = null;
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
          // since the slur opened (empty when it never reached one - a
          // grace-to-grace slur - a correct no-op). A start delegates
          // forward: opened with no first member, seeded by the next new
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
      const effectiveIsChord =
        element.isChord &&
        chordAnchorEligible &&
        chordAnchorVoiceKey === voiceKey &&
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
      const isImplicitTieContinue =
        element.isTieStart && !element.isTieStop && openTies.has(tieKey);

      if (isTieEnd || isTieMiddle || isImplicitTieContinue) {
        // Captured BEFORE merging: mergeOpenTie may delete this tie's entry
        // when it closes. A tie-stop merges into an earlier ScriptNote
        // rather than creating a new one, so a slur boundary on this element
        // must resolve to that MERGED note, never a phantom new entry - and
        // never at all if the "tie" turns out to have no real predecessor
        // (mergeOpenTie finds nothing to merge into).
        const tieMergeTargetIndex = openTies.get(tieKey);
        mergeOpenTie(openTies, tieKey, absoluteNotes, noteDuration, isTieEnd);

        if (tieMergeTargetIndex !== undefined) {
          // No appendToOpenSlurs here: this note isn't a new voice member,
          // it extends the already-accumulated merge target. Appending would
          // double the merge target into the member list and, when a stop
          // lands on this same tie-continuation, wrongly mark it legato
          // instead of leaving it as the correctly-excluded last member.
          for (const slurNumber of element.slurStops) {
            closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, voiceKey, slurNumber);
          }
          for (const slurNumber of element.slurStarts) {
            openSlur(openSlurs, openSlurNumbersByVoice, voiceKey, slurNumber, tieMergeTargetIndex);
          }
        }

        // Chord tie segments share the cursor advance of their anchor note.
        if (effectiveIsChord) {
          continue;
        }

        invalidateChordAnchor();

        if (canFollowWithChordTone(element, nextNote)) {
          chordAnchorEligible = true;
          chordAnchorOnset = currentTime;
          chordAnchorVoiceKey = voiceKey;
          pendingTimeAdvance = noteDuration;
        } else {
          currentTime += noteDuration;
        }
        continue;
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
        // Chord siblings follow the anchor's slur membership by pure
        // document-order position, same as ties: no chord-wide propagation,
        // just the same append/stop/start sequence run for every new note.
        appendToOpenSlurs(openSlurs, openSlurNumbersByVoice, voiceKey, absoluteNotes.length - 1);
        for (const slurNumber of element.slurStops) {
          closeSlur(openSlurs, openSlurNumbersByVoice, absoluteNotes, voiceKey, slurNumber);
        }
        for (const slurNumber of element.slurStarts) {
          openSlur(openSlurs, openSlurNumbersByVoice, voiceKey, slurNumber, absoluteNotes.length - 1);
        }

        if (!canFollowWithChordTone(element, nextNote)) {
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
        chordAnchorVoiceKey = voiceKey;

        if (canFollowWithChordTone(element, nextNote)) {
          pendingTimeAdvance = noteDuration;
        } else {
          currentTime += noteDuration;
        }
      }
    }

    flushPendingTimeAdvance();
    clearDanglingOpenTies(openTies, absoluteNotes);
    clearDanglingOpenSlurs(openSlurs, absoluteNotes, warnings);

    return {
      script: groupByOnset(absoluteNotes),
      finalTimelineDivisions: currentTime,
      warnings,
    };
  }
}
