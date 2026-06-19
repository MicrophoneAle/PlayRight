import { describe, expect, it } from 'vitest';
import { PlayingMidiPressTracker } from './playingMidiPressTracker.ts';

describe('PlayingMidiPressTracker', () => {
  it('tracks consecutive presses of the same midi independently', () => {
    const tracker = new PlayingMidiPressTracker();

    const firstPress = tracker.allocatePressId();
    tracker.press(60, firstPress);
    expect(tracker.activeMidis()).toEqual([60]);

    const secondPress = tracker.allocatePressId();
    tracker.press(60, secondPress);
    expect(tracker.activeMidis()).toEqual([60, 60]);

    tracker.release(firstPress);
    expect(tracker.activeMidis()).toEqual([60]);

    tracker.release(secondPress);
    expect(tracker.activeMidis()).toEqual([]);
  });

  it('allows the same midi to be pressed again after release', () => {
    const tracker = new PlayingMidiPressTracker();

    const firstPress = tracker.allocatePressId();
    tracker.press(60, firstPress);
    tracker.release(firstPress);
    expect(tracker.activeMidis()).toEqual([]);

    const secondPress = tracker.allocatePressId();
    tracker.press(60, secondPress);
    expect(tracker.activeMidis()).toEqual([60]);
  });
});
