import type { Finger, Hand, PlaybackScript, ScriptNote, StepOrder } from '../../types/index.ts';
import {
  HAND_SYNC_MAX_DRIFT_DIVISIONS,
  ONSET_SNAP_GRID_DIVISIONS,
} from '../playbackTiming.ts';
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

function snapOnset(
  onset: number,
  grid = ONSET_SNAP_GRID_DIVISIONS,
): number {
  if (grid <= 1) {
    return onset;
  }

  return Math.round(onset / grid) * grid;
}

function onsetBucketKey(measureNumber: number, onset: number): string {
  return `${measureNumber}:${snapOnset(onset)}`;
}

function mergeCrossHandDriftSteps(
  script: PlaybackScript,
  maxDriftDivisions = HAND_SYNC_MAX_DRIFT_DIVISIONS,
): PlaybackScript {
  if (script.length <= 1) {
    return script;
  }

  const sorted = [...script].sort(
    (left, right) => left.onset - right.onset || left.order - right.order,
  );
  const merged: PlaybackScript = [];

  for (const step of sorted) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      shouldMergeCrossHandSteps(previous, step, maxDriftDivisions)
    ) {
      previous.notes.push(...step.notes);
      previous.onset = Math.min(previous.onset, step.onset);
      continue;
    }

    merged.push({
      order: merged.length,
      onset: step.onset,
      measureNumber: step.measureNumber,
      notes: [...step.notes],
    });
  }

  return merged.map((step, order) => ({ ...step, order }));
}

function shouldMergeCrossHandSteps(
  left: StepOrder,
  right: StepOrder,
  maxDriftDivisions: number,
): boolean {
  if (left.measureNumber !== right.measureNumber) {
    return false;
  }

  if (Math.abs(left.onset - right.onset) > maxDriftDivisions) {
    return false;
  }

  const leftHands = new Set(left.notes.map((note) => note.hand));
  const rightHands = new Set(right.notes.map((note) => note.hand));

  if (leftHands.size > 1 || rightHands.size > 1) {
    return false;
  }

  const combinedHands = new Set([...leftHands, ...rightHands]);
  return combinedHands.size === 2;
}

function groupByOnset(
  absoluteNotes: Array<{ note: ScriptNote; onset: number; measureNumber: number }>,
): PlaybackScript {
  const buckets = new Map<
    string,
    { onset: number; measureNumber: number; notes: ScriptNote[] }
  >();

  for (const entry of absoluteNotes) {
    const key = onsetBucketKey(entry.measureNumber, entry.onset);
    const existing = buckets.get(key);

    if (existing) {
      existing.notes.push(entry.note);
      existing.onset = Math.min(existing.onset, entry.onset);
      continue;
    }

    buckets.set(key, {
      onset: entry.onset,
      measureNumber: entry.measureNumber,
      notes: [entry.note],
    });
  }

  const grouped = [...buckets.values()].sort(
    (left, right) => left.onset - right.onset || left.measureNumber - right.measureNumber,
  );

  return mergeCrossHandDriftSteps(
    grouped.map((step, order) => ({
      order,
      onset: step.onset,
      measureNumber: step.measureNumber,
      notes: step.notes,
    })),
  );
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

function mergePlaybackScripts(scripts: PlaybackScript[]): PlaybackScript {
  const buckets = new Map<
    string,
    { onset: number; measureNumber: number; notes: ScriptNote[] }
  >();

  for (const script of scripts) {
    for (const step of script) {
      const key = onsetBucketKey(step.measureNumber, step.onset);
      const existing = buckets.get(key);

      if (existing) {
        existing.notes.push(...step.notes);
        existing.onset = Math.min(existing.onset, step.onset);
        continue;
      }

      buckets.set(key, {
        onset: step.onset,
        measureNumber: step.measureNumber,
        notes: [...step.notes],
      });
    }
  }

  const grouped = [...buckets.values()].sort(
    (left, right) => left.onset - right.onset || left.measureNumber - right.measureNumber,
  );

  return mergeCrossHandDriftSteps(
    grouped.map((step, order) => ({
      order,
      onset: step.onset,
      measureNumber: step.measureNumber,
      notes: step.notes,
    })),
    HAND_SYNC_MAX_DRIFT_DIVISIONS,
  );
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
