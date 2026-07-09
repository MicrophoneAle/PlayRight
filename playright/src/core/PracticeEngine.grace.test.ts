import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './AudioEngine.ts';
import { PracticeEngine } from './PracticeEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import type { PlaybackScript } from '../types/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

async function loadMxlScript(name: string) {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error(`${name} missing score.xml`);
  return parseMusicXmlToScript(scoreXml);
}

function loadXmlScript(name: string) {
  const xml = readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
  return parseMusicXmlToScript(xml);
}

function makeScript(steps: PlaybackScript): void {
  useEngineStore.getState().actions.loadScript(steps, '<score/>', 'test');
}

function resetStore(): void {
  useEngineStore.getState().actions.clearScript();
  useEngineStore.setState({
    engineMode: 'one-hand',
    activeHand: 'R',
    isPracticeActive: false,
    hasPracticeStarted: false,
    currentStepIndex: 0,
    practiceGraceCursor: null,
    scopeStartMidi: 60,
    expectedMidiNotes: [],
  });
}

function createMockAudio(): AudioEngine {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    warm: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  } as unknown as AudioEngine;
}

describe('PracticeEngine grace-note walk', () => {
  let engine: PracticeEngine;
  let rafCallback: FrameRequestCallback | null = null;

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    resetStore();

    engine = new PracticeEngine();
    engine.ensureStoreSubscription();
    engine.attachAudioEngine(createMockAudio());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushAdvance = () => {
    rafCallback?.(0);
    rafCallback = null;
  };

  describe('one-hand mode (real fixtures)', () => {
    it('walks a 2-grace run before its main note (river-flows-in-you step 63)', async () => {
      const { script } = await loadMxlScript('river-flows-in-you.mxl');
      makeScript(script);
      useEngineStore.setState({ engineMode: 'one-hand', activeHand: 'R' });

      engine.start();
      engine.seekToStep(63);

      expect(useEngineStore.getState().currentStepIndex).toBe(63);
      expect(useEngineStore.getState().practiceGraceCursor).toBe(0);
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([69]); // A4 grace 0

      // Pressing the main note early (before the graces) must not match anything.
      engine.handleNoteOn(81);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(63);
      expect(useEngineStore.getState().practiceGraceCursor).toBe(0);

      engine.handleNoteOn(69);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(63);
      expect(useEngineStore.getState().practiceGraceCursor).toBe(1);
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([73]); // C#5 grace 1

      engine.handleNoteOn(73);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(63);
      expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
      // L-hand F#3 filtered out in one-hand R mode; only the R main note shows.
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([81]);

      engine.handleNoteOn(81);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).not.toBe(63);
    });

    it('walks a single grace before its main note (morns-like-these step 16)', () => {
      const { script } = loadXmlScript('morns-like-these-honkai-star-rail.musicxml');
      makeScript(script);
      useEngineStore.setState({ engineMode: 'one-hand', activeHand: 'R' });

      engine.start();
      engine.seekToStep(16);

      expect(useEngineStore.getState().currentStepIndex).toBe(16);
      expect(useEngineStore.getState().practiceGraceCursor).toBe(0);
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([76]); // E5 grace

      engine.handleNoteOn(76);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(16);
      expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
      // L-hand notes filtered out in one-hand R mode; only F#5 (R) shows.
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([78]);

      engine.handleNoteOn(78);
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).not.toBe(16);
    });

    it('skips a grace whose hand differs from the active hand, landing directly on main', () => {
      makeScript([
        {
          order: 0,
          onset: 0,
          measureNumber: 1,
          notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: null }],
        },
        {
          order: 1,
          onset: 480,
          measureNumber: 1,
          notes: [
            { pitch: 'D4', midi: 62, hand: 'R', finger: null },
            { pitch: 'C3', midi: 48, hand: 'L', finger: null },
          ],
          graceBefore: [{ midi: 47, pitch: 'B2', hand: 'L', kind: 'acciaccatura' }],
        },
      ]);
      useEngineStore.setState({ engineMode: 'one-hand', activeHand: 'R' });

      engine.start();
      engine.handleNoteOn(60);
      flushAdvance();

      expect(useEngineStore.getState().currentStepIndex).toBe(1);
      expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
      expect(useEngineStore.getState().expectedMidiNotes).toEqual([62]);
    });
  });

  describe('two-hand mode (synthetic, mirroring river-flows step 63 shape)', () => {
    it('skips an unfingered grace run entirely, requiring no input for it', () => {
      makeScript([
        {
          order: 0,
          onset: 0,
          measureNumber: 1,
          notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
        },
        {
          order: 1,
          onset: 480,
          measureNumber: 1,
          notes: [
            { pitch: 'A5', midi: 81, hand: 'R', finger: 5 },
            { pitch: 'F#3', midi: 54, hand: 'L', finger: 1 },
          ],
          graceBefore: [
            { midi: 69, pitch: 'A4', hand: 'R', kind: 'appoggiatura' },
            { midi: 73, pitch: 'C#5', hand: 'R', kind: 'appoggiatura' },
          ],
        },
      ]);
      useEngineStore.setState({ engineMode: 'two-hand', activeHand: 'R' });

      engine.start();
      engine.handleFingerPress({ hand: 'R', finger: 1 });
      flushAdvance();

      expect(useEngineStore.getState().currentStepIndex).toBe(1);
      expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
      expect(useEngineStore.getState().expectedMidiNotes.sort()).toEqual([54, 81]);

      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerPress({ hand: 'L', finger: 1 });
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(2);
    });

    it('requires a fingered grace run before its main chord, gated by finger', () => {
      makeScript([
        {
          order: 0,
          onset: 0,
          measureNumber: 1,
          notes: [{ pitch: 'C4', midi: 60, hand: 'R', finger: 1 }],
        },
        {
          order: 1,
          onset: 480,
          measureNumber: 1,
          notes: [
            { pitch: 'A5', midi: 81, hand: 'R', finger: 5 },
            { pitch: 'F#3', midi: 54, hand: 'L', finger: 1 },
          ],
          graceBefore: [
            { midi: 69, pitch: 'A4', hand: 'R', kind: 'appoggiatura', finger: 3 },
            { midi: 73, pitch: 'C#5', hand: 'R', kind: 'appoggiatura', finger: 4 },
          ],
        },
      ]);
      useEngineStore.setState({ engineMode: 'two-hand', activeHand: 'R' });

      engine.start();
      engine.handleFingerPress({ hand: 'R', finger: 1 });
      flushAdvance();

      expect(useEngineStore.getState().currentStepIndex).toBe(1);
      expect(useEngineStore.getState().practiceGraceCursor).toBe(0);

      // Wrong finger for grace 0 (needs 3) must not match or advance.
      engine.handleFingerPress({ hand: 'R', finger: 4 });
      flushAdvance();
      expect(useEngineStore.getState().practiceGraceCursor).toBe(0);

      engine.handleFingerPress({ hand: 'R', finger: 3 });
      flushAdvance();
      expect(useEngineStore.getState().practiceGraceCursor).toBe(1);

      engine.handleFingerPress({ hand: 'R', finger: 4 });
      flushAdvance();
      expect(useEngineStore.getState().practiceGraceCursor).toBeNull();
      expect(useEngineStore.getState().expectedMidiNotes.sort()).toEqual([54, 81]);

      engine.handleFingerPress({ hand: 'R', finger: 5 });
      engine.handleFingerPress({ hand: 'L', finger: 1 });
      flushAdvance();
      expect(useEngineStore.getState().currentStepIndex).toBe(2);
    });
  });
});
