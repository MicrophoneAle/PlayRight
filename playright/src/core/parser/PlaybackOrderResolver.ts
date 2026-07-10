/**
 * R0 resolver: unrolls repeat/ending flow instructions into a PlaybackOrder —
 * a flat list of { stepIndex, playbackOnset, passIndex } entries, one per
 * logical playback position, via a repeat-region stack walk over measures.
 *
 * The document-order PlaybackScript is never touched. Scores without flow
 * instructions short-circuit to the exact identity mapping, and any
 * inconsistency detected while resolving falls back to identity with a
 * warning instead of producing a partial unroll.
 */

import type {
  PlaybackOrder,
  PlaybackOrderEntry,
  PlaybackScript,
} from '../../types/index.ts';
import type {
  EndingFlowInstruction,
  MeasureFlowResult,
  RepeatFlowInstruction,
} from './MeasureFlowNormalizer.ts';
import type { NormalizedElement } from './MusicXMLNormalizer.ts';

export interface MeasureBounds {
  measureNumber: number;
  /** Timeline cursor at the measure's first element, canonical divisions. */
  docStart: number;
  /** Timeline cursor at the next measure's first element (or end of part). */
  docEnd: number;
}

export interface ResolvePlaybackOrderInput {
  script: PlaybackScript;
  flow: MeasureFlowResult;
  /** Normalized elements of the first part, used for measure boundaries. */
  firstPartElements: NormalizedElement[];
  canonicalDivisionsPerQuarter: number;
}

export interface ResolvePlaybackOrderResult {
  playbackOrder: PlaybackOrder;
  warnings: string[];
}

function canonicalDuration(
  duration: number,
  divisionsAtNote: number,
  canon: number,
): number {
  if (duration === 0) {
    return 0;
  }

  if (divisionsAtNote <= 0) {
    return duration;
  }

  return Math.round((duration * canon) / divisionsAtNote);
}

/**
 * Walks the first part's elements with the same cursor rules as
 * MusicXMLMapper's timeline (backup/forward, non-chord non-grace note
 * advances, measure-rest expansion) and records the cursor at each measure
 * transition. Element measure attribution comes from the normalizer.
 */
export function computeMeasureBounds(
  elements: NormalizedElement[],
  canon: number,
): MeasureBounds[] {
  const bounds: MeasureBounds[] = [];
  let cursor = 0;
  let currentMeasureNumber: number | null = null;

  for (const element of elements) {
    if (element.measureNumber !== currentMeasureNumber) {
      if (bounds.length > 0) {
        bounds[bounds.length - 1].docEnd = cursor;
      }
      bounds.push({ measureNumber: element.measureNumber, docStart: cursor, docEnd: cursor });
      currentMeasureNumber = element.measureNumber;
    }

    if (element.type === 'backup') {
      cursor = Math.max(
        0,
        cursor - canonicalDuration(element.duration, element.divisionsAtNote, canon),
      );
    } else if (element.type === 'forward') {
      cursor += canonicalDuration(element.duration, element.divisionsAtNote, canon);
    } else if (element.type === 'note' && !element.isGrace && !element.isChord) {
      let advance = canonicalDuration(element.duration, element.divisionsAtNote, canon);
      if (advance === 0 && element.isRest && element.isMeasureRest) {
        advance = canonicalDuration(
          (element.timeBeats * element.divisionsAtNote * 4) / element.timeBeatType,
          element.divisionsAtNote,
          canon,
        );
      }
      cursor += advance;
    }
  }

  if (bounds.length > 0) {
    bounds[bounds.length - 1].docEnd = cursor;
  }

  return bounds;
}

function identityPlaybackOrder(script: PlaybackScript): PlaybackOrder {
  return script.map((step, stepIndex) => ({
    stepIndex,
    playbackOnset: step.onset,
    passIndex: 0,
  }));
}

interface EndingSpan {
  startIdx: number;
  stopIdx: number;
  numbers: number[];
}

interface FlowTables {
  forwardAt: Set<number>;
  backwardAt: Map<number, RepeatFlowInstruction>;
  endingSpanAt: Array<EndingSpan | null>;
  hasSoundJumps: boolean;
}

function buildFlowTables(
  flow: MeasureFlowResult,
  warnings: string[],
): FlowTables | null {
  const measureCount = flow.measures.length;
  const forwardAt = new Set<number>();
  const backwardAt = new Map<number, RepeatFlowInstruction>();
  const spans: EndingSpan[] = [];
  let openEnding: { startIdx: number; instruction: EndingFlowInstruction } | null = null;
  let hasSoundJumps = false;

  for (const measure of flow.measures) {
    for (const instruction of measure.instructions) {
      if (instruction.kind === 'repeat') {
        if (instruction.direction === 'forward') {
          forwardAt.add(measure.measureIndex);
        } else {
          backwardAt.set(measure.measureIndex, instruction);
        }
        continue;
      }

      if (instruction.kind === 'ending') {
        if (instruction.type === 'start') {
          if (openEnding) {
            warnings.push(
              `Ending at measure ${measure.measureNumber} starts before the previous ending closed; playback order falls back to document order.`,
            );
            return null;
          }
          openEnding = { startIdx: measure.measureIndex, instruction };
        } else {
          if (!openEnding) {
            warnings.push(
              `Ending ${instruction.type} at measure ${measure.measureNumber} has no matching start; playback order falls back to document order.`,
            );
            return null;
          }
          spans.push({
            startIdx: openEnding.startIdx,
            stopIdx: measure.measureIndex,
            numbers: openEnding.instruction.numbers,
          });
          openEnding = null;
        }
        continue;
      }

      hasSoundJumps = true;
    }
  }

  if (openEnding) {
    warnings.push(
      'An ending start has no matching stop/discontinue; playback order falls back to document order.',
    );
    return null;
  }

  const endingSpanAt: Array<EndingSpan | null> = new Array(measureCount).fill(null);
  for (const span of spans) {
    for (let index = span.startIdx; index <= span.stopIdx; index += 1) {
      endingSpanAt[index] = span;
    }
  }

  return { forwardAt, backwardAt, endingSpanAt, hasSoundJumps };
}

export function resolvePlaybackOrder(
  input: ResolvePlaybackOrderInput,
): ResolvePlaybackOrderResult {
  const { script, flow, firstPartElements, canonicalDivisionsPerQuarter } = input;
  const warnings: string[] = [];

  const hasFlowInstructions = flow.measures.some(
    (measure) => measure.instructions.length > 0,
  );
  if (!hasFlowInstructions || script.length === 0) {
    return { playbackOrder: identityPlaybackOrder(script), warnings };
  }

  const fallback = (reason: string): ResolvePlaybackOrderResult => {
    warnings.push(reason);
    return { playbackOrder: identityPlaybackOrder(script), warnings };
  };

  const tables = buildFlowTables(flow, warnings);
  if (tables === null) {
    return { playbackOrder: identityPlaybackOrder(script), warnings };
  }

  if (tables.hasSoundJumps) {
    warnings.push(
      'Score contains sound jump markup (D.C./D.S./coda/fine); jumps are not resolved yet — playback order follows repeat barlines and endings only.',
    );
  }

  const bounds = computeMeasureBounds(firstPartElements, canonicalDivisionsPerQuarter);
  if (bounds.length !== flow.measures.length) {
    return fallback(
      `Repeat resolution: measure boundary walk found ${bounds.length} measures but flow markup lists ${flow.measures.length}; playback order falls back to document order.`,
    );
  }

  const measureIdxByNumber = new Map<number, number>();
  for (const [index, measure] of flow.measures.entries()) {
    if (measureIdxByNumber.has(measure.measureNumber)) {
      return fallback(
        `Repeat resolution: duplicate measure number ${measure.measureNumber}; playback order falls back to document order.`,
      );
    }
    if (bounds[index].measureNumber !== measure.measureNumber) {
      return fallback(
        `Repeat resolution: measure numbering disagrees between boundary walk and flow markup at index ${index}; playback order falls back to document order.`,
      );
    }
    measureIdxByNumber.set(measure.measureNumber, index);
  }

  const stepIndicesByMeasureIdx: number[][] = flow.measures.map(() => []);
  for (const [stepIndex, step] of script.entries()) {
    const measureIdx = measureIdxByNumber.get(step.measureNumber);
    if (measureIdx === undefined) {
      return fallback(
        `Repeat resolution: step at onset ${step.onset} references unknown measure ${step.measureNumber}; playback order falls back to document order.`,
      );
    }
    if (
      step.onset < bounds[measureIdx].docStart ||
      step.onset >= Math.max(bounds[measureIdx].docEnd, bounds[measureIdx].docStart + 1)
    ) {
      return fallback(
        `Repeat resolution: step onset ${step.onset} lies outside measure ${step.measureNumber} bounds [${bounds[measureIdx].docStart}, ${bounds[measureIdx].docEnd}); playback order falls back to document order.`,
      );
    }
    stepIndicesByMeasureIdx[measureIdx].push(stepIndex);
  }

  const measureCount = flow.measures.length;
  const entries: PlaybackOrderEntry[] = [];
  const visitCounts = new Map<number, number>();
  const regionStack: Array<{ startIdx: number; pass: number }> = [];
  let playbackCursor = 0;
  let measureIdx = 0;
  /** Set when jumping back so the region's forward barline is not re-entered as a fresh region. */
  let suppressRegionEntryAt = -1;
  let iterationGuard = 0;
  const maxIterations = measureCount * 64;

  while (measureIdx < measureCount) {
    iterationGuard += 1;
    if (iterationGuard > maxIterations) {
      return fallback(
        'Repeat resolution: repeat walk did not terminate; playback order falls back to document order.',
      );
    }

    const currentPass =
      regionStack.length > 0 ? regionStack[regionStack.length - 1].pass : 1;

    const span = tables.endingSpanAt[measureIdx];
    if (span && !span.numbers.includes(currentPass)) {
      measureIdx = span.stopIdx + 1;
      continue;
    }

    if (tables.forwardAt.has(measureIdx) && measureIdx !== suppressRegionEntryAt) {
      regionStack.push({ startIdx: measureIdx, pass: 1 });
    }
    suppressRegionEntryAt = -1;

    for (const stepIndex of stepIndicesByMeasureIdx[measureIdx]) {
      const step = script[stepIndex];
      const priorVisits = visitCounts.get(stepIndex) ?? 0;
      entries.push({
        stepIndex,
        playbackOnset: playbackCursor + (step.onset - bounds[measureIdx].docStart),
        passIndex: priorVisits,
      });
      visitCounts.set(stepIndex, priorVisits + 1);
    }
    playbackCursor +=
      Math.max(bounds[measureIdx].docEnd, bounds[measureIdx].docStart) -
      bounds[measureIdx].docStart;

    const backward = tables.backwardAt.get(measureIdx);
    if (backward) {
      if (regionStack.length === 0) {
        // Backward barline with no forward: repeat from the start of the score.
        regionStack.push({ startIdx: 0, pass: 1 });
      }
      const region = regionStack[regionStack.length - 1];
      if (region.pass < backward.times) {
        region.pass += 1;
        measureIdx = region.startIdx;
        suppressRegionEntryAt = region.startIdx;
        continue;
      }
      regionStack.pop();
    }

    measureIdx += 1;
  }

  // Every document step must be visited at least once.
  for (let stepIndex = 0; stepIndex < script.length; stepIndex += 1) {
    if (!visitCounts.has(stepIndex)) {
      return fallback(
        `Repeat resolution: step ${stepIndex} (measure ${script[stepIndex].measureNumber}) was never visited; playback order falls back to document order.`,
      );
    }
  }

  return { playbackOrder: entries, warnings };
}
