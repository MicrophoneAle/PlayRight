import { keyAlterForStep } from './pitch.ts';

export interface NormalizedNote {
  type: 'note';
  step: string;
  octave: number;
  alter: number;
  duration: number;
  staff: number;
  fingering: number;
  isRest: boolean;
  isGrace: boolean;
  isTieStart: boolean;
  isTieStop: boolean;
  isChord: boolean;
}

export interface NormalizedControl {
  type: 'backup' | 'forward';
  duration: number;
}

export type NormalizedElement = NormalizedNote | NormalizedControl;

interface KeyContext {
  fifths: number;
}

type RawRecord = Record<string, unknown>;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value != null) {
    return String(value);
  }

  return fallback;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOrderedText(nodes: unknown): unknown {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return undefined;
  }

  const first = nodes[0];
  if (isRecord(first) && '#text' in first) {
    return first['#text'];
  }

  return undefined;
}

function readTieTypesFromWrapper(child: RawRecord, tag: 'tie' | 'tied'): string[] {
  const types: string[] = [];
  const value = child[tag];

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }

      const attrs = isRecord(entry[':@']) ? entry[':@'] : {};
      const type = attrs['@_type'];
      if (typeof type === 'string') {
        types.push(type);
      }
    }
  }

  const wrapperAttrs = isRecord(child[':@']) ? child[':@'] : {};
  const wrapperType = wrapperAttrs['@_type'];
  if (typeof wrapperType === 'string') {
    types.push(wrapperType);
  }

  return types;
}

function orderedChildrenToRecord(children: unknown[]): RawRecord {
  const record: RawRecord = {};

  for (const child of children) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (!tag) {
      continue;
    }

    const value = child[tag];

    if (tag === 'chord' || tag === 'rest' || tag === 'grace') {
      record[tag] = true;
      continue;
    }

    if (tag === 'pitch' && Array.isArray(value)) {
      const pitch: RawRecord = {};
      for (const pitchChild of value) {
        if (!isRecord(pitchChild)) {
          continue;
        }

        const pitchTag = Object.keys(pitchChild).find((key) => key !== ':@');
        if (pitchTag === 'step' || pitchTag === 'octave' || pitchTag === 'alter') {
          pitch[pitchTag] = readOrderedText(pitchChild[pitchTag]);
        }
      }
      record.pitch = pitch;
      continue;
    }

    if (tag === 'notations' && Array.isArray(value)) {
      record.notations = orderedNotationsToRecord(value);
      continue;
    }

    if (tag === 'tie') {
      const tieTypes = readTieTypesFromWrapper(child, 'tie');
      if (tieTypes.length > 0) {
        record.tie = tieTypes.map((type) => ({ '@_type': type }));
      }
      continue;
    }

    record[tag] = readOrderedText(value);
  }

  return record;
}

function orderedNotationsToRecord(notationChildren: unknown[]): RawRecord {
  const record: RawRecord = {};
  const tied: RawRecord[] = [];

  for (const child of notationChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');

    if (tag === 'tied') {
      for (const type of readTieTypesFromWrapper(child, 'tied')) {
        tied.push({ '@_type': type });
      }
      continue;
    }

    if (tag !== 'technical' || !Array.isArray(child.technical)) {
      continue;
    }

    const technical: RawRecord = {};
    for (const technicalChild of child.technical) {
      if (!isRecord(technicalChild) || !Array.isArray(technicalChild.fingering)) {
        continue;
      }

      technical.fingering = readOrderedText(technicalChild.fingering);
    }

    record.technical = technical;
  }

  if (tied.length > 0) {
    record.tied = tied;
  }

  return record;
}

function extractFingering(note: RawRecord): number {
  const notations = note.notations;
  if (!isRecord(notations)) {
    return 0;
  }

  const technical = notations.technical;
  if (!isRecord(technical)) {
    return 0;
  }

  const fingering = technical.fingering;
  const primary =
    Array.isArray(fingering) ? fingering[0] : fingering;

  return toNumber(primary, 0);
}

function getTieTypes(note: RawRecord): string[] {
  const types: string[] = [];

  for (const entry of asArray(note.tie)) {
    if (isRecord(entry) && typeof entry['@_type'] === 'string') {
      types.push(entry['@_type']);
    }
  }

  const notations = note.notations;
  if (isRecord(notations)) {
    for (const entry of asArray(notations.tied)) {
      if (isRecord(entry) && typeof entry['@_type'] === 'string') {
        types.push(entry['@_type']);
      }
    }
  }

  return types;
}

function hasTieStop(note: RawRecord): boolean {
  return getTieTypes(note).includes('stop');
}

function hasTieStart(note: RawRecord): boolean {
  return getTieTypes(note).includes('start');
}

function extractKeyFifths(attributesChildren: unknown[]): number | null {
  for (const child of attributesChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (tag !== 'key' || !Array.isArray(child.key)) {
      continue;
    }

    for (const keyChild of child.key) {
      if (!isRecord(keyChild)) {
        continue;
      }

      const keyTag = Object.keys(keyChild).find((key) => key !== ':@');
      if (keyTag === 'fifths') {
        return toNumber(readOrderedText(keyChild.fifths), 0);
      }
    }
  }

  return null;
}

function normalizeNote(rawNote: unknown, keyContext: KeyContext): NormalizedNote {
  const note = isRecord(rawNote) ? rawNote : {};
  const pitch = isRecord(note.pitch) ? note.pitch : {};
  const step = toString(pitch.step, '').trim().charAt(0).toUpperCase();
  const octave = toNumber(pitch.octave, 0);
  const hasExplicitAlter = pitch.alter !== undefined && pitch.alter !== null;
  const explicitAlter = hasExplicitAlter ? toNumber(pitch.alter, 0) : null;

  return {
    type: 'note',
    step,
    octave,
    alter:
      explicitAlter !== null ? explicitAlter : keyAlterForStep(step, keyContext.fifths),
    duration: toNumber(note.duration, 0),
    staff: toNumber(note.staff, 1),
    fingering: extractFingering(note),
    isRest: note.rest != null,
    isGrace: note.grace != null,
    isTieStart: hasTieStart(note),
    isTieStop: hasTieStop(note),
    isChord: note.chord != null,
  };
}

function normalizeControl(
  type: 'backup' | 'forward',
  rawControl: unknown,
): NormalizedControl {
  const control = isRecord(rawControl) ? rawControl : {};

  return {
    type,
    duration: toNumber(control.duration, 0),
  };
}

function collectOrderedMeasureElements(
  measureChildren: unknown[],
  results: NormalizedElement[],
  keyContext: KeyContext,
): void {
  for (const child of measureChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (!tag) {
      continue;
    }

    if (tag === 'attributes' && Array.isArray(child.attributes)) {
      const fifths = extractKeyFifths(child.attributes);
      if (fifths !== null) {
        keyContext.fifths = fifths;
      }
      continue;
    }

    if (tag === 'note' && Array.isArray(child.note)) {
      results.push(normalizeNote(orderedChildrenToRecord(child.note), keyContext));
      continue;
    }

    if ((tag === 'backup' || tag === 'forward') && Array.isArray(child[tag])) {
      results.push(
        normalizeControl(tag, orderedChildrenToRecord(child[tag] as unknown[])),
      );
    }
  }
}

function normalizePreserveOrder(rawXmlObj: unknown[]): NormalizedElement[] {
  const results: NormalizedElement[] = [];
  const scorePartwiseEntry = rawXmlObj.find(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );

  if (!isRecord(scorePartwiseEntry)) {
    return results;
  }

  const scorePartwise = scorePartwiseEntry['score-partwise'];
  if (!Array.isArray(scorePartwise)) {
    return results;
  }

  const partEntry = scorePartwise.find(
    (entry) => isRecord(entry) && entry.part != null,
  );

  if (!isRecord(partEntry) || !Array.isArray(partEntry.part)) {
    return results;
  }

  const keyContext: KeyContext = { fifths: 0 };

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    collectOrderedMeasureElements(measureWrapper.measure, results, keyContext);
  }

  return results;
}

export class MusicXMLNormalizer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Phase 2 accepts raw Phase 1 tree
  static normalize(rawXmlObj: any): NormalizedElement[] {
    if (Array.isArray(rawXmlObj)) {
      return normalizePreserveOrder(rawXmlObj);
    }

    return [];
  }
}

const DEFAULT_TEMPO_BPM = 100;
const DEFAULT_DIVISIONS_PER_QUARTER = 1;

function extractDivisions(attributesChildren: unknown[]): number | null {
  for (const child of attributesChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (tag === 'divisions') {
      return toNumber(readOrderedText(child.divisions), 0);
    }
  }

  return null;
}

function readTempoFromSoundWrapper(child: RawRecord): number | null {
  const attrs = isRecord(child[':@']) ? child[':@'] : {};
  const tempo = attrs['@_tempo'];

  if (typeof tempo === 'number' && tempo > 0) {
    return tempo;
  }

  if (typeof tempo === 'string' && tempo.trim().length > 0) {
    const parsed = Number(tempo);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function extractTempoFromDirectionChildren(directionChildren: unknown[]): number | null {
  for (const child of directionChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');

    if (tag === 'sound') {
      const tempo = readTempoFromSoundWrapper(child);
      if (tempo !== null) {
        return tempo;
      }
      continue;
    }

    if (tag !== 'direction-type' || !Array.isArray(child['direction-type'])) {
      continue;
    }

    for (const directionTypeChild of child['direction-type']) {
      if (!isRecord(directionTypeChild) || !Array.isArray(directionTypeChild.metronome)) {
        continue;
      }

      for (const metronomeChild of directionTypeChild.metronome) {
        if (!isRecord(metronomeChild)) {
          continue;
        }

        const metronomeTag = Object.keys(metronomeChild).find((key) => key !== ':@');
        if (metronomeTag === 'per-minute') {
          const tempo = toNumber(readOrderedText(metronomeChild['per-minute']), 0);
          if (tempo > 0) {
            return tempo;
          }
        }
      }
    }
  }

  return null;
}

function extractTempoFromMeasureChildren(measureChildren: unknown[]): number | null {
  for (const child of measureChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');

    if (tag === 'sound') {
      const tempo = readTempoFromSoundWrapper(child);
      if (tempo !== null) {
        return tempo;
      }
      continue;
    }

    if (tag === 'direction' && Array.isArray(child.direction)) {
      const tempo = extractTempoFromDirectionChildren(child.direction);
      if (tempo !== null) {
        return tempo;
      }
    }
  }

  return null;
}

function resolveDivisionsPerQuarter(observed: number[]): number {
  if (observed.length === 0) {
    return DEFAULT_DIVISIONS_PER_QUARTER;
  }

  const counts = new Map<number, number>();
  let dominant = observed[0];
  let dominantCount = 0;

  for (const divisions of observed) {
    const count = (counts.get(divisions) ?? 0) + 1;
    counts.set(divisions, count);

    if (count > dominantCount) {
      dominantCount = count;
      dominant = divisions;
    }
  }

  return dominant;
}

function collectScoreTiming(rawXmlObj: unknown[]): {
  divisionsPerQuarter: number;
  tempoBpm: number;
} {
  const divisionsValues: number[] = [];
  let tempoBpm: number | null = null;

  const scorePartwiseEntry = rawXmlObj.find(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );

  if (!isRecord(scorePartwiseEntry) || !Array.isArray(scorePartwiseEntry['score-partwise'])) {
    return {
      divisionsPerQuarter: DEFAULT_DIVISIONS_PER_QUARTER,
      tempoBpm: DEFAULT_TEMPO_BPM,
    };
  }

  const partEntry = scorePartwiseEntry['score-partwise'].find(
    (entry) => isRecord(entry) && entry.part != null,
  );

  if (!isRecord(partEntry) || !Array.isArray(partEntry.part)) {
    return {
      divisionsPerQuarter: DEFAULT_DIVISIONS_PER_QUARTER,
      tempoBpm: DEFAULT_TEMPO_BPM,
    };
  }

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    if (tempoBpm === null) {
      const measureTempo = extractTempoFromMeasureChildren(measureWrapper.measure);
      if (measureTempo !== null) {
        tempoBpm = measureTempo;
      }
    }

    for (const child of measureWrapper.measure) {
      if (!isRecord(child)) {
        continue;
      }

      const tag = Object.keys(child).find((key) => key !== ':@');
      if (tag !== 'attributes' || !Array.isArray(child.attributes)) {
        continue;
      }

      const divisions = extractDivisions(child.attributes);
      if (divisions !== null && divisions > 0) {
        divisionsValues.push(divisions);
      }
    }
  }

  return {
    divisionsPerQuarter: resolveDivisionsPerQuarter(divisionsValues),
    tempoBpm: tempoBpm ?? DEFAULT_TEMPO_BPM,
  };
}

export function extractScoreTiming(rawXmlObj: unknown): {
  divisionsPerQuarter: number;
  tempoBpm: number;
} {
  if (Array.isArray(rawXmlObj)) {
    return collectScoreTiming(rawXmlObj);
  }

  return {
    divisionsPerQuarter: DEFAULT_DIVISIONS_PER_QUARTER,
    tempoBpm: DEFAULT_TEMPO_BPM,
  };
}
