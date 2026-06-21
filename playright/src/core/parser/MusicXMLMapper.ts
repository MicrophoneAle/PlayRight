import type { Finger, Hand, PlaybackScript, ScriptNote, StepOrder } from '../../types/index.ts';
import { ONSET_MERGE_TOLERANCE_DIVISIONS } from '../playbackTiming.ts';
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

function tieKeyForElement(element: NormalizedNote): string {
  const partPrefix = element.partCount > 1 ? `${element.partIndex}:` : '';
  return `${partPrefix}${element.staff}:${element.voice}:${element.step}:${element.octave}`;
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
  absoluteNotes: Array<{ note: ScriptNote; onset: number; measureNumber: number }>,
  onsetMergeToleranceDivisions = ONSET_MERGE_TOLERANCE_DIVISIONS,
): PlaybackScript {
  const sorted = [...absoluteNotes].sort((left, right) => left.onset - right.onset);

  const script: PlaybackScript = [];
  let order = 0;

  for (let index = 0; index < sorted.length; ) {
    const clusterOnset = sorted[index].onset;
    const measureNumber = sorted[index].measureNumber;
    const notes: ScriptNote[] = [];

    while (
      index < sorted.length &&
      sorted[index].onset - clusterOnset <= onsetMergeToleranceDivisions
    ) {
      notes.push(sorted[index].note);
      index += 1;
    }

    const step: StepOrder = { order, onset: clusterOnset, measureNumber, notes };
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

function mergePlaybackScripts(
  scripts: PlaybackScript[],
  onsetMergeToleranceDivisions = ONSET_MERGE_TOLERANCE_DIVISIONS,
): PlaybackScript {
  const byOnset = new Map<number, { measureNumber: number; notes: ScriptNote[] }>();

  for (const script of scripts) {
    for (const step of script) {
      let matchedOnset: number | undefined;

      for (const existingOnset of byOnset.keys()) {
        if (Math.abs(existingOnset - step.onset) <= onsetMergeToleranceDivisions) {
          matchedOnset = existingOnset;
          break;
        }
      }

      const targetOnset = matchedOnset ?? step.onset;
      const existing = byOnset.get(targetOnset);

      if (existing) {
        existing.notes.push(...step.notes);
        continue;
      }

      byOnset.set(targetOnset, {
        measureNumber: step.measureNumber,
        notes: [...step.notes],
      });
    }
  }

  const sortedOnsets = [...byOnset.keys()].sort((left, right) => left - right);

  return sortedOnsets.map((onset, order) => ({
    order,
    onset,
    measureNumber: byOnset.get(onset)!.measureNumber,
    notes: byOnset.get(onset)!.notes,
  }));
}

export { getMidiNumber, formatPitch } from './pitch.ts';
export { mergePlaybackScripts };

export class MusicXMLMapper {
  static mapToDomain(
    elements: NormalizedElement[],
    canonicalDivisionsPerQuarter: number,
  ): PlaybackScript {
    let currentTime = 0;
    let currentBaseOnset = 0;
    const absoluteNotes: Array<{ note: ScriptNote; onset: number; measureNumber: number }> = [];
    const openTies = new Map<string, number>();
    const multiStaffPart = partUsesMultipleStaves(elements);

    for (const element of elements) {
      if (element.type === 'backup') {
        currentTime = Math.max(
          0,
          currentTime - controlTimeAdvance(element, canonicalDivisionsPerQuarter),
        );
        continue;
      }

      if (element.type === 'forward') {
        currentTime += controlTimeAdvance(element, canonicalDivisionsPerQuarter);
        continue;
      }

      if (element.type !== 'note') {
        continue;
      }

      if (element.isGrace) {
        continue;
      }

      const noteDuration = toCanonicalDuration(
        element.duration,
        element.divisionsAtNote,
        canonicalDivisionsPerQuarter,
      );

      if (element.isRest) {
        currentTime += timeAdvanceForSkippedNote(element, canonicalDivisionsPerQuarter);
        continue;
      }

      if (!element.hasPlayablePitch) {
        currentTime += timeAdvanceForSkippedNote(element, canonicalDivisionsPerQuarter);
        continue;
      }

      if (!element.isChord) {
        currentBaseOnset = currentTime;
      }

      const tieKey = tieKeyForElement(element);
      const isTieEnd = element.isTieStop && !element.isTieStart;
      const isTieMiddle = element.isTieStop && element.isTieStart;
      const isImplicitTieContinue =
        element.isTieStart && !element.isTieStop && openTies.has(tieKey);

      if (isTieEnd) {
        if (
          mergeOpenTie(openTies, tieKey, absoluteNotes, noteDuration, true)
        ) {
          currentTime += noteDuration;
          continue;
        }

        currentTime += noteDuration;
        continue;
      }

      if (isTieMiddle || isImplicitTieContinue) {
        if (
          mergeOpenTie(openTies, tieKey, absoluteNotes, noteDuration, false)
        ) {
          currentTime += noteDuration;
          continue;
        }
      }

      const scriptNote = createScriptNote(
        element,
        canonicalDivisionsPerQuarter,
        multiStaffPart,
      );

      if (element.isChord && absoluteNotes.length > 0) {
        absoluteNotes.push({
          note: scriptNote,
          onset: currentBaseOnset,
          measureNumber: element.measureNumber,
        });
        if (element.isTieStart) {
          registerOpenTie(openTies, tieKey, absoluteNotes, absoluteNotes.length - 1);
        }
      } else {
        absoluteNotes.push({
          note: scriptNote,
          onset: currentTime,
          measureNumber: element.measureNumber,
        });
        if (element.isTieStart) {
          registerOpenTie(openTies, tieKey, absoluteNotes, absoluteNotes.length - 1);
        }
        currentTime += noteDuration;
      }
    }

    clearDanglingOpenTies(openTies, absoluteNotes);

    return groupByOnset(absoluteNotes);
  }
}
