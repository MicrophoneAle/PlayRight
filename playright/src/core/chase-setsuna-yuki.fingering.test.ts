import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Finger, Hand, PlaybackScript } from '../types/index.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  predictFingering,
  reportHandFingering,
  type HandFingeringReport,
} from './fingeringPredictor.ts';

const CHASE_XML = readFileSync(
  new URL('../assets/chase-setsuna-yuki.musicxml', import.meta.url),
  'utf8',
);

function pitchName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function summarizeReport(report: HandFingeringReport): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${report.hand} hand ===`);
  // eslint-disable-next-line no-console
  console.log(
    `notes=${report.totalNotes} phrases=${report.phraseCount} scopes=${report.scopeCount} traverseScopes=${report.traverseScopeCount}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `finger usage: 1=${report.fingerUsage[1]} 2=${report.fingerUsage[2]} 3=${report.fingerUsage[3]} 4=${report.fingerUsage[4]} 5=${report.fingerUsage[5]}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `thumbShare=${(report.thumbShare * 100).toFixed(1)}% lowThreeShare=${(report.lowThreeShare * 100).toFixed(1)}%`,
  );

  report.scopes.forEach((scope) => {
    const fingerPairs = scope.midis.map((midi, index) => {
      const finger = scope.fingers[index];
      return `${pitchName(midi)}:${finger}`;
    });
    // eslint-disable-next-line no-console
    console.log(
      `  phrase ${scope.phraseIndex} scope ${scope.scopeIndex}: notes=${scope.noteCount} distinct=${scope.distinctPitchCount} range=${scope.pitchRangeSemitones}st traverse=${scope.needsTraverse} run=${scope.isRun}`,
    );
    // eslint-disable-next-line no-console
    console.log(`    ${fingerPairs.join(' ')}`);
  });
}

function fingersInMeasures(
  script: PlaybackScript,
  hand: Hand,
  measureFrom: number,
  measureTo: number,
): { measure: number; midi: number; finger: Finger | null; pitch: string }[] {
  const rows: { measure: number; midi: number; finger: Finger | null; pitch: string }[] = [];
  for (const step of script) {
    if (step.measureNumber < measureFrom || step.measureNumber > measureTo) {
      continue;
    }
    for (const note of step.notes) {
      if (note.hand !== hand) {
        continue;
      }
      rows.push({
        measure: step.measureNumber,
        midi: note.midi,
        finger: note.finger,
        pitch: pitchName(note.midi),
      });
    }
  }
  return rows;
}

describe('chase-setsuna-yuki fingering analysis', () => {
  it('reports phrasing, scoping, and fingering for both hands', () => {
    const fingeringTags = (CHASE_XML.match(/<fingering>/g) ?? []).length;
    const { script: parsed } = parseMusicXmlToScript(CHASE_XML);
    const script = predictFingering(parsed);

    const totalNotes = script.flatMap((step) => step.notes).length;
    const rhNotes = script.flatMap((step) => step.notes).filter((note) => note.hand === 'R').length;
    const lhNotes = script.flatMap((step) => step.notes).filter((note) => note.hand === 'L').length;
    const predicted = script
      .flatMap((step) => step.notes)
      .filter((note) => note.fingerSource === 'predicted').length;
    const scoreAnchored = script
      .flatMap((step) => step.notes)
      .filter((note) => note.fingerSource === 'score').length;

    // eslint-disable-next-line no-console
    console.log('\n=== Chase (Setsuna Yuki) — parse summary ===');
    // eslint-disable-next-line no-console
    console.log(
      `fingering tags in XML=${fingeringTags} totalNotes=${totalNotes} RH=${rhNotes} LH=${lhNotes}`,
    );
    // eslint-disable-next-line no-console
    console.log(`predicted=${predicted} score-anchored=${scoreAnchored}`);

    const rhReport = reportHandFingering(script, 'R');
    const lhReport = reportHandFingering(script, 'L');
    summarizeReport(rhReport);
    summarizeReport(lhReport);

    const rhM1to10 = fingersInMeasures(script, 'R', 1, 10);
    // eslint-disable-next-line no-console
    console.log('\n=== RH measures 1–10 (note.finger after predictFingering) ===');
    // eslint-disable-next-line no-console
    console.log(
      rhM1to10
        .map((row) => `m${row.measure} ${row.pitch}(${row.midi})→${row.finger}`)
        .join('\n'),
    );
    const rhFingersM1to10 = rhM1to10.map((row) => row.finger).filter((f): f is Finger => f !== null);
    const rhThumbM1to10 = rhFingersM1to10.filter((f) => f === 1).length;
  // eslint-disable-next-line no-console
    console.log(
      `RH m1-10 fingers: [${rhFingersM1to10.join(', ')}] thumb=${rhThumbM1to10}/${rhFingersM1to10.length}`,
    );

    const target = [
      1, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3, 4, 1, 2, 3, 5, 4, 3, 4, 3, 1, 1, 1, 2, 3,
      4, 1, 2, 1, 3, 3, 3, 2, 3, 4, 5, 1, 3, 3, 3, 1, 5, 4, 3, 5, 4, 3, 4, 3, 1,
      2, 3, 3, 3, 3, 2, 3, 5, 3,
    ];
    const rhM1to18 = fingersInMeasures(script, 'R', 1, 18);
    const actual = rhM1to18.map((row) => row.finger);

    // eslint-disable-next-line no-console
    console.log('\n=== RH measures 1–18: actual vs target ===');
    // eslint-disable-next-line no-console
    console.log(`actual (${actual.length}): [${actual.join(', ')}]`);
    // eslint-disable-next-line no-console
    console.log(`target (${target.length}): [${target.join(', ')}]`);

    const compareLength = Math.min(actual.length, target.length);
    const mismatches: number[] = [];
    for (let index = 0; index < compareLength; index += 1) {
      if (actual[index] !== target[index]) {
        mismatches.push(index);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `mismatches=${mismatches.length}/${compareLength} at positions: [${mismatches.join(', ')}]`,
    );

    const thumbMatches = mismatches.filter(
      (index) => actual[index] === 1 || target[index] === 1,
    ).length;
    // eslint-disable-next-line no-console
    console.log(`of which involve the thumb (finger 1): ${thumbMatches}`);

    expect(fingeringTags).toBe(0);
    expect(predicted).toBe(totalNotes);
    expect(scoreAnchored).toBe(0);
    expect(rhReport.totalNotes).toBeGreaterThan(0);
    expect(lhReport.totalNotes).toBeGreaterThan(0);
  });
});
