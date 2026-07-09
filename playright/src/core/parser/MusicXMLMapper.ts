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
        mergeOpenTie(openTies, tieKey, absoluteNotes, noteDuration, isTieEnd);

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

    return {
      script: groupByOnset(absoluteNotes),
      finalTimelineDivisions: currentTime,
    };
  }
}
