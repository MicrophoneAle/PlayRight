export interface NormalizedNote {
  type: 'note';
  step: string;
  octave: number;
  duration: number;
  staff: number;
  fingering: number;
  isRest: boolean;
  isGrace: boolean;
  isTieStop: boolean;
}

export interface NormalizedControl {
  type: 'backup' | 'forward';
  duration: number;
}

export type NormalizedElement = NormalizedNote | NormalizedControl;

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

function extractFingering(note: RawRecord): number {
  const notations = note.notations;
  if (!isRecord(notations)) {
    return 0;
  }

  const technical = notations.technical;
  if (!isRecord(technical)) {
    return 0;
  }

  return toNumber(technical.fingering, 0);
}

function hasTieStop(note: RawRecord): boolean {
  const tie = note.tie;
  if (tie == null) {
    return false;
  }

  return asArray(tie).some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    return entry['@_type'] === 'stop';
  });
}

function normalizeNote(rawNote: unknown): NormalizedNote {
  const note = isRecord(rawNote) ? rawNote : {};
  const pitch = isRecord(note.pitch) ? note.pitch : {};

  return {
    type: 'note',
    step: toString(pitch.step, ''),
    octave: toNumber(pitch.octave, 0),
    duration: toNumber(note.duration, 0),
    staff: toNumber(note.staff, 1),
    fingering: extractFingering(note),
    isRest: note.rest != null,
    isGrace: note.grace != null,
    isTieStop: hasTieStop(note),
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

function collectMeasureElements(
  measure: unknown,
  results: NormalizedElement[],
): void {
  if (!isRecord(measure)) {
    return;
  }

  for (const [key, value] of Object.entries(measure)) {
    if (key.startsWith('@_')) {
      continue;
    }

    if (key === 'note') {
      for (const rawNote of asArray(value)) {
        results.push(normalizeNote(rawNote));
      }
      continue;
    }

    if (key === 'backup') {
      for (const rawControl of asArray(value)) {
        results.push(normalizeControl('backup', rawControl));
      }
      continue;
    }

    if (key === 'forward') {
      for (const rawControl of asArray(value)) {
        results.push(normalizeControl('forward', rawControl));
      }
    }
  }
}

export class MusicXMLNormalizer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Phase 2 accepts raw Phase 1 tree
  static normalize(rawXmlObj: any): NormalizedElement[] {
    const results: NormalizedElement[] = [];

    if (!isRecord(rawXmlObj)) {
      return results;
    }

    const scorePartwise = rawXmlObj['score-partwise'];
    if (!isRecord(scorePartwise)) {
      return results;
    }

    const parts = asArray(scorePartwise.part);

    for (const part of parts) {
      if (!isRecord(part)) {
        continue;
      }

      for (const measure of asArray(part.measure)) {
        collectMeasureElements(measure, results);
      }
    }

    return results;
  }
}
