import { describe, expect, it } from 'vitest';
import { MINIMAL_MUSICXML } from './parser/__fixtures__/minimal.musicxml.ts';
import { deriveLibraryEntryMetrics } from './scoreLibrary.ts';

describe('deriveLibraryEntryMetrics', () => {
  it('derives playback duration and measure count from MusicXML', () => {
    const metrics = deriveLibraryEntryMetrics(MINIMAL_MUSICXML);

    expect(metrics.measureCount).toBe(1);
    expect(metrics.durationSeconds).toBeGreaterThan(0);
  });
});
