import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude integration tests - they use a separate vitest config with workers pool
      'test/integration/**',
    ],
    // Include product tests plus pure deployment-check classifiers whose
    // failure modes must remain in the ordinary unit-test gate.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'test/**/*.test.ts',
      'scripts/mcp-bot-protection-classifier.test.ts',
    ],
    // Pin fast-check's seed so property runs are reproducible instead of
    // exploring a different random slice of the input space every run.
    // Override with FC_SEED=<n>. See src/test/setup-fast-check.ts.
    setupFiles: ['./src/test/setup-fast-check.ts'],
    // The 5s vitest default assumes a fast developer machine. The heaviest
    // tests here are CPU-bound (offline audio decode/render, production-graph
    // AST scans) and measure 2-13s in isolation on a 4-core runner; with
    // maxThreads using every core, full-suite contention pushes them past 5s
    // nondeterministically. 30s keeps hang detection while removing
    // machine-speed flakes.
    testTimeout: 30_000,
    // pool: 'threads' is the default; we keep isolation on so module-
    // level state doesn't leak between files. `vmThreads` is faster but
    // requires every test to be isolation-safe — given how many of our
    // tests touch the audioEngine singleton, threads + isolate is the
    // right tradeoff.
    pool: 'threads',
    poolOptions: {
      threads: {
        // Use available cores; default is half-cpu-count which leaves
        // headroom on the table.
        maxThreads: undefined,
        minThreads: undefined,
      },
    },
    // Default to node — fast (~1ms boot per file vs ~450ms for jsdom).
    // Tests that actually need a DOM opt in via the file-level directive:
    //   // @vitest-environment jsdom
    // 24 of 147 test files need jsdom (React component tests + a few
    // audio paths that touch globalThis.AudioContext); the other 123
    // run faster against node.
    environment: 'node',
    // Branch coverage configuration. Run with `npx vitest run --coverage`.
    // Coverage is informational — pragmatic thresholds, not a merge gate.
    // See docs/LESSONS-LEARNED.md lesson 33.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.property.test.ts',
        'src/**/*.d.ts',
        'src/types/**',
        'src/**/worklets/*.worklet.ts',
      ],
      reportOnFailure: true,
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
});
