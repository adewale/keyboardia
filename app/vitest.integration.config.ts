import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
