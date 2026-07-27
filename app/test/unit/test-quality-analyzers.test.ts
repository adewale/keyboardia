import { describe, expect, it } from 'vitest';
import {
  analyzeDeadExports,
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
    ];

    expect(analyzeDeadExports(units)).toEqual([
      { file: 'src/b.ts', name: 'same', kind: 'const', testFiles: 1 },
    ]);
  });

  it('treats exact production imports and namespace imports as live', () => {
    const units: SourceUnit[] = [
      { file: 'src/a.ts', source: 'export const one = 1; export function two() {}', isTest: false },
      { file: 'src/live.ts', source: `import * as values from './a'; consume(values.one, values.two);`, isTest: false },
    ];
    expect(analyzeDeadExports(units)).toEqual([]);
  });
});
