import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// Read CSS files at config time (before Workers sandbox starts)
// so they can be accessed via text bindings in tests
const stepSequencerCss = readFileSync(
  resolve(__dirname, '../../src/components/StepSequencer.css'),
  'utf-8',
);

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
        miniflare: {
          // Expose CSS file content as a binding for tests that verify CSS rules
          bindings: {
            STEP_SEQUENCER_CSS: stepSequencerCss,
          },
        },
      },
    },
  },
});
