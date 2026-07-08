import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportScheduleOnce = vi.hoisted(() =>
  vi.fn((_callback: (time: number) => void, _time: string | number) =>
    transportScheduleOnce.mock.calls.length,
  ),
);
const transportTicks = vi.hoisted(() => ({ value: 0 }));

vi.mock('tone', () => ({
  getTransport: () => ({
    PPQ: 480,
    bpm: { value: 120 },
    get ticks() {
      return transportTicks.value;
    },
    set ticks(value: number) {
      transportTicks.value = value;
    },
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    scheduleOnce: transportScheduleOnce,
    clear: vi.fn(),
    cancel: vi.fn(),
  }),
  getDraw: () => ({ schedule: vi.fn() }),
}));

import { PlaybackEngine } from './PlaybackEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import * as playbackTiming from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

async function loadTetorisScript() {
  const JSZip = (await import('jszip')).default;
  const buffer = readFileSync(
    new URL('../assets/tetoris.mxl', import.meta.url),
  );
  const archive = await JSZip.loadAsync(buffer);
  const scoreXml = await archive.file('score.xml')?.async('string');
  if (!scoreXml) throw new Error('tetoris.mxl missing score.xml');
  return parseMusicXmlToScript(scoreXml);
}

describe('extendScheduleWindow whole-script data caching', () => {
  beforeEach(() => {
    transportScheduleOnce.mockClear();
    transportTicks.value = 0;
    vi.restoreAllMocks();
  });

  it('computes fermata/duration data once per script, not once per rolling-window extension', async () => {
    const { script, scoreTiming } = await loadTetorisScript();

    useEngineStore.setState({
      script,
      scoreTiming,
      playMode: true,
      currentStepIndex: 0,
      playingMidiNotes: [],
      playingPlaybackNotes: [],
      isPlaybackActive: false,
      isPlaybackFinished: false,
      isPlaybackPaused: false,
    });

    const fermataSpy = vi.spyOn(playbackTiming, 'buildFermataPlaybackContext');
    const durationsSpy = vi.spyOn(
      playbackTiming,
      'buildStepPlaybackDurationQuarterNotesByStep',
    );

    const engine = new PlaybackEngine();
    engine.attachAudioEngine({
      warm: async () => {},
      init: async () => {},
      scheduleAttackRelease: vi.fn(),
      noteOff: vi.fn(),
    } as never);

    await engine.play();
    expect(fermataSpy).toHaveBeenCalledTimes(1);
    expect(durationsSpy).toHaveBeenCalledTimes(1);

    // Simulate several more rolling-window extensions firing later in the
    // same playthrough (this is what a long/dense piece does many times).
    // Before the fix, each one rebuilt these whole-script structures from
    // scratch; after the fix, the cache should absorb every extra call.
    for (let i = 0; i < 5; i += 1) {
      (engine as unknown as { extendScheduleWindow: () => void }).extendScheduleWindow();
    }

    expect(fermataSpy).toHaveBeenCalledTimes(1);
    expect(durationsSpy).toHaveBeenCalledTimes(1);
  });
});
