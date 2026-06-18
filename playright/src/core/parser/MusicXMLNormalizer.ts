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
  isChord: boolean;
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
        if (pitchTag === 'step' || pitchTag === 'octave') {
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
): void {
  for (const child of measureChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (!tag) {
      continue;
    }

    if (tag === 'note' && Array.isArray(child.note)) {
      results.push(normalizeNote(orderedChildrenToRecord(child.note)));
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

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    collectOrderedMeasureElements(measureWrapper.measure, results);
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
