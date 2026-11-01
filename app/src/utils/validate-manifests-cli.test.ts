import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('validate-manifests CLI', () => {
  const appRoot = join(__dirname, '..', '..');
  const scriptPath = join(appRoot, 'scripts', 'validate-manifests.ts');
  const tsxImportPath = createRequire(import.meta.url).resolve('tsx');

  it('rejects the unsupported --fix mode without claiming success', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', tsxImportPath, scriptPath, '--fix'],
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

  it('fails when baseNote is outside playableRange', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'keyboardia-manifest-'));
    const instrumentDir = join(fixtureRoot, 'public', 'instruments', 'piano');
    const registryDir = join(fixtureRoot, 'src', 'audio');
    mkdirSync(instrumentDir, { recursive: true });
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(join(instrumentDir, 'sample.wav'), 'fixture');
    writeFileSync(
      join(instrumentDir, 'manifest.json'),
      JSON.stringify({
        id: 'piano',
        name: 'Piano',
        type: 'sampled',
        baseNote: 73,
        releaseTime: 1,
        playableRange: { min: 48, max: 72 },
        samples: [{ note: 60, file: 'sample.wav' }],
      }),
    );
    writeFileSync(
      join(registryDir, 'sampled-instrument.ts'),
      "export const SAMPLED_INSTRUMENTS = ['piano'] as const;\n",
    );

    try {
      const result = spawnSync(process.execPath, ['--import', tsxImportPath, scriptPath], {
        cwd: fixtureRoot,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('CRITICAL FAILURES (1)');
      expect(result.stdout).toContain('[BASENOTE_OUTSIDE_RANGE]');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
