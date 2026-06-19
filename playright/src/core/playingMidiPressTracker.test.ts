import { describe, expect, it } from 'vitest';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';

describe('PlayingMidiPressTracker', () => {
  it('tracks consecutive presses of the same midi independently', () => {
    const tracker = new PlayingMidiPressTracker();

    const firstPress = tracker.allocatePressId();
    tracker.press({ pressId: firstPress, stepIndex: 0, midi: 60, hand: 'R' });
    expect(tracker.activeMidis()).toEqual([60]);

    const secondPress = tracker.allocatePressId();
    tracker.press({ pressId: secondPress, stepIndex: 1, midi: 60, hand: 'R' });
    expect(tracker.activeMidis()).toEqual([60, 60]);

    tracker.release(firstPress);
    expect(tracker.activeMidis()).toEqual([60]);
    expect(tracker.activeNotes()).toEqual([
      { pressId: secondPress, stepIndex: 1, midi: 60, hand: 'R' },
    ]);

    tracker.release(secondPress);
    expect(tracker.activeMidis()).toEqual([]);
  });

  it('allows the same midi to be pressed again after release', () => {
    const tracker = new PlayingMidiPressTracker();

    const firstPress = tracker.allocatePressId();
    tracker.press({ pressId: firstPress, stepIndex: 0, midi: 60, hand: 'R' });
    tracker.release(firstPress);

    const secondPress = tracker.allocatePressId();
    tracker.press({ pressId: secondPress, stepIndex: 2, midi: 60, hand: 'R' });
    expect(tracker.activeNotes()).toEqual([
      { pressId: secondPress, stepIndex: 2, midi: 60, hand: 'R' },
    ]);
  });
});
