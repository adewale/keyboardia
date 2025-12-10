import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'keyboardia-integration',
    poolOptions: {
      workers: {
        singleWorker: true,
        // Disable isolated storage because our worker uses waitUntil() for
        // fire-and-forget logging operations that outlive individual requests.
        // This means tests share storage and won't automatically clean up.
        isolatedStorage: false,
        wrangler: {
          configPath: '../../wrangler.jsonc',
        },
      },
    },
  },
});
