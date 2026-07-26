import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('validate-manifests CLI', () => {
  const appRoot = join(__dirname, '..', '..');
  const scriptPath = join(appRoot, 'scripts', 'validate-manifests.ts');

  it('rejects the unsupported --fix mode without claiming success', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', scriptPath, '--fix'],
      {
        cwd: appRoot,
        encoding: 'utf-8',
        timeout: 30000,
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--fix is not implemented');
    expect(result.stderr).toContain('no files were changed');
    expect(result.stdout).not.toContain('COMPREHENSIVE MANIFEST VALIDATOR');
  });
});
