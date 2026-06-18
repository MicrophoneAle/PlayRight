import type { Finger, Hand, PlaybackScript, ScriptNote, StepOrder } from '../../types/index.ts';
import { formatPitch, getMidiNumber } from './pitch.ts';
import type { NormalizedElement } from './MusicXMLNormalizer.ts';

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

export { getMidiNumber, formatPitch } from './pitch.ts';

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
          pitch: formatPitch(element.step, element.octave, element.alter),
          midi: getMidiNumber(element.step, element.octave, element.alter),
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
