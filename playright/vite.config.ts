import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Raised from vitest's 5s default. The heavy PlaybackEngine suites
    // (schedule-cache, schedule-tick, visual-defer, slur-schedule) legitimately
    // take ~3s: they load an 849-step fixture and run real engine work
    // (engine.play() plus repeated extendScheduleWindow passes). Under parallel
    // load - or thermal throttle on a low-power dev machine - that crosses 5s
    // and vitest reports "Test timed out in 5000ms". Those were the only
    // observed intermittent failures; not one was ever an assertion failure.
    //
    // A bump is the right fix here rather than a workaround, because none of
    // the affected assertions have timing semantics: they check spy call counts,
    // a deferred-press fraction against a mocked transport, and musical (not
    // wall-clock) durations. The 5s budget was incidental to the work, so a
    // tight value added flakiness without adding signal. visual-defer's heaviest
    // test already carried an explicit `}, 20000)` for this exact reason, which
    // is why it failed least often.
    //
    // Measured alternatives, rejected: capping workers (maxWorkers 4 still
    // flaked; 2 and serial were 1.3-2x slower with no stability gain), and
    // caching parsed fixtures via globalSetup (fixture load is only ~570ms of
    // the 5000ms budget - ~3% of suite time - so it cannot fix this).
    testTimeout: 20000,
  },
})
