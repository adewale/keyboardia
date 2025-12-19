import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'keyboardia-staging',
    testTimeout: 30000, // Generous timeout for network operations
    hookTimeout: 30000,
    // Run tests sequentially to avoid overwhelming the server
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
