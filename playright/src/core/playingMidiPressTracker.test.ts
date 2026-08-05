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

  it('never recycles pressIds across clear(), so stale releases cannot collide', () => {
    const tracker = new PlayingMidiPressTracker();

    const beforeClear = [
      tracker.allocatePressId(),
      tracker.allocatePressId(),
      tracker.allocatePressId(),
    ];

    // pause() clears the tracker but deliberately keeps the Transport's
    // scheduled release events, so ids allocated after this must not repeat.
    tracker.clear();

    const afterClear = [tracker.allocatePressId(), tracker.allocatePressId()];
    expect(afterClear.some((id) => beforeClear.includes(id))).toBe(false);

    // Three pause cycles in a row (the reported degradation pattern).
    const seen = new Set([...beforeClear, ...afterClear]);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      tracker.clear();
      for (let i = 0; i < 4; i += 1) {
        const pressId = tracker.allocatePressId();
        expect(seen.has(pressId)).toBe(false);
        seen.add(pressId);
      }
    }
  });

  it('remembers a release only inside a deferral window, so tombstones stay bounded', () => {
    const tracker = new PlayingMidiPressTracker();
    const tombstones = () =>
      (tracker as unknown as { releasedPressIds: Set<number> }).releasedPressIds.size;

    // An ordinary press/release pair leaves nothing behind.
    for (let i = 0; i < 500; i += 1) {
      const pressId = tracker.allocatePressId();
      tracker.press({ pressId, stepIndex: i, midi: 60, hand: 'R' });
      tracker.release(pressId);
    }
    expect(tombstones()).toBe(0);

    // A release inside a deferral window IS remembered - that is the race the
    // tombstone exists to close - and is dropped when the window closes.
    const deferred = tracker.allocatePressId();
    tracker.beginDeferredPress(deferred);
    tracker.release(deferred);
    expect(tracker.wasReleased(deferred)).toBe(true);
    expect(tombstones()).toBe(1);

    tracker.endDeferredPress(deferred);
    expect(tracker.wasReleased(deferred)).toBe(false);
    expect(tombstones()).toBe(0);
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
