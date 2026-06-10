export class AudioEngine {
  private ctx: AudioContext | null = null;

  async init(): Promise<void> {
    if (this.ctx !== null) {
      return;
    }

    this.ctx = new AudioContext();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  triggerNoteOn(midiPitch: number): void {
    console.log(`[AudioEngine] noteOn  midi=${midiPitch}`);
  }

  triggerNoteOff(midiPitch: number): void {
    console.log(`[AudioEngine] noteOff midi=${midiPitch}`);
  }

  destroy(): void {
    if (this.ctx !== null) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
