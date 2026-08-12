// Stryker configuration — mutation testing for critical pure modules.
// Run with: npm run test:mutation
// See docs/LESSONS-LEARNED.md lesson 33.
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.app.json',
  reporters: ['html', 'progress', 'clear-text'],
  // Critical pure modules with strong invariants — high-value targets.
  // Avoiding files that bring in DOM or AudioContext at module load.
  mutate: [
    // The reducer every multiplayer mutation flows through. A manual sabotage
    // (neutering it to `return state`) was how the July 2026 audit found that
    // sync-convergence.property.test.ts caught only 5 of 24 — Stryker automates
    // exactly that experiment, so it should not have to be run by hand again.
    'src/shared/state-mutations.ts',
    // Polyrhythm step maths, extracted from the scheduler so it is testable.
    'src/audio/track-step.ts',
    'src/audio/scheduler-multiplayer-sync.ts',
    'src/audio/pitch-shift-range.ts',
    'src/audio/envelope-anchor.ts',
    'src/audio/scheduler-worklet-lateness.ts',
    'src/audio/note-dynamics.ts',
    'src/shared/scale-defaults.ts',
    'src/audio/metrics/percentile.ts',
    'src/audio/metrics/ring-buffer.ts',
    'src/test/audio-measures.ts',
    // HTTP/session metadata crosses an untyped trust boundary. Mutation tests
    // check that sad-path assertions reject malformed registry and loop data.
    'src/worker/validation.ts',
  ],
  thresholds: {
    high: 90,
    low: 70,
    break: null, // informational, not a merge gate
  },
  timeoutMS: 60000,
  concurrency: 4,
  coverageAnalysis: 'perTest',
};
