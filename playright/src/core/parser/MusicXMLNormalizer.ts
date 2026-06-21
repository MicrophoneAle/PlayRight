import {
  accidentalAlterFromText,
  formatPitch,
  getMidiNumber,
  INVALID_MIDI,
  isPlayablePitchStep,
  isValidPianoMidi,
  keyAlterForStep,
  PIANO_MIDI_MAX,
  PIANO_MIDI_MIN,
} from './pitch.ts';

export interface NormalizedNote {
  type: 'note';
  step: string;
  octave: number;
  alter: number;
  duration: number;
  staff: number;
  voice: number;
  fingering: number;
  isRest: boolean;
  isGrace: boolean;
  isTieStart: boolean;
  isTieStop: boolean;
  isChord: boolean;
  isCue: boolean;
  isUnpitched: boolean;
  isMeasureRest: boolean;
  hasPlayablePitch: boolean;
  timeBeats: number;
  timeBeatType: number;
  divisionsAtNote: number;
  measureNumber: number;
  hasFermata: boolean;
}

export interface NormalizedControl {
  type: 'backup' | 'forward';
  duration: number;
  divisionsAtNote: number;
}

export type NormalizedElement = NormalizedNote | NormalizedControl;

interface MeasureContext {
  fifths: number;
  beats: number;
  beatType: number;
  divisions: number;
  measureNumber: number;
  activeAccidentals: Map<string, number>;
  warnings: string[];
}

export interface NormalizeResult {
  elements: NormalizedElement[];
  warnings: string[];
}

const DEFAULT_BEATS = 4;
const DEFAULT_BEAT_TYPE = 4;
const DEFAULT_DIVISIONS = 1;

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

function readWrapperBooleanAttr(child: RawRecord, attr: string): boolean {
  const attrs = isRecord(child[':@']) ? child[':@'] : {};
  const value = attrs[`@_${attr}`];
  return value === true || value === 'yes';
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

    if (tag === 'chord' || tag === 'grace') {
      record[tag] = true;
      continue;
    }

    if (tag === 'cue') {
      record.cue = true;
      continue;
    }

    if (tag === 'rest') {
      record.rest = true;
      if (readWrapperBooleanAttr(child, 'measure')) {
        record.restMeasureYes = true;
      }
      continue;
    }

    if (tag === 'unpitched') {
      record.unpitched = true;
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

    if (tag === 'accidental') {
      record.accidental = readOrderedText(value);
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

    if (tag === 'fermata') {
      record.fermata = true;
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

function hasFermataNotation(note: RawRecord): boolean {
  const notations = note.notations;
  if (!isRecord(notations)) {
    return false;
  }

  return notations.fermata != null;
}

function extractTimeSignature(
  attributesChildren: unknown[],
): { beats: number; beatType: number } | null {
  for (const child of attributesChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = Object.keys(child).find((key) => key !== ':@');
    if (tag !== 'time' || !Array.isArray(child.time)) {
      continue;
    }

    let beats: number | null = null;
    let beatType: number | null = null;

    for (const timeChild of child.time) {
      if (!isRecord(timeChild)) {
        continue;
      }

      const timeTag = Object.keys(timeChild).find((key) => key !== ':@');
      if (timeTag === 'beats') {
        beats = toNumber(readOrderedText(timeChild.beats), DEFAULT_BEATS);
      } else if (timeTag === 'beat-type') {
        beatType = toNumber(readOrderedText(timeChild['beat-type']), DEFAULT_BEAT_TYPE);
      }
    }

    if (beats !== null && beatType !== null && beatType > 0) {
      return { beats, beatType };
    }
  }

  return null;
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

function pitchAccidentalKey(step: string, octave: number): string {
  return `${step}:${octave}`;
}

function resolveEffectiveAlter(
  step: string,
  octave: number,
  pitch: RawRecord,
  note: RawRecord,
  measureContext: MeasureContext,
): number {
  if (pitch.alter !== undefined && pitch.alter !== null) {
    return toNumber(pitch.alter, 0);
  }

  const accidentalAlter =
    note.accidental !== undefined && note.accidental !== null
      ? accidentalAlterFromText(toString(note.accidental, ''))
      : null;

  const carryKey = pitchAccidentalKey(step, octave);

  if (accidentalAlter !== null) {
    measureContext.activeAccidentals.set(carryKey, accidentalAlter);
    return accidentalAlter;
  }

  const carriedAlter = measureContext.activeAccidentals.get(carryKey);
  if (carriedAlter !== undefined) {
    return carriedAlter;
  }

  return keyAlterForStep(step, measureContext.fifths);
}

function normalizeNote(rawNote: unknown, measureContext: MeasureContext): NormalizedNote {
  const note = isRecord(rawNote) ? rawNote : {};
  const pitch = isRecord(note.pitch) ? note.pitch : {};
  const step = toString(pitch.step, '').trim().charAt(0).toUpperCase();
  const octave = toNumber(pitch.octave, 0);
  const isRest = note.rest != null;
  const isCue = note.cue != null;
  const isUnpitched = note.unpitched != null;
  const isMeasureRest = isRest && note.restMeasureYes === true;
  const alter = resolveEffectiveAlter(step, octave, pitch, note, measureContext);
  let hasPlayablePitch =
    !isRest &&
    !isCue &&
    !isUnpitched &&
    isPlayablePitchStep(step);

  if (hasPlayablePitch) {
    const midi = getMidiNumber(step, octave, alter);
    if (midi === INVALID_MIDI) {
      measureContext.warnings.push(
        `Skipped note ${formatPitch(step, octave, alter)}: unrecognized pitch step "${step}"`,
      );
      hasPlayablePitch = false;
    } else if (!isValidPianoMidi(midi)) {
      measureContext.warnings.push(
        `Skipped note ${formatPitch(step, octave, alter)}: MIDI ${midi} is outside the piano range (${PIANO_MIDI_MIN}-${PIANO_MIDI_MAX})`,
      );
      hasPlayablePitch = false;
    }
  }

  return {
    type: 'note',
    step,
    octave,
    alter,
    duration: toNumber(note.duration, 0),
    staff: toNumber(note.staff, 1),
    voice: toNumber(note.voice, 1),
    fingering: extractFingering(note),
    isRest,
    isGrace: note.grace != null,
    isTieStart: hasTieStart(note),
    isTieStop: hasTieStop(note),
    isChord: note.chord != null,
    isCue,
    isUnpitched,
    isMeasureRest,
    hasPlayablePitch,
    timeBeats: measureContext.beats,
    timeBeatType: measureContext.beatType,
    divisionsAtNote: measureContext.divisions,
    measureNumber: measureContext.measureNumber,
    hasFermata: hasFermataNotation(note),
  };
}

function normalizeControl(
  type: 'backup' | 'forward',
  rawControl: unknown,
  measureContext: MeasureContext,
): NormalizedControl {
  const control = isRecord(rawControl) ? rawControl : {};

  return {
    type,
    duration: toNumber(control.duration, 0),
    divisionsAtNote: measureContext.divisions,
  };
}

function applyAttributesToContext(
  attributesChildren: unknown[],
  measureContext: MeasureContext,
): void {
  const fifths = extractKeyFifths(attributesChildren);
  if (fifths !== null) {
    measureContext.fifths = fifths;
  }

  const timeSignature = extractTimeSignature(attributesChildren);
  if (timeSignature !== null) {
    measureContext.beats = timeSignature.beats;
    measureContext.beatType = timeSignature.beatType;
  }

  const divisions = extractDivisions(attributesChildren);
  if (divisions !== null && divisions > 0) {
    measureContext.divisions = divisions;
  }
}

function collectOrderedMeasureElements(
  measureChildren: unknown[],
  results: NormalizedElement[],
  measureContext: MeasureContext,
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
      applyAttributesToContext(child.attributes, measureContext);
      continue;
    }

    if (tag === 'note' && Array.isArray(child.note)) {
      results.push(
        normalizeNote(orderedChildrenToRecord(child.note), measureContext),
      );
      continue;
    }

    if ((tag === 'backup' || tag === 'forward') && Array.isArray(child[tag])) {
      results.push(
        normalizeControl(tag, orderedChildrenToRecord(child[tag] as unknown[]), measureContext),
      );
      continue;
    }
  }
}

function normalizePreserveOrder(rawXmlObj: unknown[]): NormalizeResult {
  const results: NormalizedElement[] = [];
  const warnings: string[] = [];
  const scorePartwiseEntry = rawXmlObj.find(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );

  if (!isRecord(scorePartwiseEntry)) {
    return { elements: results, warnings };
  }

  const scorePartwise = scorePartwiseEntry['score-partwise'];
  if (!Array.isArray(scorePartwise)) {
    return { elements: results, warnings };
  }

  const partEntry = scorePartwise.find(
    (entry) => isRecord(entry) && entry.part != null,
  );

  if (!isRecord(partEntry) || !Array.isArray(partEntry.part)) {
    return { elements: results, warnings };
  }

  const measureContext: MeasureContext = {
    fifths: 0,
    beats: DEFAULT_BEATS,
    beatType: DEFAULT_BEAT_TYPE,
    divisions: DEFAULT_DIVISIONS,
    measureNumber: 1,
    activeAccidentals: new Map(),
    warnings,
  };

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    const wrapperAttrs = isRecord(measureWrapper[':@']) ? measureWrapper[':@'] : {};
    measureContext.measureNumber = toNumber(wrapperAttrs['@_number'], measureContext.measureNumber);
    measureContext.activeAccidentals.clear();

    collectOrderedMeasureElements(measureWrapper.measure, results, measureContext);
  }

  return { elements: results, warnings };
}

export class MusicXMLNormalizer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Phase 2 accepts raw Phase 1 tree
  static normalize(rawXmlObj: any): NormalizeResult {
    if (Array.isArray(rawXmlObj)) {
      return normalizePreserveOrder(rawXmlObj);
    }

    return { elements: [], warnings: [] };
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

export function resolveCanonicalDivisionsPerQuarter(
  elements: NormalizedElement[],
): number {
  const observed: number[] = [];

  for (const element of elements) {
    if (element.divisionsAtNote > 0) {
      observed.push(element.divisionsAtNote);
    }
  }

  return resolveDivisionsPerQuarter(observed);
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
