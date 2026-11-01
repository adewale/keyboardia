export type TestScope = 'all' | 'smoke' | 'session-contract' | 'collaboration';

export function getWranglerStdio(): ['ignore', 'inherit', 'inherit'] {
  // Playwright is launched synchronously, so Node cannot drain child-process
  // pipes until the test run ends. Inherit Wrangler's output to prevent its
  // request log from filling an OS pipe and blocking the Worker mid-suite.
  return ['ignore', 'inherit', 'inherit'];
}

export function buildPlaywrightArgs(
  scope: TestScope,
  workerRequiredSpecs: readonly string[],
  passthroughArgs: readonly string[] = [],
): string[] {
  const args = scope === 'smoke'
    ? ['playwright', 'test', '--project=chromium', 'e2e/track-reorder.spec.ts', 'e2e/plock-editor.spec.ts', 'e2e/pitch-contour-alignment.spec.ts']
    : scope === 'session-contract'
      ? ['playwright', 'test', '--project=chromium', 'e2e/session-api-contract.spec.ts']
      : scope === 'collaboration'
        ? ['playwright', 'test', '--project=chromium', ...workerRequiredSpecs]
        // The 'all' scope names no --project, so Playwright runs every one:
        // chromium, webkit and both mobile profiles. The caller must therefore
        // be able to narrow it — CI installs chromium only, and without a
        // passthrough the run produced 248 webkit "browser not installed"
        // failures, plus enough parallel workers to saturate the single
        // wrangler instance (217 ECONNREFUSED). See docs/TEST-AUDIT-2026-07.md.
        : ['playwright', 'test', ...passthroughArgs];

  if (scope === 'collaboration') {
    // The production contract permits 100 session creates per IP per minute.
    // CI otherwise selects four fully-parallel Playwright workers, which turns
    // this functional contract into a rate-limit load test and can make the
    // local Worker unavailable to every remaining spec. Keep the complete
    // Worker-owned inventory, but execute it deterministically below the
    // production limit.
    args.push('--workers=1');
  }
  args.push('--retries=0');

  return args;
}
