import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Read CSS files at config time (before Workers sandbox starts)
// so they can be accessed via text bindings in tests
const stepSequencerCss = readFileSync(
  resolve(__dirname, '../../src/components/StepSequencer.css'),
  'utf-8',
);

// Migrated from defineWorkersProject() (vitest-pool-workers v3 API) to the
// vitest 4 plugin form: the old `test.poolOptions.workers` object is now the
// argument to the `cloudflareTest()` plugin. See the package's
// `codemods/vitest-v3-to-v4` for the upstream migration.
export default defineConfig({
  plugins: [
    cloudflareTest({
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
    }),
  ],
  resolve: {
    alias: {
      // `automation-events` (a transitive dep of `tone`, pulled in via
      // src/sync/multiplayer) ships a `"browser"` entry pointing at an ES5 UMD
      // bundle. The Workers test runtime resolves the `browser` condition, so
      // it loaded that bundle and crashed with "_createClass is not a function".
      // Pin it to the native-class ESM build instead. (vitest 3 did not select
      // the browser condition here; this keeps the suite green on vitest 4.)
      'automation-events': resolve(
        __dirname,
        '../../node_modules/automation-events/build/es2019/module.js',
      ),
    },
  },
  test: {
    name: 'keyboardia-integration',
  },
});
