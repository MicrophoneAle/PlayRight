import type { Finger, Hand, PlaybackScript, ScriptNote, StepOrder } from '../../types/index.ts';
import type { NormalizedElement } from './MusicXMLNormalizer.ts';

const NATURAL_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function getAlterationOffset(step: string): number {
  const suffix = step.slice(1);

  if (suffix.includes('bb') || suffix.includes('♭♭')) {
    return -2;
  }

  if (suffix.includes('##') || suffix.includes('x')) {
    return 2;
  }

  if (suffix.includes('#') || suffix.includes('♯')) {
    return 1;
  }

  if (suffix.includes('b') || suffix.includes('♭')) {
    return -1;
  }

  return 0;
}

export function getMidiNumber(step: string, octave: number): number {
  const trimmed = step.trim();

  if (trimmed.length === 0) {
    return 0;
  }

  const baseLetter = trimmed.charAt(0).toUpperCase();
  const naturalSemitone = NATURAL_SEMITONES[baseLetter];

  if (naturalSemitone === undefined) {
    return 0;
  }

  const alteration = getAlterationOffset(trimmed);
  return (octave + 1) * 12 + naturalSemitone + alteration;
}

function formatPitch(step: string, octave: number): string {
  const trimmedStep = step.trim();
  return trimmedStep.length > 0 ? `${trimmedStep}${octave}` : String(octave);
}

function mapStaffToHand(staff: number): Hand {
  return staff === 2 ? 'L' : 'R';
}

function mapFingering(fingering: number): Finger {
  if (fingering >= 1 && fingering <= 5) {
    return fingering as Finger;
  }

  return 1;
}

function groupByOnset(
  absoluteNotes: Array<{ note: ScriptNote; onset: number }>,
): PlaybackScript {
  const sorted = [...absoluteNotes].sort((left, right) => left.onset - right.onset);

  const script: PlaybackScript = [];
  let order = 0;

  for (let index = 0; index < sorted.length; ) {
    const onset = sorted[index].onset;
    const notes: ScriptNote[] = [];

    while (index < sorted.length && sorted[index].onset === onset) {
      notes.push(sorted[index].note);
      index += 1;
    }

    const step: StepOrder = { order, onset, notes };
    script.push(step);
    order += 1;
  }

  return script;
}

export class MusicXMLMapper {
  static mapToDomain(elements: NormalizedElement[]): PlaybackScript {
    let currentTime = 0;
    const absoluteNotes: Array<{ note: ScriptNote; onset: number }> = [];

    for (const element of elements) {
      if (element.type === 'backup') {
        currentTime -= element.duration;
        continue;
      }

      if (element.type === 'forward') {
        currentTime += element.duration;
        continue;
      }

      if (element.type === 'note') {
        if (element.isRest || element.isGrace || element.isTieStop) {
          currentTime += element.duration;
          continue;
        }

        const scriptNote: ScriptNote = {
          pitch: formatPitch(element.step, element.octave),
          midi: getMidiNumber(element.step, element.octave),
          hand: mapStaffToHand(element.staff),
          finger: mapFingering(element.fingering),
        };

        if (element.isChord && absoluteNotes.length > 0) {
          const chordOnset = absoluteNotes[absoluteNotes.length - 1].onset;
          absoluteNotes.push({ note: scriptNote, onset: chordOnset });
        } else {
          absoluteNotes.push({ note: scriptNote, onset: currentTime });
          currentTime += element.duration;
        }
      }
    }

    return groupByOnset(absoluteNotes);
  }
}
