import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import inventory from '../e2e/verification-impact.json';
import {
  readChangedPaths,
  selectVerificationScope,
} from '../scripts/select-verification-scope.mjs';
import {
  collectValidatorImportGraph,
  findValidatorOwnershipGaps,
  type VerificationImpactInventory,
} from '../scripts/verification-impact-graph';

const temporaryRepositories: string[] = [];
const validatorGraph = collectValidatorImportGraph();

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('cost-aware verification impact selection', () => {
  it('does not spend browser minutes for documentation-only changes', () => {
    const result = selectVerificationScope([
      'docs/TEST-AUDIT-2026-07.md',
      'specs/ADSR-OVERHAUL-v2.md',
    ], inventory);

    expect(result.selected).toEqual({
      browser: false,
      worker: false,
      audio: false,
      visual: false,
      samples: false,
      mobile: false,
    });
  });

  it('selects overlapping contracts for an audio engine change', () => {
    const result = selectVerificationScope(['app/src/audio/sample-voice.ts'], inventory);

    expect(result.selected).toMatchObject({ browser: true, audio: true, samples: true });
    expect(result.selected.worker).toBe(false);
    expect(result.selected.visual).toBe(false);
  });

  it('selects every T1 profile for an unclassified code path', () => {
    const result = selectVerificationScope(['tooling/new-runtime-check.ts'], inventory);

    expect(Object.values(result.selected)).toEqual([true, true, true, true, true, true]);
    expect(result.reasons[0]).toContain('unmatched path');
  });

  it('selects every T1 profile when the policy itself changes', () => {
    const result = selectVerificationScope(['.github/workflows/ci.yml'], inventory);

    expect(Object.values(result.selected)).toEqual([true, true, true, true, true, true]);
  });

  it.each([
    ['app/src/music/music-theory.ts', { browser: true, worker: true }],
    ['app/src/context/MultiplayerContext.tsx', { browser: true, worker: true }],
    ['app/src/shared/instrument-classification.ts', {
      browser: true, worker: true, samples: true,
    }],
    ['app/src/App.tsx', { browser: true, worker: true, visual: true, mobile: true }],
    ['app/src/App.css', { browser: true, visual: true, mobile: true }],
    ['app/e2e/mobile-iphone.spec.ts', {
      browser: true, worker: true, audio: true, visual: true, mobile: true,
    }],
  ])('selects every owning profile for %s', (path, expected) => {
    expect(selectVerificationScope([path], inventory).selected).toMatchObject(expected);
  });

  it('selects Instrument Validation for every transitive validate:all dependency', () => {
    expect(validatorGraph.entrypoints).toContain('app/scripts/validate-sustain-ceiling.ts');
    expect(validatorGraph.modules).toContain('app/src/shared/instrument-classification.ts');
    expect(findValidatorOwnershipGaps(
      inventory as VerificationImpactInventory,
      validatorGraph,
    )).toEqual([]);
  });

  it('fails closed when a transitive validator dependency loses sample ownership', () => {
    const brokenInventory = structuredClone(inventory) as VerificationImpactInventory;
    brokenInventory.profiles.samples.files = brokenInventory.profiles.samples.files
      .filter(path => path !== 'app/src/shared/instrument-classification.ts');

    const gaps = findValidatorOwnershipGaps(brokenInventory, validatorGraph);
    expect(gaps).toContainEqual({
      dependency: 'app/src/shared/instrument-classification.ts',
      importPath: [
        'app/scripts/validate-sustain-ceiling.ts',
        'app/src/shared/instrument-classification.ts',
      ],
    });
  });

  it('includes deletions and both sides of renames from the real git diff', () => {
    const repository = mkdtempSync(join(tmpdir(), 'verification-impact-'));
    temporaryRepositories.push(repository);
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
    }).trim();

    git('init', '--quiet');
    git('config', 'user.name', 'Verification Test');
    git('config', 'user.email', 'verification@example.test');
    mkdirSync(join(repository, 'app/src'), { recursive: true });
    writeFileSync(join(repository, 'app/src/deleted.ts'), 'export const deleted = true;\n');
    writeFileSync(join(repository, 'app/src/old-name.ts'), 'export const renamed = true;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    rmSync(join(repository, 'app/src/deleted.ts'));
    renameSync(join(repository, 'app/src/old-name.ts'), join(repository, 'app/src/new-name.ts'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'change');
    const head = git('rev-parse', 'HEAD');

    expect(readChangedPaths(base, head, repository).sort()).toEqual([
      'app/src/deleted.ts',
      'app/src/new-name.ts',
      'app/src/old-name.ts',
    ]);
  });
});
