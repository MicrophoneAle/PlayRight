interface ActiveVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

type WebAudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: WebAudioContextConstructor;
}

const ATTACK_SECONDS = 0.02;
const DECAY_SECONDS = 1.5;
const SUSTAIN_LEVEL = 0.3;
const RELEASE_SECONDS = 0.1;
const MASTER_VOLUME = 0.2;

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly activeVoices = new Map<number, ActiveVoice>();

  async init(): Promise<void> {
    if (this.audioCtx !== null) {
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return;
    }

    const windowWithWebkit = window as WindowWithWebkitAudioContext;
    const AudioContextClass =
      window.AudioContext ?? windowWithWebkit.webkitAudioContext;

    if (AudioContextClass === undefined) {
      throw new Error('[AudioEngine] Web Audio API is not supported in this browser.');
    }

    this.audioCtx = new AudioContextClass();
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = MASTER_VOLUME;
    this.masterGain.connect(this.audioCtx.destination);

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  noteOn(midi: number): void {
    if (this.audioCtx === null || this.masterGain === null) {
      return;
    }

    this.stopVoice(midi);

    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(this.masterGain);

    const now = this.audioCtx.currentTime;
    const attackEnd = now + ATTACK_SECONDS;
    const decayEnd = attackEnd + DECAY_SECONDS;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, attackEnd);
    gain.gain.exponentialRampToValueAtTime(SUSTAIN_LEVEL, decayEnd);

    osc.start(now);
    this.activeVoices.set(midi, { osc, gain });
  }

  noteOff(midi: number): void {
    if (this.audioCtx === null) {
      return;
    }

    const voice = this.activeVoices.get(midi);
    if (voice === undefined) {
      return;
    }

    const now = this.audioCtx.currentTime;
    const releaseEnd = now + RELEASE_SECONDS;

    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
    voice.osc.stop(releaseEnd);

    this.activeVoices.delete(midi);
  }

  destroy(): void {
    for (const midi of [...this.activeVoices.keys()]) {
      this.stopVoice(midi);
    }

    if (this.masterGain !== null) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }

    if (this.audioCtx !== null) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private stopVoice(midi: number): void {
    const voice = this.activeVoices.get(midi);
    if (voice === undefined || this.audioCtx === null) {
      return;
    }

    const now = this.audioCtx.currentTime;

    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0, now);
      voice.osc.stop(now);
    } catch {
      // Oscillator may already be stopped.
    }

    voice.gain.disconnect();
    voice.osc.disconnect();
    this.activeVoices.delete(midi);
  }
}
