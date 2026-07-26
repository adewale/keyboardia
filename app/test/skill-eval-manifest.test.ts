/**
 * Keeps evals/shared-benchmark.json honest.
 *
 * The manifest is text, so nothing else in the suite notices when it drifts away
 * from the published skill, from the committed fixture, or from what the runner
 * can actually execute. These checks are cheap and need no model calls.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- dependency-free ESM runner, checked by this test rather than tsc
import { compilePattern } from '../../evals/run-benchmark.mjs';

const evalsDir = resolve('../evals');
const manifest = JSON.parse(
  readFileSync(resolve(evalsDir, 'shared-benchmark.json'), 'utf8'),
) as {
  skill_name: string;
  skill_paths: string[];
  variants: string[];
  cases: Array<{
    id: string;
    kind: string;
    prompt: string;
    files?: string[];
    assertions?: Array<{ name: string; type: string; pattern: string }>;
  }>;
};

describe('skill eval manifest', () => {
  it('points at the published skill and the committed fixture', () => {
    expect(manifest.variants).toEqual(['with_skill', 'without_skill']);
    for (const skillPath of manifest.skill_paths) {
      expect(existsSync(resolve('..', skillPath)), skillPath).toBe(true);
    }
    for (const testCase of manifest.cases) {
      for (const file of testCase.files ?? []) {
        expect(existsSync(resolve(evalsDir, file)), `${testCase.id} -> ${file}`).toBe(true);
      }
    }
  });

  it('names the skill that SKILL.md publishes', () => {
    const skill = readFileSync(resolve('..', manifest.skill_paths[0]!), 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toContain(`name: ${manifest.skill_name}`);
  });

  it('compiles every assertion the runner will execute', () => {
    const seen = new Set<string>();

    for (const testCase of manifest.cases) {
      expect(seen.has(testCase.id), `duplicate case id: ${testCase.id}`).toBe(false);
      seen.add(testCase.id);

      if (testCase.kind === 'trigger') {
        expect(testCase.assertions).toBeUndefined();
        continue;
      }

      expect(testCase.assertions?.length, testCase.id).toBeGreaterThan(0);
      for (const assertion of testCase.assertions!) {
        expect(['regex', 'not_regex']).toContain(assertion.type);
        expect(
          () => compilePattern(assertion.pattern),
          `${testCase.id}:${assertion.name}`,
        ).not.toThrow();
      }
    }
  });

  it('scores the skill\'s own published payloads as passing', () => {
    // The exact-payload assertions encode the SKILL.md examples. If an example is
    // reworded or reordered, the eval silently starts measuring something else.
    const skill = readFileSync(resolve('..', manifest.skill_paths[0]!), 'utf8');
    const addTrack = skill.slice(skill.indexOf('<!-- mcp-example:add-track -->'));
    const collision = manifest.cases.find(
      (testCase) => testCase.id === 'answer-collision-resistant-track',
    );
    const nestedAdd = collision!.assertions!.find(
      (assertion) => assertion.name === 'nested-add-payload',
    );

    expect(compilePattern(nestedAdd!.pattern).test(addTrack)).toBe(true);
  });
});
