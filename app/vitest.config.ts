import { defineConfig } from 'vitest/config';

// Three lanes. `vitest run` with no --project runs all of them, so running
// Vitest directly still runs everything; the npm scripts and CI select one
// lane each, and CI's Unit Tests job runs all three on every PR and push.
//
// `unit` is the fast product lane (T0 and the pre-push hook). Two kinds of
// suite used to dominate it: 15 of 317 files took ~92% of its CPU time, and
// the global timeout was raised from 5 s to 20 s to 30 s to absorb them.
// - `audio-render`: renders through the native node-web-audio-api
//   OfflineAudioContext with real sample decode. CPU-bound by nature.
// - `verification-tooling`: tests of this repository's own verification
//   machinery (evidence receipts, instrument-quality matrix and audit, the
//   runtime-boundary scanner, the test-quality analyzers, the eval manifest),
//   each costing tens of seconds of CPU.
// Move a file between lanes only with a measurement. Product behaviour tests
// belong in `unit`.
const AUDIO_RENDER_TESTS = [
  'src/audio/**/*.render.test.ts',
  'src/audio/instrument-range-render.test.ts',
];

const VERIFICATION_TOOLING_TESTS = [
  'test/eval-receipt.test.ts',
  'test/instrument-quality-audit.test.ts',
  'test/instrument-quality-matrix.test.ts',
  'test/runtime-boundary-scanner.test.ts',
  'test/skill-eval-manifest.test.ts',
  'test/unit/test-quality-analyzers.test.ts',
];

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude integration tests - they use a separate vitest config with workers pool
      'test/integration/**',
    ],
    // Pin fast-check's seed so property runs are reproducible instead of
    // exploring a different random slice of the input space every run.
    // Override with FC_SEED=<n>. See src/test/setup-fast-check.ts.
    setupFiles: ['./src/test/setup-fast-check.ts'],
    // pool: 'threads' is the default; we keep isolation on so module-
    // level state doesn't leak between files. `vmThreads` is faster but
    // requires every test to be isolation-safe — given how many of our
    // tests touch the audioEngine singleton, threads + isolate is the
    // right tradeoff.
    pool: 'threads',
    // Vitest 4 owns the adaptive worker count when maxWorkers is omitted.
    // The former poolOptions.threads block was removed in Vitest 4 and its
    // undefined min/max values never constrained the pool.
    // Default to node — fast (~1ms boot per file vs ~450ms for jsdom).
    // Tests that actually need a DOM opt in via the file-level directive:
    //   // @vitest-environment jsdom
    // 24 of 147 test files need jsdom (React component tests + a few
    // audio paths that touch globalThis.AudioContext); the other 123
    // run faster against node.
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Product tests plus pure deployment-check classifiers whose
          // failure modes must remain in the ordinary unit-test gate.
          include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'test/**/*.test.ts',
            'scripts/mcp-bot-protection-classifier.test.ts',
          ],
          exclude: [...AUDIO_RENDER_TESTS, ...VERIFICATION_TOOLING_TESTS],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'audio-render',
          include: AUDIO_RENDER_TESTS,
          // Renders that need longer declare it per test (60-180 s).
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'verification-tooling',
          include: VERIFICATION_TOOLING_TESTS,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
