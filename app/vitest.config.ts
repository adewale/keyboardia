import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude integration tests - they use a separate vitest config with workers pool
      'test/integration/**',
      // Exclude staging tests - they require a live server (run explicitly with vitest run test/staging/)
      'test/staging/**',
    ],
    // Include test files in src directory (both .ts and .tsx)
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    // Use jsdom for React hook tests
    environment: 'jsdom',
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
