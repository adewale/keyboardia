import { describe, expect, it } from 'vitest';
import {
  analyzeExportReachability,
  collectModuleSpecifiers,
  scanTestSource,
  type SourceUnit,
} from '../../scripts/test-quality-analyzers';

const rules = (source: string) => scanTestSource('fixture.test.ts', source).map((finding) => finding.rule);

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

  it('accepts inline assertions and named assertion helpers', () => {
    const source = `
      it('checks inline', () => { expect(run()).toBe(2); });
      test.each([1])('checks helper', async (value) => { await expectSessionSynced(value); });
      it('checks page object', async () => { await page.expectStepActive(2); });
    `;
    expect(rules(source)).not.toContain('zero-assertion-test');
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
});
