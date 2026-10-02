import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseMusicXmlResult } from '../types/index.ts';

type Scheduled = { tick: number; seq: number; callback: (time: number) => void };

const harness = vi.hoisted(() => {
  const state = {
    pending: [] as Array<{ tick: number; seq: number; callback: (time: number) => void }>,
    seq: 0,
    /** Hold-until-lift counterfactual: overrides the pedal factor when set. */
    pedalFactorOverride: null as number | null,
  };
  const transport = {
    PPQ: 480,
    bpm: { value: 120 },
    ticks: 0,
    start: () => {},
    stop: () => {},
    pause: () => {},
    clear: () => {},
    cancel: () => {},
    scheduleOnce: (callback: (time: number) => void, time: string | number) => {
      state.seq += 1;
      state.pending.push({ tick: Number.parseFloat(String(time)), seq: state.seq, callback });
      return state.seq;
    },
  };
  return { state, transport };
});

vi.mock('tone', () => ({
  getTransport: () => harness.transport,
  getDraw: () => ({ schedule: vi.fn() }),
  Draw: { schedule: vi.fn() },
}));

vi.mock('./playbackTiming.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./playbackTiming.ts')>();
  return {
    ...actual,
    pedalSustainedQuarterNotes: (...args: Parameters<typeof actual.pedalSustainedQuarterNotes>) => {
      const factor = harness.state.pedalFactorOverride;
      if (factor === null) {
        return actual.pedalSustainedQuarterNotes(...args);
      }
      const [base, onset, dpq, spans, next] = args;
      return actual.pedalSustainedQuarterNotes(base, onset, dpq, spans, next, factor);
    },
  };
});

import { PlaybackEngine } from './PlaybackEngine.ts';
import { parseMusicXmlToScript } from './parser/index.ts';
import { PEDAL_ACROSS_REPEAT_MUSICXML } from './parser/__fixtures__/pedal.musicxml.ts';
import { PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS } from './playbackTiming.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const PPQ = 480;
/** AudioEngine's sampler release tail: each voice keeps sounding this long after its release. */
const SAMPLER_RELEASE_SECONDS = 0.45;

interface Voice {
  midi: number;
  attackTick: number;
  durationTicks: number;
  tailTicks: number;
}

function loadXml(name: string): string {
  return readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
}

async function loadMxl(name: string): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const archive = await JSZip.loadAsync(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
  const path = Object.keys(archive.files).find((p) => p.endsWith('.xml') && !p.startsWith('META-INF'));
  return (await archive.file(path!)!.async('string'))!;
}

/** Play the whole piece on the fake transport, firing events in tick order, and record every voice. */
async function playThrough(parsed: ParseMusicXmlResult, withPedal: boolean): Promise<Voice[]> {
  harness.state.pending = [];
  harness.state.seq = 0;
  harness.transport.ticks = 0;
  harness.transport.bpm.value = 120;

  const { pedalSpans: _pedalSpans, ...timingWithoutPedal } = parsed.scoreTiming;
  useEngineStore.setState({
    script: parsed.script,
    scoreTiming: withPedal ? parsed.scoreTiming : timingWithoutPedal,
    playbackOrder: parsed.playbackOrder,
    playMode: true,
    tempoFactor: 1,
    currentStepIndex: 0,
    playingMidiNotes: [],
    playingPlaybackNotes: [],
    isPlaybackActive: false,
    isPlaybackFinished: false,
    isPlaybackPaused: false,
  });

  const voices: Voice[] = [];
  let currentTick = 0;
  const engine = new PlaybackEngine();
  engine.attachAudioEngine({
    warm: async () => {},
    init: async () => {},
    releaseAll: () => {},
    noteOff: () => {},
    scheduleAttackRelease: (midi: number, duration: string) => {
      const tailTicks = SAMPLER_RELEASE_SECONDS * (harness.transport.bpm.value / 60) * PPQ;
      voices.push({ midi, attackTick: currentTick, durationTicks: Number.parseFloat(duration), tailTicks });
    },
  } as never);

  await engine.play();

  for (let guard = 0; guard < 1_000_000 && harness.state.pending.length > 0; guard += 1) {
    harness.state.pending.sort((a: Scheduled, b: Scheduled) => a.tick - b.tick || a.seq - b.seq);
    const next = harness.state.pending.shift()!;
    currentTick = next.tick;
    harness.transport.ticks = next.tick;
    next.callback(next.tick);
  }

  engine.dispose();
  return voices;
}

/** Peak number of simultaneously sounding voices, release tail included. */
function maxConcurrentVoices(voices: Voice[]): number {
  const events: Array<[number, number]> = [];
  for (const voice of voices) {
    events.push([voice.attackTick, 1]);
    events.push([voice.attackTick + voice.durationTicks + voice.tailTicks, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let running = 0;
  let peak = 0;
  for (const [, delta] of events) {
    running += delta;
    peak = Math.max(peak, running);
  }
  return peak;
}

const STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

function pitchXml(midi: number): string {
  const alter = ALTERS[midi % 12] ? '<alter>1</alter>' : '';
  return `<pitch><step>${STEPS[midi % 12]}</step>${alter}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}

/**
 * The brief's worst case: one bass note tied under an 8-measure sixteenth
 * arpeggio through a different chord each bar, all inside a single pedal span.
 * True pedal would hold every arpeggio note to the lift.
 */
function arpeggioUnderOnePedalXml(): string {
  const roots = [60, 65, 67, 63, 68, 70, 62, 67];
  const shape = [0, 4, 7, 12, 16, 19, 24, 19, 16, 12, 7, 4, 0, 4, 7, 12];
  const measures = roots.map((root, index) => {
    const tie = [index > 0 ? '<tie type="stop"/>' : '', index < roots.length - 1 ? '<tie type="start"/>' : ''].join('');
    const tied = [index > 0 ? '<tied type="stop"/>' : '', index < roots.length - 1 ? '<tied type="start"/>' : ''].join('');
    const rh = shape
      .map((offset) => `<note>${pitchXml(root + offset - 12)}<duration>1</duration><voice>1</voice><type>16th</type><staff>1</staff></note>`)
      .join('');
    const pedal = (type: string) =>
      `<direction placement="below"><direction-type><pedal type="${type}" line="yes"/></direction-type><staff>2</staff></direction>`;
    const lh = `<backup><duration>16</duration></backup>${index === 0 ? pedal('start') : ''}<note>${pitchXml(36)}<duration>16</duration>${tie}<voice>5</voice><type>whole</type><staff>2</staff><notations>${tied}</notations></note>`;
    const attributes =
      index === 0
        ? '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>'
        : '';
    const end = index === roots.length - 1 ? pedal('stop') : '';
    return `<measure number="${index + 1}">${attributes}${rh}${lh}${end}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
}

const PEDAL_FIXTURES: Array<{
  name: string;
  load: () => Promise<string> | string;
  /**
   * Pinned peak concurrent voices with pedal, release tail included (measured
   * 2026-10-02; unpedaled / hold-to-lift peaks: clair 22/32, constant 13/16,
   * tetoris 22/27, glimpse 15/23, hoyo 17/27, chase 8/10, arpeggio 5/33).
   * A rise means voices are piling up.
   */
  maxPedalVoices: number;
}> = [
  { name: 'clair-de-lune', load: () => loadMxl('clair-de-lune-debussy.mxl'), maxPedalVoices: 24 },
  { name: 'constant-moderato', load: () => loadXml('constant-moderato.musicxml'), maxPedalVoices: 13 },
  { name: 'tetoris', load: () => loadMxl('tetoris.mxl'), maxPedalVoices: 26 },
  { name: 'glimpse-of-us', load: () => loadMxl('glimpse-of-us-joji.mxl'), maxPedalVoices: 18 },
  { name: 'hoyo-mix', load: () => loadXml('if-i-can-stop-one-heart-from-breaking-hoyo-mix.musicxml'), maxPedalVoices: 17 },
  { name: 'chase', load: () => loadXml('chase-setsuna-yuki.musicxml'), maxPedalVoices: 10 },
  { name: 'synthetic bass under 8-bar arpeggio, one pedal', load: arpeggioUnderOnePedalXml, maxPedalVoices: 6 },
];

describe('PlaybackEngine sustain pedal', () => {
  beforeEach(() => {
    harness.state.pedalFactorOverride = null;
  });

  it('a pedaled note before a backward repeat jump is still clamped at the jump', async () => {
    // Pedal [7,9) in document quarters; playback m1 m2 | m1 m2 m3. The F at
    // document onset 7 sounds twice: before the jump (pass 1) and before m3.
    const parsed = parseMusicXmlToScript(PEDAL_ACROSS_REPEAT_MUSICXML);
    const dry = await playThrough(parsed, false);
    const pedal = await playThrough(parsed, true);
    // F3 ends every bar; document onset 7 plays at playback quarters 7 and 15.
    const fAttacks = (voices: Voice[]) =>
      voices.filter(
        (voice) =>
          voice.midi === 53 && (voice.attackTick === 7 * PPQ || voice.attackTick === 15 * PPQ),
      );

    const [firstPass, secondPass] = fAttacks(pedal);
    const [dryFirst, drySecond] = fAttacks(dry);
    const jumpTick = 8 * PPQ;
    const gapTicks = PLAYBACK_ARTICULATION_GAP_MIN_QUARTERS * PPQ;

    expect(firstPass.attackTick).toBe(7 * PPQ);
    expect(firstPass.attackTick + firstPass.durationTicks).toBeLessThanOrEqual(jumpTick - gapTicks + 1);
    // Pedal extends it, but only up to the jump clamp, far short of the 1.75x
    // it gets on the second pass, where no jump follows and it rings into m3.
    expect(firstPass.durationTicks).toBeGreaterThanOrEqual(dryFirst.durationTicks);
    expect(secondPass.durationTicks).toBeGreaterThan(jumpTick - firstPass.attackTick);
    expect(secondPass.durationTicks).toBeGreaterThan(drySecond.durationTicks);
  });

  for (const fixture of PEDAL_FIXTURES) {
    it(`${fixture.name}: identical attacks, release-side only extension, bounded voices`, async () => {
      const parsed = parseMusicXmlToScript(await fixture.load());
      expect(parsed.scoreTiming.pedalSpans?.length ?? 0).toBeGreaterThan(0);

      const dry = await playThrough(parsed, false);
      const pedal = await playThrough(parsed, true);
      harness.state.pedalFactorOverride = Number.POSITIVE_INFINITY;
      const holdToLift = await playThrough(parsed, true);

      // Onsets/attacks untouched: same voices, same attack ticks, same order.
      expect(pedal.map((v) => [v.midi, v.attackTick])).toEqual(dry.map((v) => [v.midi, v.attackTick]));
      // Release side only, and never shorter.
      let extended = 0;
      pedal.forEach((voice, index) => {
        expect(voice.durationTicks).toBeGreaterThanOrEqual(dry[index].durationTicks);
        if (voice.durationTicks > dry[index].durationTicks) extended += 1;
      });
      expect(extended).toBeGreaterThan(0);

      // Re-strikes stay separate: an extended tail ends before the next attack
      // of the same pitch (sampler voices of one pitch layer, not retrigger).
      const nextAttackOfSameMidi = new Map<number, number>();
      for (let index = pedal.length - 1; index >= 0; index -= 1) {
        const voice = pedal[index];
        const next = nextAttackOfSameMidi.get(voice.midi);
        if (next !== undefined && next > voice.attackTick && voice.durationTicks > dry[index].durationTicks) {
          expect(voice.attackTick + voice.durationTicks).toBeLessThanOrEqual(next);
        }
        if (next === undefined || voice.attackTick < next) {
          nextAttackOfSameMidi.set(voice.midi, voice.attackTick);
        }
      }

      const peaks = {
        dry: maxConcurrentVoices(dry),
        pedal: maxConcurrentVoices(pedal),
        holdToLift: maxConcurrentVoices(holdToLift),
      };
      expect(peaks.pedal).toBeLessThanOrEqual(fixture.maxPedalVoices);
      expect(peaks.pedal).toBeLessThanOrEqual(peaks.holdToLift);
    }, 120_000);
  }
});
