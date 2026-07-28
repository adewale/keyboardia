import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeExportReachability,
  collectModuleSpecifiers,
  collectUsedModuleSpecifiers,
  findUnrunTestFiles,
  scanTestSource,
  type SourceUnit,
} from '../../scripts/test-quality-analyzers';

const rules = (source: string) => scanTestSource('fixture.test.ts', source).map((finding) => finding.rule);

function runChecker(script: string, files: Record<string, string>) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'keyboardia-quality-gate-'));
  try {
    mkdirSync(path.join(fixture, 'src'), { recursive: true });
    mkdirSync(path.join(fixture, 'test'), { recursive: true });
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(fixture, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    return spawnSync(
      process.execPath,
      ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('scripts', script)],
      { cwd: fixture, encoding: 'utf8' },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('test anti-pattern analyzer', () => {
  it('finds a zero-assertion test whose whole body is on the declaration line', () => {
    expect(rules(`it('does work', () => { doWork(); });`)).toContain('zero-assertion-test');
  });

  it('finds zero-assertion test.each and it.each cases', () => {
    const source = `
      test.each([1, 2])('case %s', (value) => { consume(value); });
      it.each\`value\n${'${1}'}\`('case $value', ({ value }) => consume(value));
    `;
    expect(rules(source).filter((rule) => rule === 'zero-assertion-test')).toHaveLength(2);
  });

  it('accepts inline assertions and assertion-specific helpers', () => {
    const source = `
      it('checks inline', () => { expect(run()).toBe(2); });
      test.each([1])('checks helper', async (value) => { await expectSessionSynced(value); });
      it('checks page object', async () => { await page.expectStepActive(2); });
    `;
    expect(rules(source)).not.toContain('zero-assertion-test');
  });

  it('does not trust generic helper names or waits as assertions', () => {
    const source = `
      it('generic helper', () => { checkNothing(); });
      it('timer wait', async () => { await page.waitForTimeout(50); });
    `;
    expect(rules(source).filter((rule) => rule === 'zero-assertion-test')).toHaveLength(2);
  });

  it('finds multiline swallowed assertions', () => {
    const source = `
      it('must reject', async () => {
        await expect(run())
          .rejects.toThrow()
          .catch(() => {
          });
      });
    `;
    expect(rules(source)).toContain('nullified-assertion');
  });

  it('finds assertions swallowed by non-empty catch handlers and try/catch', () => {
    const source = `
      it('promise catch', async () => {
        await expect(run()).rejects.toThrow().catch(error => report(error));
      });
      it('try catch', () => {
        try { expect(run()).toBe(1); } catch (error) { report(error); }
      });
    `;
    expect(rules(source)).toEqual(expect.arrayContaining([
      'nullified-assertion',
      'assertion-swallowed-by-own-catch',
      'zero-assertion-test',
    ]));
  });

  it('does not count unreachable or uninvoked assertions', () => {
    const source = `
      it('false branch', () => { if (false) expect(run()).toBe(1); });
      it('nested helper', () => { function neverCalled() { expect(run()).toBe(1); } });
    `;
    expect(rules(source).filter((rule) => rule === 'zero-assertion-test')).toHaveLength(2);
  });

  it('finds property tests that pass when the production bridge disappears', () => {
    const source = `
      it('stays equivalent', () => {
        fc.assert(fc.property(actionArb, action => {
          const message = actionToMessage(action);
          if (!message) return true;
          return apply(message) === reduce(action);
        }));
      });
    `;
    expect(rules(source)).toContain('vacuous-property-guard');
  });

  it('finds bare property guards and test definitions that execute no rows', () => {
    const source = `
      it('property', () => fc.assert(fc.property(valueArb, value => {
        if (!value) return;
        expect(run(value)).toBe(true);
      })));
      test.skipIf(true)('skipped', () => expect(run()).toBe(true));
      test.runIf(false)('also skipped', () => expect(run()).toBe(true));
      it.each([])('empty %s', value => expect(value).toBe(true));
    `;
    expect(rules(source)).toEqual(expect.arrayContaining([
      'vacuous-property-guard',
      'runtime-self-skip',
      'empty-test-table',
    ]));
    expect(rules(source).filter((rule) => rule === 'runtime-self-skip')).toHaveLength(2);
  });

  it('finds literal tautologies, stable self-comparisons, and string coercion oracles', () => {
    const source = `
      it('bad oracles', () => {
        expect('fixed').toBe('fixed');
        expect(result.value).toEqual(result.value);
        expect(String(result.maybe)).toBeDefined();
      });
    `;
    expect(rules(source)).toEqual(expect.arrayContaining([
      'tautological-assertion',
      'self-comparison',
      'always-defined-coercion',
    ]));
  });

  it('ignores examples in comments and test names', () => {
    const source = `
      // expect(true).toBe(true)
      it('documents expect(true).toBe(true)', () => expect(run()).toBe(true));
    `;
    expect(rules(source)).not.toContain('tautological-assertion');
  });
});

describe('module linkage analyzer', () => {
  it('collects single-quoted, double-quoted, re-exported, and dynamic specifiers', () => {
    const source = `
      import { a } from './single';
      import { b } from "./double";
      export { c } from './reexport';
      const lazy = () => import("./dynamic");
    `;
    expect(collectModuleSpecifiers(source)).toEqual([
      './single', './double', './reexport', './dynamic',
    ]);
  });

  it('requires a static import binding to be used while retaining dynamic imports', () => {
    const source = `
      import './side-effect';
      import { unused } from './unused';
      import { live } from './live';
      consume(live);
      void import('./dynamic');
    `;
    expect(collectUsedModuleSpecifiers(source)).toEqual(['./live', './dynamic']);
  });

  it('does not let a same-named import from another module hide a dead export', () => {
    const units: SourceUnit[] = [
      { file: 'src/a.ts', source: 'export const same = 1;', isTest: false },
      { file: 'src/b.ts', source: 'export const same = 2;', isTest: false },
      { file: 'src/live.ts', source: `import { same } from './a'; consume(same);`, isTest: false },
      { file: 'test/b.test.ts', source: `import { same } from '../src/b'; expect(same).toBe(2);`, isTest: true },
      { file: 'test/b-again.test.ts', source: `import { same } from '../src/b'; expect(same).toBe(2);`, isTest: true },
    ];

    expect(analyzeExportReachability(units).filter(({ status }) => status !== 'runtime')).toEqual([
      { file: 'src/b.ts', name: 'same', kind: 'const', testFiles: 2, status: 'test-only' },
    ]);
  });

  it('treats exact production imports and namespace imports as live', () => {
    const units: SourceUnit[] = [
      { file: 'src/a.ts', source: 'export const one = 1; export function two() {}', isTest: false },
      { file: 'src/live.ts', source: `import * as values from './a'; consume(values.one, values.two);`, isTest: false },
    ];
    expect(analyzeExportReachability(units).every(({ status }) => status === 'runtime')).toBe(true);
  });

  it('does not count an unused named import or a dead-to-dead call chain', () => {
    const units: SourceUnit[] = [
      { file: 'src/main.ts', source: `import { outer } from './dead'; void 0;`, isTest: false, isEntry: true },
      {
        file: 'src/dead.ts',
        source: `export function inner() { return 1; } export function outer() { return inner(); }`,
        isTest: false,
      },
    ];

    expect(analyzeExportReachability(units).map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'inner', status: 'unreferenced' },
      { name: 'outer', status: 'unreferenced' },
    ]);
  });

  it('tracks exact members through dynamic imports and worker URL queries', () => {
    const units: SourceUnit[] = [
      {
        file: 'src/main.ts',
        source: `
          import workerUrl from './worker.ts?worker&url';
          void workerUrl;
          export async function load() {
            return import('./lazy').then(mod => mod.used());
          }
          void load();
        `,
        isTest: false,
        isEntry: true,
      },
      {
        file: 'src/worker.ts',
        source: `import { kernel } from './kernel'; kernel();`,
        isTest: false,
      },
      { file: 'src/kernel.ts', source: `export const kernel = () => 1;`, isTest: false },
      {
        file: 'src/lazy.ts',
        source: `export const used = () => 1; export const unused = () => 2;`,
        isTest: false,
      },
    ];

    const statuses = Object.fromEntries(
      analyzeExportReachability(units).map(({ name, status }) => [name, status]),
    );
    expect(statuses).toMatchObject({ load: 'runtime', kernel: 'runtime', used: 'runtime', unused: 'unreferenced' });
  });

  it('distinguishes build-only consumers from runtime and tests', () => {
    const units: SourceUnit[] = [
      { file: 'src/value.ts', source: `export const value = 1;`, isTest: false },
      {
        file: 'scripts/check.ts',
        source: `import { value } from '../src/value'; consume(value);`,
        isTest: false,
        role: 'build',
        isEntry: true,
      },
      { file: 'src/main.ts', source: 'void 0;', isTest: false, isEntry: true },
    ];

    expect(analyzeExportReachability(units)).toContainEqual({
      file: 'src/value.ts', name: 'value', kind: 'const', testFiles: 0, status: 'build-only',
    });
  });

  it('tracks local export lists, aliases, and export-star barrels', () => {
    const units: SourceUnit[] = [
      { file: 'src/main.ts', source: `import { live } from './barrel'; consume(live);`, isTest: false, isEntry: true },
      { file: 'src/impl.ts', source: `const live = 1; const dead = 2; export { live, dead as hidden };`, isTest: false },
      { file: 'src/barrel.ts', source: `export * from './impl';`, isTest: false },
    ];

    expect(analyzeExportReachability(units).map(({ file, name, status }) => ({ file, name, status })))
      .toEqual(expect.arrayContaining([
        { file: 'src/impl.ts', name: 'live', status: 'runtime' },
        { file: 'src/impl.ts', name: 'hidden', status: 'unreferenced' },
        { file: 'src/barrel.ts', name: 'live', status: 'runtime' },
        { file: 'src/barrel.ts', name: 'hidden', status: 'unreferenced' },
      ]));
  });

  it('does not treat type-only imports as runtime callers', () => {
    const units: SourceUnit[] = [
      { file: 'src/main.ts', source: `import type { RuntimeThing } from './thing'; void 0;`, isTest: false, isEntry: true },
      { file: 'src/thing.ts', source: `export class RuntimeThing {}`, isTest: false },
    ];

    expect(analyzeExportReachability(units)).toContainEqual({
      file: 'src/thing.ts', name: 'RuntimeThing', kind: 'class', testFiles: 0, status: 'unreferenced',
    });
  });
});

describe('quality gate CLIs', () => {
  it('fails the test/subject linkage command on a real orphan fixture', () => {
    const result = runChecker('check-test-subject-links.ts', {
      'src/widget.ts': 'export const widget = 1;',
      'src/widget.test.ts': `it('checks widget', () => expect(1).toBe(1));`,
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('ORPHAN (1)');
  });

  it('passes the test/subject linkage command on a clean fixture', () => {
    const result = runChecker('check-test-subject-links.ts', {
      'src/widget.ts': 'export const widget = 1;',
      'src/main.ts': `import { widget } from './widget'; consume(widget);`,
      'src/widget.test.ts': `import { widget } from './widget'; it('checks widget', () => expect(widget).toBe(1));`,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Every test file is linked');
  });

  it('does not let an unused or side-effect-only import satisfy subject linkage', () => {
    for (const imported of [
      `import './widget';`,
      `import { widget } from './widget';`,
    ]) {
      const result = runChecker('check-test-subject-links.ts', {
        'src/widget.ts': 'export const widget = 1;',
        'src/widget.test.ts': `${imported} it('claims coverage', () => expect(1).toBe(1));`,
      });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain('ORPHAN (1)');
    }
  });

  it('fails the dead-export command on a real unreachable export fixture', () => {
    const result = runChecker('check-dead-exports.ts', {
      'src/main.ts': 'void 0;',
      'src/dead.ts': 'export const abandoned = 1;',
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('EXPORTED BUT UNIMPORTED (1)');
  });

  it('fails the dead-export command on an unreachable local export list', () => {
    const result = runChecker('check-dead-exports.ts', {
      'src/main.ts': 'void 0;',
      'src/dead.ts': 'const abandoned = 1; export { abandoned };',
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('EXPORTED BUT UNIMPORTED (1)');
  });

  it('passes the dead-export command on a clean fixture', () => {
    const result = runChecker('check-dead-exports.ts', {
      'src/main.ts': 'void 0;',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('No dead runtime exports');
  });
});

describe('unrun test file analyzer', () => {
  const onDisk = ['a.test.ts', 'b.test.ts', 'staging/c.test.ts'];

  it('reports a test file no runner collects', () => {
    const { unlisted } = findUnrunTestFiles(onDisk, ['a.test.ts'], ['staging/c.test.ts']);
    expect(unlisted).toEqual(['b.test.ts']);
  });

  it('stays silent when an unrun file is on the allowlist', () => {
    const { unlisted } = findUnrunTestFiles(onDisk, ['a.test.ts', 'b.test.ts'], ['staging/c.test.ts']);
    expect(unlisted).toEqual([]);
  });

  it('reports an allowlist entry that a lane now runs, so the list cannot outlive its reason', () => {
    const { staleAllowances } = findUnrunTestFiles(onDisk, onDisk, ['staging/c.test.ts']);
    expect(staleAllowances).toEqual(['staging/c.test.ts']);
  });

  it('reports an allowlist entry for a file that no longer exists', () => {
    const { staleAllowances } = findUnrunTestFiles(onDisk, onDisk, ['deleted.test.ts']);
    expect(staleAllowances).toEqual(['deleted.test.ts']);
  });

  it('does not treat a collected file that is absent from disk as unrun', () => {
    const { unlisted, staleAllowances } = findUnrunTestFiles(['a.test.ts'], ['a.test.ts', 'ghost.test.ts'], []);
    expect({ unlisted, staleAllowances }).toEqual({ unlisted: [], staleAllowances: [] });
  });
});
