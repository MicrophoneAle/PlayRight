/**
 * R0 flow normalizer: surfaces per-measure playback-flow markup — <repeat>
 * (incl. times), <ending> (incl. comma-separated numbers and the discontinue
 * type), and <sound> jump attributes — from the raw preserve-order tree.
 *
 * Flow instructions are read from the first part. When a multi-part score
 * carries disagreeing flow markup across parts, the disagreement is reported
 * as a warning rather than silently resolved.
 */

export interface RepeatFlowInstruction {
  kind: 'repeat';
  direction: 'forward' | 'backward';
  /** Total passes through the repeated region (MusicXML times attribute; default 2). */
  times: number;
}

export interface EndingFlowInstruction {
  kind: 'ending';
  /** Volta numbers from the comma-separated number attribute (default [1]). */
  numbers: number[];
  type: 'start' | 'stop' | 'discontinue';
}

/** MusicXML <sound> attributes that alter playback flow. Surfaced only in R0; not yet resolved. */
export const SOUND_JUMP_ATTRIBUTES = [
  'coda',
  'dacapo',
  'dalsegno',
  'fine',
  'forward-repeat',
  'segno',
  'tocoda',
] as const;

export interface SoundJumpFlowInstruction {
  kind: 'sound-jump';
  /** Jump-relevant attributes exactly as written in the score. */
  attributes: Record<string, string>;
}

export type MeasureFlowInstruction =
  | RepeatFlowInstruction
  | EndingFlowInstruction
  | SoundJumpFlowInstruction;

export interface MeasureFlowEntry {
  /** Document-order measure index within the part (0-based). */
  measureIndex: number;
  /** Resolved MusicXML measure number (carries forward when unparseable, matching the normalizer). */
  measureNumber: number;
  /** Flow instructions in document order within the measure. */
  instructions: MeasureFlowInstruction[];
}

export interface MeasureFlowResult {
  /** One entry per measure of the first part, in document order. */
  measures: MeasureFlowEntry[];
  warnings: string[];
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function attrsOf(node: RawRecord): RawRecord {
  return isRecord(node[':@']) ? node[':@'] : {};
}

function tagOf(node: RawRecord): string | undefined {
  return Object.keys(node).find((key) => key !== ':@');
}

function parseEndingNumbers(value: unknown): number[] {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return [value];
  }

  if (typeof value === 'string') {
    const numbers = value
      .split(',')
      .map((piece) => Number(piece.trim()))
      .filter((parsed) => !Number.isNaN(parsed));
    if (numbers.length > 0) {
      return numbers;
    }
  }

  return [1];
}

function readRepeatInstruction(node: RawRecord): RepeatFlowInstruction | null {
  const attrs = attrsOf(node);
  const direction = attrs['@_direction'];
  if (direction !== 'forward' && direction !== 'backward') {
    return null;
  }

  return {
    kind: 'repeat',
    direction,
    times: Math.max(2, Math.trunc(toNumber(attrs['@_times'], 2))),
  };
}

function readEndingInstruction(node: RawRecord): EndingFlowInstruction | null {
  const attrs = attrsOf(node);
  const type = attrs['@_type'];
  if (type !== 'start' && type !== 'stop' && type !== 'discontinue') {
    return null;
  }

  return {
    kind: 'ending',
    numbers: parseEndingNumbers(attrs['@_number']),
    type,
  };
}

function readSoundJumpInstruction(node: RawRecord): SoundJumpFlowInstruction | null {
  const attrs = attrsOf(node);
  const attributes: Record<string, string> = {};

  for (const name of SOUND_JUMP_ATTRIBUTES) {
    const value = attrs[`@_${name}`];
    if (value !== undefined && value !== null) {
      attributes[name] = String(value);
    }
  }

  if (Object.keys(attributes).length === 0) {
    return null;
  }

  return { kind: 'sound-jump', attributes };
}

function collectMeasureInstructions(measureChildren: unknown[]): MeasureFlowInstruction[] {
  const instructions: MeasureFlowInstruction[] = [];

  for (const child of measureChildren) {
    if (!isRecord(child)) {
      continue;
    }

    const tag = tagOf(child);

    if (tag === 'barline' && Array.isArray(child.barline)) {
      for (const barlineChild of child.barline) {
        if (!isRecord(barlineChild)) {
          continue;
        }

        const barlineTag = tagOf(barlineChild);
        if (barlineTag === 'repeat') {
          const repeat = readRepeatInstruction(barlineChild);
          if (repeat) {
            instructions.push(repeat);
          }
        } else if (barlineTag === 'ending') {
          const ending = readEndingInstruction(barlineChild);
          if (ending) {
            instructions.push(ending);
          }
        }
      }
      continue;
    }

    if (tag === 'sound') {
      const soundJump = readSoundJumpInstruction(child);
      if (soundJump) {
        instructions.push(soundJump);
      }
      continue;
    }

    if (tag === 'direction' && Array.isArray(child.direction)) {
      for (const directionChild of child.direction) {
        if (!isRecord(directionChild) || tagOf(directionChild) !== 'sound') {
          continue;
        }

        const soundJump = readSoundJumpInstruction(directionChild);
        if (soundJump) {
          instructions.push(soundJump);
        }
      }
    }
  }

  return instructions;
}

function extractPartFlow(partEntry: RawRecord): MeasureFlowEntry[] {
  const measures: MeasureFlowEntry[] = [];

  if (!Array.isArray(partEntry.part)) {
    return measures;
  }

  let measureNumber = 1;
  let measureIndex = 0;

  for (const measureWrapper of partEntry.part) {
    if (!isRecord(measureWrapper) || !Array.isArray(measureWrapper.measure)) {
      continue;
    }

    measureNumber = toNumber(attrsOf(measureWrapper)['@_number'], measureNumber);
    measures.push({
      measureIndex,
      measureNumber,
      instructions: collectMeasureInstructions(measureWrapper.measure),
    });
    measureIndex += 1;
  }

  return measures;
}

function describeInstructions(instructions: MeasureFlowInstruction[]): string {
  return JSON.stringify(instructions);
}

export function extractMeasureFlow(rawXmlObj: unknown): MeasureFlowResult {
  const warnings: string[] = [];

  if (!Array.isArray(rawXmlObj)) {
    return { measures: [], warnings };
  }

  const scorePartwiseEntry = rawXmlObj.find(
    (entry) => isRecord(entry) && entry['score-partwise'] != null,
  );

  if (!isRecord(scorePartwiseEntry) || !Array.isArray(scorePartwiseEntry['score-partwise'])) {
    return { measures: [], warnings };
  }

  const partEntries = scorePartwiseEntry['score-partwise'].filter(
    (entry): entry is RawRecord => isRecord(entry) && entry.part != null,
  );

  if (partEntries.length === 0) {
    return { measures: [], warnings };
  }

  const partFlows = partEntries.map((entry) => extractPartFlow(entry));
  const firstPartFlow = partFlows[0];

  for (let partIndex = 1; partIndex < partFlows.length; partIndex += 1) {
    const otherFlow = partFlows[partIndex];

    if (otherFlow.length !== firstPartFlow.length) {
      warnings.push(
        `Repeat/ending markup: part ${partIndex + 1} has ${otherFlow.length} measures vs ` +
          `${firstPartFlow.length} in part 1; using part 1 flow instructions.`,
      );
      continue;
    }

    for (let index = 0; index < firstPartFlow.length; index += 1) {
      const first = firstPartFlow[index];
      const other = otherFlow[index];
      if (describeInstructions(first.instructions) !== describeInstructions(other.instructions)) {
        warnings.push(
          `Repeat/ending markup disagrees across parts at measure ${first.measureNumber}: ` +
            `part 1 has ${describeInstructions(first.instructions)}, part ${partIndex + 1} has ` +
            `${describeInstructions(other.instructions)}; using part 1.`,
        );
      }
    }
  }

  return { measures: firstPartFlow, warnings };
}
