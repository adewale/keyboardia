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
    'src/audio/scheduler-multiplayer-sync.ts',
    'src/audio/pitch-shift-range.ts',
    'src/audio/envelope-anchor.ts',
    'src/audio/scheduler-worklet-lateness.ts',
    'src/audio/metrics/percentile.ts',
    'src/audio/metrics/ring-buffer.ts',
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
