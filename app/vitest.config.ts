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
  },
});
