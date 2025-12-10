import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude integration tests - they use a separate vitest config with workers pool
      'test/integration/**',
    ],
    // Include test files in src directory
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
