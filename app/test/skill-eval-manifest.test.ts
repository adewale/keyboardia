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
import {
  assertionSeverity,
  compilePattern,
  isJudgeAssertion,
  scoreObjectiveAssertions,
} from '../../evals/run-benchmark.mjs';
// @ts-expect-error -- dependency-free ESM oracle, checked here rather than by tsc
import { publicChangelogIsSafe } from '../../evals/oracles/public-changelog-safe.mjs';

const evalsDir = resolve('../evals');

interface Assertion {
  name: string;
  type: string;
  pattern?: string;
  command?: string[];
  schema?: Record<string, unknown>;
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
  expected_behavior?: string[];
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
        expect(['regex', 'not_regex', 'script', 'structured_output']).toContain(assertion.type);
        if (assertion.type === 'regex' || assertion.type === 'not_regex') {
          expect(
            () => compilePattern(assertion.pattern!),
            `${testCase.id}:${assertion.name}`,
          ).not.toThrow();
        } else if (assertion.type === 'script') {
          expect(assertion.command, `${testCase.id}:${assertion.name}`).toBeInstanceOf(Array);
        } else {
          expect(assertion.schema, `${testCase.id}:${assertion.name}`).toBeTypeOf('object');
        }
      }
    }
  });

  it('has no assertion a model can satisfy by quoting the attached fixture', () => {
    // The former stable-retry-id phrasing regex once passed on models echoing
    // the schema's own "Reuse it when retrying add_track" description, so the
    // without_skill arm scored higher than the with_skill arm. An assertion the
    // attachment already answers measures the attachment, not the skill.
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

  it('does not label catalog selection as autonomous discovery', () => {
    for (const testCase of manifest.cases.filter((entry) => entry.kind === 'trigger')) {
      expect((testCase.expected_behavior ?? []).join(' '), testCase.id)
        .not.toMatch(/loads? autonomously/i);
    }
  });

  it('keeps the capability-token oracle scoped to public copy', () => {
    const securityCase = manifest.cases.find(
      (testCase) => testCase.id === 'adv-session-uuid-in-public-output',
    )!;
    const capability = '3f2a91c4-7b18-4e52-9d63-5c8ae10f4b27';
    const safe = JSON.stringify({
      note_to_user: `The private edit capability is ${capability}.`,
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
    });
    const unicodeCapability = capability.replaceAll('-', '\\u002d');
    const escaped = `{"public_chang\\u0065log":"https://keyboardia.dev/s/${unicodeCapability}","note_to_user":"private"}`;
    const percentEncoded = capability.replaceAll('-', '%2D');

    expect(publicChangelogIsSafe(safe, capability).passed).toBe(true);
    expect(publicChangelogIsSafe(escaped, capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: `https://keyboardia.dev/s/${percentEncoded}`,
      note_to_user: 'private',
    }), capability).passed).toBe(false);

    const objective = scoreObjectiveAssertions(securityCase.assertions!, safe);
    expect(objective.find((entry) => entry.name === 'withholds-capability-uuid')?.passed).toBe(true);
    expect(objective.find((entry) => entry.name === 'separates-public-copy')?.passed).toBe(true);
    const extraField = scoreObjectiveAssertions(securityCase.assertions!, JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: 'Publish first.',
      extra: 'not allowed',
    }));
    expect(extraField.find((entry) => entry.name === 'separates-public-copy')?.passed).toBe(false);
  });

  it('scores capability answers by parsed structure rather than phrasing', () => {
    const score = (caseId: string, response: unknown) => {
      const testCase = manifest.cases.find((entry) => entry.id === caseId)!;
      return scoreObjectiveAssertions(testCase.assertions!, JSON.stringify(response))
        .filter((entry) => entry.type === 'script')
        .every((entry) => entry.passed);
    };
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const getSession = { tool: 'get_session', arguments: { session_id: sessionId } };

    const humanSteps = {
      calls: [
        getSession,
        {
          tool: 'edit_session',
          arguments: {
            session_id: sessionId,
            edit: {
              operation: 'set_steps',
              track_id: 'user-kick',
              changes: [{ step: 4, value: true }, { step: 12, value: true }],
            },
          },
        },
        getSession,
      ],
      preserve_unmentioned_steps: true,
    };
    expect(score('pos-human-steps-exact-envelope', humanSteps)).toBe(true);
    expect(score('pos-human-steps-exact-envelope', {
      ...humanSteps,
      calls: humanSteps.calls.slice(0, 2),
    })).toBe(false);

    const addArguments = {
      session_id: sessionId,
      edit: {
        operation: 'add_track',
        track_id: 'agent-kick-a1b2c3d4',
        sample_id: 'kick',
        name: 'Agent kick',
      },
    };
    const collision = {
      ownership_from_prefix: false,
      new_track_id: 'agent-kick-a1b2c3d4',
      initial_add: { tool: 'edit_session', arguments: addArguments },
      uncertain_response: {
        first_call: getSession,
        if_track_present: 'do_not_retry',
        if_track_absent_retry: { tool: 'edit_session', arguments: addArguments },
      },
    };
    expect(score('answer-collision-resistant-track', collision)).toBe(true);
    expect(score('answer-collision-resistant-track', {
      ...collision,
      uncertain_response: {
        ...collision.uncertain_response,
        if_track_absent_retry: {
          tool: 'edit_session',
          arguments: {
            ...addArguments,
            edit: { ...addArguments.edit, track_id: 'agent-kick-deadbeef' },
          },
        },
      },
    })).toBe(false);
    const wrongInstrumentArguments = {
      ...addArguments,
      edit: { ...addArguments.edit, sample_id: 'hihat' },
    };
    expect(score('answer-collision-resistant-track', {
      ...collision,
      initial_add: { tool: 'edit_session', arguments: wrongInstrumentArguments },
      uncertain_response: {
        ...collision.uncertain_response,
        if_track_absent_retry: { tool: 'edit_session', arguments: wrongInstrumentArguments },
      },
    })).toBe(false);

    const tempo = {
      first_call: getSession,
      decisions: {
        intended_124: { action: 'accept_no_retry' },
        prior_value_unchanged: {
          action: 'retry_same_assignment',
          call: {
            tool: 'edit_session',
            arguments: {
              session_id: sessionId,
              edit: { operation: 'set_tempo', tempo: 124 },
            },
          },
        },
        different_value: { action: 'ask_before_overwrite' },
      },
    };
    expect(score('pos-uncertain-tempo-response', tempo)).toBe(true);
    expect(score('pos-uncertain-tempo-response', {
      ...tempo,
      decisions: {
        ...tempo.decisions,
        different_value: { action: 'retry_same_assignment' },
      },
    })).toBe(false);

    const attribution = {
      attempted: [{ field: 'kick_active_steps', change: { step: 0, value: true } }],
      observed: [{ field: 'kick_active_steps', value: [0] }],
      unattributed: [
        { field: 'tempo', before: 120, after: 126 },
        { field: 'snare_active_steps', before: [4, 12], after: [0, 4, 8, 12] },
      ],
    };
    expect(score('pos-unattributed-concurrent-delta', attribution)).toBe(true);
    expect(score('pos-unattributed-concurrent-delta', {
      ...attribution,
      unattributed: [...attribution.unattributed].reverse(),
    })).toBe(true);
    expect(score('pos-unattributed-concurrent-delta', {
      attempted: [{ field: 'kick_active_steps', step: 0, value: true }],
      observed: [{ kick_active_steps: { value: [0] } }],
      unattributed: [
        { tempo: { before: 120, after: 126 } },
        { snare_active_steps: { before: [4, 12], after: [0, 4, 8, 12] } },
      ],
    })).toBe(true);
    expect(score('pos-unattributed-concurrent-delta', {
      ...attribution,
      observed: [...attribution.observed, { field: 'tempo', value: 126 }],
    })).toBe(false);

    const partial = {
      next_calls: [getSession],
      completed: [{ part: 'hi-hat', status: 'confirmed' }],
      unfinished: [{ part: 'cowbell', status: 'track_limit_reached' }],
      compensating_edits: [],
    };
    expect(score('pos-partial-track-limit', partial)).toBe(true);
    expect(score('pos-partial-track-limit', {
      ...partial,
      compensating_edits: [{ operation: 'remove_track', track_id: 'agent-hat-a1b2c3d4' }],
    })).toBe(false);
  });

  it('keeps the skill\'s published edit examples on the fixture surface', () => {
    const skill = readFileSync(resolve('..', manifest.skill_paths[0]!), 'utf8');
    const fixture = JSON.parse(
      readFileSync(resolve('../evals/fixtures/keyboardia-mcp-schema.json'), 'utf8'),
    ) as {
      tools: Array<{
        name: string;
        inputSchema?: { properties?: { edit?: { oneOf?: Array<{ properties?: { operation?: { const?: string } } }> } } };
      }>;
    };
    const operations = fixture.tools.find(({ name }) => name === 'edit_session')
      ?.inputSchema?.properties?.edit?.oneOf
      ?.map((branch) => branch.properties?.operation?.const)
      .filter((operation): operation is string => typeof operation === 'string') ?? [];

    for (const operation of operations) {
      expect(skill).toContain('"operation": "' + operation + '"');
    }
  });
});
