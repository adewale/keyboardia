/**
 * Keeps evals/shared-benchmark.json honest.
 *
 * The manifest is text, so nothing else in the suite notices when it drifts away
 * from the published skill, from the committed fixture, or from what the runner
 * can actually execute. These checks are cheap, need no model calls, and need no
 * particular agent — they are the always-on floor under the optional
 * skill-eval-harness audit that CI also runs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- dependency-free ESM runner, checked by this test rather than tsc
import { assertionSeverity, compilePattern, isJudgeAssertion } from '../../evals/run-benchmark.mjs';

const evalsDir = resolve('../evals');

interface Assertion {
  name: string;
  type: string;
  pattern?: string;
  prompt?: string;
  rubric?: string[];
  severity?: string;
  oracle?: string;
}

interface Case {
  id: string;
  kind: string;
  split?: string;
  prompt?: string;
  prompt_ref?: string;
  files?: string[];
  assertions?: Assertion[];
}

const manifest = JSON.parse(
  readFileSync(resolve(evalsDir, 'shared-benchmark.json'), 'utf8'),
) as {
  version: number;
  skill_name: string;
  skill_paths: string[];
  variants: string[];
  cases: Case[];
  ablations?: Array<{ id: string; mechanism?: string; target?: Record<string, string> }>;
};

const objectiveAssertions = manifest.cases.flatMap((testCase) =>
  (testCase.assertions ?? [])
    .filter((assertion) => !isJudgeAssertion(assertion))
    .map((assertion) => ({ testCase, assertion })),
);

describe('skill eval manifest', () => {
  it('points at the published skill and the committed fixture', () => {
    expect(manifest.version).toBe(2);
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
        expect(['gate', 'soft', 'critical']).toContain(assertionSeverity(assertion));
        if (isJudgeAssertion(assertion)) {
          // A judge with no question grades nothing.
          expect(
            Boolean(assertion.prompt || assertion.rubric),
            `${testCase.id}:${assertion.name}`,
          ).toBe(true);
          continue;
        }
        expect(['regex', 'not_regex']).toContain(assertion.type);
        expect(
          () => compilePattern(assertion.pattern!),
          `${testCase.id}:${assertion.name}`,
        ).not.toThrow();
      }
    }
  });

  it('has no assertion a model can satisfy by quoting the attached fixture', () => {
    // stable-retry-id once passed on models echoing the schema's own
    // "Reuse it when retrying add_track" description, so the without_skill arm
    // scored higher than the with_skill arm. An assertion the attachment
    // already answers measures the attachment, not the skill.
    const leaky: string[] = [];

    for (const { testCase, assertion } of objectiveAssertions) {
      if (assertion.type !== 'regex') {
        continue;
      }
      const attached = (testCase.files ?? [])
        .map((file) => readFileSync(resolve(evalsDir, file), 'utf8'))
        .join('\n');
      if (attached && compilePattern(assertion.pattern!).test(attached)) {
        leaky.push(`${testCase.id}:${assertion.name}`);
      }
    }

    expect(leaky).toEqual([]);
  });

  it('keeps hidden-split prompts out of the repository', () => {
    const hidden = manifest.cases.filter((testCase) => testCase.split && testCase.split !== 'tune');
    expect(hidden.length).toBeGreaterThan(0);

    for (const testCase of hidden) {
      // A hidden case with an inline prompt is a tune case wearing a label.
      expect(testCase.prompt, testCase.id).toBeUndefined();
      expect(testCase.prompt_ref, testCase.id).toBeTypeOf('string');

      const directory = testCase.prompt_ref!.split('/')[0]!;
      const ignore = resolve(evalsDir, directory, '.gitignore');
      expect(existsSync(ignore), `${directory}/.gitignore`).toBe(true);
      expect(readFileSync(ignore, 'utf8')).toContain('*.json');
    }
  });

  it('targets ablation sections that exist in the skill', () => {
    const skill = readFileSync(resolve('..', manifest.skill_paths[0]!), 'utf8');

    for (const ablation of manifest.ablations ?? []) {
      if (ablation.mechanism !== 'section') {
        continue;
      }
      expect(skill, `${ablation.id} -> ${ablation.target?.heading}`)
        .toContain(ablation.target!.heading!);
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

    expect(compilePattern(nestedAdd!.pattern!).test(addTrack)).toBe(true);
  });
});
