/**
 * Mocked-transport replay harness (R1). Emulates the Tone.js Transport
 * semantics PlaybackEngine depends on — integer-tick "<N>i" scheduling,
 * equal-tick dispatch in insertion order, scheduleOnce/clear/cancel — so a
 * full playback schedule (including repeat backward jumps) can be replayed
 * and inspected as text without a browser.
 *
 * The diagnostics deliberately watch for the failure modes this project has
 * actually hit in live playback:
 * - a callback throw wedging the transport queue (uncaughtCallbackErrors)
 * - fractional/NaN ticks that Tone's integer clock never matches, leaving
 *   events stranded forever (invalidTimes — the fermata-freeze bug)
 * - a hang where processing never completes (iterationLimitHit)
 * - events left neither fired nor cleared at the end (pendingEvents()).
 *
 * Test files wire this in via vi.mock('tone', ...) → getCurrentMockTransport().
 */

export interface MockScheduledEvent {
  id: number;
  tick: number;
  rawTime: string | number;
  insertionIndex: number;
  callback: (time: number) => void;
  fired: boolean;
  cleared: boolean;
}

export interface MockTransportDiagnostics {
  /** scheduleOnce times that are not finite non-negative integer ticks. */
  invalidTimes: Array<{ id: number; rawTime: string | number }>;
  /** Errors that escaped a callback (Tone would wedge; the mock records and continues). */
  uncaughtCallbackErrors: Array<{ id: number; tick: number; error: unknown }>;
  firedEventCount: number;
  /** True when run() hit its iteration guard — the schedule never settled. */
  iterationLimitHit: boolean;
}

export class MockTransport {
  PPQ = 480;
  bpm = { value: 120 };
  ticks = 0;
  state: 'started' | 'stopped' | 'paused' = 'stopped';
  readonly diagnostics: MockTransportDiagnostics = {
    invalidTimes: [],
    uncaughtCallbackErrors: [],
    firedEventCount: 0,
    iterationLimitHit: false,
  };

  private events: MockScheduledEvent[] = [];
  private nextEventId = 1;
  private nextInsertionIndex = 0;

  start(): void {
    this.state = 'started';
  }

  stop(): void {
    this.state = 'stopped';
    this.ticks = 0;
  }

  /** Accepts Tone's optional pause time; the mock only tracks state. */
  pause(): void {
    this.state = 'paused';
  }

  scheduleOnce(callback: (time: number) => void, rawTime: string | number): number {
    const id = this.nextEventId;
    this.nextEventId += 1;

    let tick = Number.NaN;
    if (typeof rawTime === 'string' && rawTime.endsWith('i')) {
      tick = Number(rawTime.slice(0, -1));
    } else if (typeof rawTime === 'number') {
      tick = rawTime;
    }

    if (!Number.isFinite(tick) || !Number.isInteger(tick) || tick < 0) {
      // Real Tone silently strands these on its integer clock.
      this.diagnostics.invalidTimes.push({ id, rawTime });
    }

    this.events.push({
      id,
      tick,
      rawTime,
      insertionIndex: this.nextInsertionIndex,
      callback,
      fired: false,
      cleared: false,
    });
    this.nextInsertionIndex += 1;
    return id;
  }

  clear(id: number): void {
    const event = this.events.find((candidate) => candidate.id === id);
    if (event && !event.fired) {
      event.cleared = true;
    }
  }

  /** Tone's Transport.cancel(after): drops every event at/after the tick. */
  cancel(afterTick: number): void {
    for (const event of this.events) {
      if (!event.fired && event.tick >= afterTick) {
        event.cleared = true;
      }
    }
  }

  /**
   * Dispatch pending events in (tick, insertionIndex) order — Tone fires
   * equal-tick events in insertion order — until the transport pauses/stops,
   * nothing is left, or the iteration guard trips. Callbacks may schedule
   * further events (rolling-window extensions); they join the queue live.
   */
  run(maxIterations = 500_000): void {
    let iterations = 0;

    while (this.state === 'started') {
      const next = this.takeNextPending();
      if (!next) {
        break;
      }

      iterations += 1;
      if (iterations > maxIterations) {
        this.diagnostics.iterationLimitHit = true;
        break;
      }

      next.fired = true;
      this.ticks = Math.max(this.ticks, next.tick);
      this.diagnostics.firedEventCount += 1;
      try {
        next.callback(this.ticks);
      } catch (error) {
        this.diagnostics.uncaughtCallbackErrors.push({
          id: next.id,
          tick: next.tick,
          error,
        });
      }
    }
  }

  pendingEvents(): MockScheduledEvent[] {
    return this.events.filter((event) => !event.fired && !event.cleared);
  }

  private takeNextPending(): MockScheduledEvent | null {
    let best: MockScheduledEvent | null = null;

    for (const event of this.events) {
      if (event.fired || event.cleared || !Number.isFinite(event.tick)) {
        continue;
      }
      if (
        best === null ||
        event.tick < best.tick ||
        (event.tick === best.tick && event.insertionIndex < best.insertionIndex)
      ) {
        best = event;
      }
    }

    return best;
  }
}

let currentMockTransport = new MockTransport();

export function getCurrentMockTransport(): MockTransport {
  return currentMockTransport;
}

export function resetMockTransport(): MockTransport {
  currentMockTransport = new MockTransport();
  return currentMockTransport;
}
