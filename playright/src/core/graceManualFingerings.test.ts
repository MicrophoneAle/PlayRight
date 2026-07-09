import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXmlToScript } from './parser/index.ts';
import {
  applyManualFingerings,
  extractManualFingerings,
} from './fingeringPredictor.ts';
import { parseManualFingerings } from './scoreLibrary.ts';
import type { ManualFingeringMap, PlaybackScript } from '../types/index.ts';
import { fingeringKey, graceFingeringKey } from '../types/index.ts';

async function loadRiverFlowsScript(): Promise<PlaybackScript> {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL('../assets/river-flows-in-you.mxl', import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error('river-flows-in-you.mxl missing score.xml');
  return parseMusicXmlToScript(scoreXml).script;
}

describe('grace manual fingering persistence (P3-0)', () => {
  it('graceFingeringKey produces the documented 4-part shape', () => {
    expect(graceFingeringKey(312, 'R', 83, 0)).toBe('312:R:83:g0');
    expect(graceFingeringKey(312, 'R', 83, 1)).toBe('312:R:83:g1');
  });

  it('round-trips a grace fingering through the Supabase JSON parse contract', () => {
    const raw = { '312:R:83:g0': 2 };
    const overrides = parseManualFingerings(raw);
    expect(overrides['312:R:83:g0']).toBe(2);
  });

  it('rejects malformed 4-part keys (non-numeric grace index) without throwing', () => {
    const raw = { '312:R:83:gabc': 2, '312:R:83:g-1': 3, '312:R:83:g': 4 };
    const overrides = parseManualFingerings(raw);
    expect(Object.keys(overrides)).toEqual([]);
  });

  it('existing 3-part main-note keys parse identically to before (no regression)', () => {
    const raw = {
      '0:R:60': 1,
      '480:L:48': { finger: 5, physicalHand: 'R' },
    };
    const overrides = parseManualFingerings(raw);
    expect(overrides['0:R:60']).toBe(1);
    expect(overrides['480:L:48']).toEqual({ finger: 5, physicalHand: 'R' });
  });

  it('river-flows step 84: grace0 and its main note share onset+hand+midi (83, R, onset 312) but produce distinct keys', async () => {
    const script = await loadRiverFlowsScript();
    const step84 = script[84];
    expect(step84.onset).toBe(312);
    expect(step84.notes.find((n) => n.hand === 'R')?.midi).toBe(83);
    expect(step84.graceBefore?.[0]).toMatchObject({ midi: 83, hand: 'R' });

    const mainKey = fingeringKey(step84.onset, 'R', 83);
    const graceKey = graceFingeringKey(step84.onset, 'R', 83, 0);
    expect(mainKey).not.toBe(graceKey);
    expect(mainKey).toBe('312:R:83');
    expect(graceKey).toBe('312:R:83:g0');

    // Assign the two DIFFERENT fingers and confirm applyManualFingerings
    // routes each to the right target, not the same note.
    const overrides: ManualFingeringMap = {};
    overrides[mainKey] = 4;
    overrides[graceKey] = 2;

    const applied = applyManualFingerings(script, overrides);
    const appliedStep = applied[84];
    const mainNote = appliedStep.notes.find((n) => n.hand === 'R' && n.midi === 83);
    const graceNote = appliedStep.graceBefore?.[0];

    expect(mainNote?.finger).toBe(4);
    expect(mainNote?.fingerSource).toBe('manual');
    expect(graceNote?.finger).toBe(2);
    expect(graceNote?.fingerSource).toBe('manual');

    // Neither assignment overwrote the other.
    expect(mainNote?.finger).not.toBe(graceNote?.finger);
  });

  it('extractManualFingerings round-trips the step-84 collision case back to distinct keys', async () => {
    const script = await loadRiverFlowsScript();
    const step84 = script[84];
    const mainKey = fingeringKey(step84.onset, 'R', 83);
    const graceKey = graceFingeringKey(step84.onset, 'R', 83, 0);

    const collisionOverrides: ManualFingeringMap = {};
    collisionOverrides[mainKey] = 4;
    collisionOverrides[graceKey] = 2;
    const applied = applyManualFingerings(script, collisionOverrides);
    const extracted = extractManualFingerings(applied);

    expect(extracted[mainKey]).toBe(4);
    expect(extracted[graceKey]).toBe(2);
  });

  it('applyManualFingerings hydrates a grace fingering that flows into predictFingering as a manual anchor', async () => {
    const script = await loadRiverFlowsScript();
    const step84 = script[84];
    const graceKey = graceFingeringKey(step84.onset, 'R', 83, 0);

    const anchorOverrides: ManualFingeringMap = {};
    anchorOverrides[graceKey] = 3;
    const applied = applyManualFingerings(script, anchorOverrides);
    const grace = applied[84].graceBefore?.[0];

    expect(grace?.finger).toBe(3);
    expect(grace?.fingerSource).toBe('manual');
    // fingerSource: 'manual' is exactly what isGraceFingeringAnchor checks to
    // preserve the value through predictFingering's write-back (Phase 2) -
    // asserting the flag here is the load-bearing part of "flows into the
    // DP as an anchor automatically".
  });

  it('applyManualFingerings hydrates a cross-hand grace crossover onto playingHand', async () => {
    const script = await loadRiverFlowsScript();
    const step84 = script[84];
    const graceKey = graceFingeringKey(step84.onset, 'R', 83, 0);

    const crossoverOverrides: ManualFingeringMap = {};
    crossoverOverrides[graceKey] = { finger: 5, physicalHand: 'L' };
    const applied = applyManualFingerings(script, crossoverOverrides);
    const grace = applied[84].graceBefore?.[0];

    expect(grace?.finger).toBe(5);
    expect(grace?.playingHand).toBe('L');
    expect(grace?.fingerSource).toBe('manual');
  });
});
