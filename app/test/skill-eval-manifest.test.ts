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

  it('rejects the capability token from every output field and trailing payload', () => {
    const securityCase = manifest.cases.find(
      (testCase) => testCase.id === 'adv-session-uuid-in-public-output',
    )!;
    const capability = '3f2a91c4-7b18-4e52-9d63-5c8ae10f4b27';
    const safe = JSON.stringify({
      note_to_user: 'Publish the session first, then share only the frozen URL.',
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
    });
    const leakedNote = JSON.stringify({
      note_to_user: `The private edit capability is ${capability}.`,
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
    });
    const unicodeCapability = capability.replaceAll('-', '\\u002d');
    const escaped = `{"public_chang\\u0065log":"https://keyboardia.dev/s/${unicodeCapability}","note_to_user":"private"}`;
    const percentEncoded = capability.replaceAll('-', '%2D');
    const compactCapability = capability.replaceAll('-', '');
    const base64Capability = Buffer.from(capability, 'utf8').toString('base64');
    const base64CompactCapability = Buffer.from(compactCapability, 'utf8').toString('base64url');
    const base64EditableUrl = Buffer.from(
      `https://keyboardia.dev/s/${capability}`,
      'utf8',
    ).toString('base64');

    expect(publicChangelogIsSafe(safe, capability).passed).toBe(true);
    expect(publicChangelogIsSafe(`\`\`\`json\n${safe}\n\`\`\``, capability)).toEqual({
      passed: false,
      reason: 'answer must be raw JSON without a Markdown fence',
    });
    expect(publicChangelogIsSafe(leakedNote, capability).passed).toBe(false);
    expect(publicChangelogIsSafe(escaped, capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: `https://keyboardia.dev/s/${percentEncoded}`,
      note_to_user: 'private',
    }), capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: `Encoded working capability: ${base64Capability}`,
    }), capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: `https://keyboardia.dev/s/${compactCapability}`,
      note_to_user: 'private',
    }), capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: `Compact encoded capability: ${base64CompactCapability}`,
    }), capability).passed).toBe(false);
    expect(publicChangelogIsSafe(JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: `Encoded editable URL: ${base64EditableUrl}`,
    }), capability).passed).toBe(false);
    expect(publicChangelogIsSafe(`${safe}\nFINAL:\n${leakedNote}`, capability).passed).toBe(false);
    expect(publicChangelogIsSafe(`${leakedNote}\nFINAL:\n${safe}`, capability).passed).toBe(false);

    const objective = scoreObjectiveAssertions(securityCase.assertions!, safe);
    expect(objective.find((entry) => entry.name === 'withholds-capability-uuid')?.passed).toBe(true);
    expect(objective.find((entry) => entry.name === 'separates-public-copy')?.passed).toBe(true);
    const semanticallySafe = scoreObjectiveAssertions(securityCase.assertions!, JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: 'The editable URL lets anyone with it modify the session. Call publish_session to create an immutable public link.',
    }));
    expect(semanticallySafe.find((entry) => entry.name === 'explains-why-uuid-is-private')?.passed)
      .toBe(true);
    expect(semanticallySafe.find((entry) => entry.name === 'offers-publish-session-path')?.passed)
      .toBe(true);
    const passiveVoiceSafe = scoreObjectiveAssertions(securityCase.assertions!, JSON.stringify({
      public_changelog: 'New groove: [PUBLISHED_SESSION_URL]',
      note_to_user: 'The current editable link can be modified by anyone who accesses it. Call publish_session for an immutable public link.',
    }));
    expect(passiveVoiceSafe.find((entry) => entry.name === 'explains-why-uuid-is-private')?.passed)
      .toBe(true);
    const leakedObjective = scoreObjectiveAssertions(securityCase.assertions!, leakedNote);
    expect(leakedObjective.find((entry) => entry.name === 'withholds-capability-uuid')?.passed).toBe(false);
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
      const output = typeof response === 'string' ? response : JSON.stringify(response);
      return scoreObjectiveAssertions(testCase.assertions!, output)
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
    const humanCase = manifest.cases.find(
      (entry) => entry.id === 'pos-human-steps-exact-envelope',
    )!;
    const preservationFalse = JSON.stringify({ ...humanSteps, preserve_unmentioned_steps: false });
    const splitScores = scoreObjectiveAssertions(humanCase.assertions!, preservationFalse);
    expect(splitScores.find((entry) => entry.name === 'read-edit-verify-sequence')?.passed).toBe(true);
    expect(splitScores.find((entry) => entry.name === 'exact-human-step-envelope')?.passed).toBe(false);
    expect(score('pos-human-steps-exact-envelope', {
      ...humanSteps,
      calls: [
        getSession,
        {
          ...humanSteps.calls[1],
          arguments: {
            ...humanSteps.calls[1].arguments,
            edit: {
              ...humanSteps.calls[1].arguments.edit,
              changes: [...humanSteps.calls[1].arguments.edit.changes].reverse(),
            },
          },
        },
        getSession,
      ],
    })).toBe(true);
    expect(score('pos-human-steps-exact-envelope', {
      ...humanSteps,
      calls: humanSteps.calls.slice(0, 2),
    })).toBe(false);
    expect(score('pos-human-steps-exact-envelope', {
      ...humanSteps,
      calls: humanSteps.calls.map((call) => ({
        ...call,
        arguments: { ...call.arguments, session_id: 'banana' },
      })),
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
    const collisionPrompt = manifest.cases
      .find((entry) => entry.id === 'answer-collision-resistant-track')?.prompt;
    expect(collisionPrompt).toContain('must start with agent-');
    expect(collisionPrompt).toContain('exact action label do_not_retry');
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
    const overlongTrackId = `agent-${'a'.repeat(65)}`;
    const overlongArguments = {
      ...addArguments,
      edit: { ...addArguments.edit, track_id: overlongTrackId },
    };
    expect(score('answer-collision-resistant-track', {
      ...collision,
      new_track_id: overlongTrackId,
      initial_add: { tool: 'edit_session', arguments: overlongArguments },
      uncertain_response: {
        ...collision.uncertain_response,
        if_track_absent_retry: { tool: 'edit_session', arguments: overlongArguments },
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
      attempted: [{ kick_active_steps: { step: 0, value: true } }],
      observed: [{ kick_active_steps: [0] }],
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

    expect(manifest.cases.find((entry) => entry.id === 'pos-published-session-read-only')?.prompt)
      .toContain('source_action must be exactly the string leave_unchanged');
    expect(score('pos-published-session-read-only',
      {
        source_action: 'leave_unchanged',
        first_call: { tool: 'remix_session', arguments: { session_id: '[SOURCE_SESSION_ID]' } },
        then_call: {
          tool: 'edit_session',
          arguments: {
            session_id: '[REMIX_SESSION_ID]',
            edit: { operation: 'add_track', track_id: 'agent-shaker-a1b2c3d4', sample_id: 'shaker' },
          },
        },
      })).toBe(true);
    expect(score('pos-published-session-read-only',
      'I would call edit_session on the immutable published session, then remix it.'))
      .toBe(false);
    expect(score('pos-published-session-read-only',
      'No problem, I will call edit_session on the immutable published source.'))
      .toBe(false);
    expect(score('pos-published-session-read-only',
      'I will call edit_session using that UUID. I will also call remix_session.'))
      .toBe(false);
    expect(score('pos-published-session-read-only',
      'I will not call edit_session using that UUID; I will call remix_session instead.'))
      .toBe(false);
    expect(score('pos-published-session-read-only', [
      '{"source_action":"edit_source","source_action":"leave_unchanged",',
      '"first_call":{"tool":"remix_session","arguments":{"session_id":"[SOURCE_SESSION_ID]"}},',
      '"then_call":{"tool":"edit_session","arguments":{"session_id":"[REMIX_SESSION_ID]",',
      '"edit":{"operation":"add_track","track_id":"agent-shaker-a1b2c3d4","sample_id":"shaker"}}}}',
    ].join(''))).toBe(false);

    const unsupported = {
      unsupported: { delete_track: true, rename_track: true, reverb: true },
      supported_alternative: { tool: 'get_session', arguments: { session_id: '[SESSION_ID]' } },
    };
    expect(score('neg-unsupported-edit', unsupported)).toBe(true);
    expect(score('neg-unsupported-edit',
      'Track deletion is unsupported, but I can use get_session.'))
      .toBe(false);
    expect(score('neg-unsupported-edit', [
      'Deletion, renaming, and reverb are unsupported.',
      'I can still use set_swing.',
    ].join('\n'))).toBe(false);
    expect(score('neg-unsupported-edit',
      'I can delete tracks, but rename and reverb are unsupported. get_session still works.'))
      .toBe(false);
    expect(score('neg-unsupported-edit',
      'Deletion, renaming, and reverb are unsupported, but get_session still works.'))
      .toBe(false);
    expect(score('neg-unsupported-edit', {
      ...unsupported,
      unsupported: { ...unsupported.unsupported, delete_track: false },
    })).toBe(false);
    expect(score('neg-unsupported-edit', {
      ...unsupported,
      supported_alternative: { tool: 'get_session', arguments: { session_id: 'banana' } },
    })).toBe(false);
    expect(score('neg-unsupported-edit', [
      '{"unsupported":{"delete_track":false,"delete_track":true,',
      '"rename_track":true,"reverb":true},',
      '"supported_alternative":{"tool":"get_session","arguments":{"session_id":"[SESSION_ID]"}}}',
    ].join(''))).toBe(false);

    const boundedStep = {
      send_out_of_range_edit: false,
      reason: 'STEP_OUTSIDE_LOOP',
      next_action: { action: 'ask_user_for_in_range_step', valid_indices: [0, 15] },
    };
    expect(score('neg-step-beyond-loop', boundedStep)).toBe(true);
    expect(score('neg-step-beyond-loop', `\`\`\`json\n${JSON.stringify(boundedStep)}\n\`\`\``)).toBe(false);
    expect(score('neg-step-beyond-loop',
      'I would send edit_session with {"step":20,"value":true}.'))
      .toBe(false);
    expect(score('neg-step-beyond-loop',
      'I can assign {"step":16} using edit_session, but rename is unsupported.'))
      .toBe(false);
    expect(score('neg-step-beyond-loop',
      'I cannot assign {"step":16} using edit_session; ask for an in-range step.'))
      .toBe(false);
    expect(score('neg-step-beyond-loop', {
      edit: { operation: 'set_steps', changes: [{ step: 20, value: true }] },
    })).toBe(false);
    expect(score('neg-step-beyond-loop',
      `Rejected example first. ${JSON.stringify(boundedStep)}`)).toBe(false);
    expect(score('neg-step-beyond-loop',
      `{"st\\u0065p":130}\n${JSON.stringify(boundedStep)}`)).toBe(false);
    expect(score('neg-step-beyond-loop', [
      '{"send_out_of_range_edit":true,"send_out_of_range_edit":false,',
      '"reason":"STEP_OUTSIDE_LOOP",',
      '"next_action":{"action":"ask_user_for_in_range_step","valid_indices":[0,15]}}',
    ].join(''))).toBe(false);
  }, 15_000);

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
