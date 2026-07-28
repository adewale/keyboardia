/**
 * Guards for execution-graded eval cases.
 *
 * These cases score the session an agent left behind and the calls it made,
 * rather than the prose it wrote. That only stays true if the scorer keeps
 * reading state and traces, and if the constants the session harness builds
 * against keep matching the app's own.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_COUNT, MAX_STEPS, MAX_TEMPO, MAX_TRACKS, MIN_TEMPO } from '../src/shared/constants';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import * as evalConstants from '../../evals/constants.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { redactCapability, resolveJudgeModel, summarize, summarizeRun } from '../../evals/run-benchmark.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { scoreExecution, scoreStateAssertion, scoreTraceAssertion } from '../../evals/score-execution.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { isRateLimited } from '../../evals/session-harness.mjs';

const manifest = JSON.parse(
  readFileSync(resolve('../evals/execution-benchmark.json'), 'utf8'),
) as {
  cases: Array<{
    id: string;
    kind: string;
    setup?: { tracks?: Array<{ id: string; step_count?: number }> };
    prompt?: string;
    assertions?: Array<{ name: string; type: string; check?: string }>;
  }>;
};

const executionCases = manifest.cases.filter((testCase) => testCase.kind === 'execution');

const baseline = {
  session_id: 's',
  immutable: false,
  tempo: 120,
  tracks: [
    { track_id: 'user-snare', name: 'Snare', sample_id: 'snare', step_count: 16, active_steps: [4, 12] },
  ],
};
const final = {
  session_id: 's',
  immutable: false,
  tempo: 120,
  tracks: [
    { track_id: 'user-snare', name: 'Snare', sample_id: 'snare', step_count: 16, active_steps: [4, 12] },
    { track_id: 'agent-kick-a1b2c3d4', name: 'Kick', sample_id: 'kick', step_count: 16, active_steps: [0, 4, 8, 12] },
  ],
};
const trace = [
  { name: 'get_session', arguments: { session_id: 's' }, success: true },
  {
    name: 'edit_session',
    arguments: { session_id: 's', edit: { operation: 'add_track', track_id: 'agent-kick-a1b2c3d4', sample_id: 'kick' } },
    success: true,
  },
  {
    name: 'edit_session',
    arguments: {
      session_id: 's',
      edit: {
        operation: 'set_steps',
        track_id: 'agent-kick-a1b2c3d4',
        changes: [0, 4, 8, 12].map((step) => ({ step, value: true })),
      },
    },
    success: true,
  },
];

describe('execution-graded evals', () => {
  it('keeps the eval constants matching the app', () => {
    // The eval tooling lives outside the TypeScript build and duplicates these
    // deliberately. Silent drift would make the session harness build tracks
    // the Worker's invariants reject.
    expect(evalConstants.MAX_STEPS).toBe(MAX_STEPS);
    expect(evalConstants.DEFAULT_STEP_COUNT).toBe(DEFAULT_STEP_COUNT);
    expect(evalConstants.MAX_TRACKS).toBe(MAX_TRACKS);
    expect(evalConstants.MIN_TEMPO).toBe(MIN_TEMPO);
    expect(evalConstants.MAX_TEMPO).toBe(MAX_TEMPO);
  });

  it('gates execution cases on state and trace only, never on prose', () => {
    expect(executionCases.length).toBeGreaterThan(0);

    for (const testCase of executionCases) {
      expect(testCase.setup, testCase.id).toBeDefined();
      expect(testCase.prompt, testCase.id).toContain('{{session_id}}');

      const types = new Set((testCase.assertions ?? []).map((assertion) => assertion.type));
      expect([...types].sort(), testCase.id).toEqual(['state', 'trace']);
    }
  });

  it('scores a correct run as passing', () => {
    const results = scoreExecution(
      [
        { name: 'steps', type: 'state', check: 'active_steps_equal', sample_id: 'kick', value: [0, 4, 8, 12] },
        { name: 'preserved', type: 'state', check: 'tracks_preserved', track_ids: ['user-snare'] },
        { name: 'order', type: 'trace', check: 'call_order', value: ['get_session', 'edit_session'] },
        { name: 'id', type: 'trace', check: 'added_track_id_matches', value: '[0-9a-fA-F]{8,}$' },
      ],
      { baseline, final, trace },
    );

    expect(results.every((result: { passed: boolean }) => result.passed)).toBe(true);
  });

  it('is unmoved by the wording of the answer', () => {
    // The whole point: an agent cannot talk its way to a better score, and a
    // reworded but identical run cannot score differently.
    const assertions = [
      { name: 'steps', type: 'state', check: 'active_steps_equal', sample_id: 'kick', value: [0, 4, 8, 12] },
      { name: 'order', type: 'trace', check: 'call_order', value: ['get_session', 'edit_session'] },
    ];
    const first = scoreExecution(assertions, { baseline, final, trace });
    const second = scoreExecution(assertions, { baseline, final, trace });

    // Nothing in the scorer's inputs carries prose, so there is no answer text
    // to vary: the absence of that parameter is the guarantee.
    expect(scoreExecution.length).toBe(2);
    expect(second).toEqual(first);
  });

  it('catches the failures these cases exist to catch', () => {
    const clobbered = {
      ...final,
      tracks: [
        { track_id: 'user-snare', name: 'Snare', sample_id: 'snare', step_count: 16, active_steps: [0, 4, 8, 12] },
        final.tracks[1]!,
      ],
    };
    expect(
      scoreStateAssertion({ check: 'tracks_preserved', track_ids: ['user-snare'] }, { baseline, final: clobbered }),
    ).toBe(false);

    expect(
      scoreStateAssertion({ check: 'tempo_unchanged' }, { baseline, final: { ...final, tempo: 140 } }),
    ).toBe(false);

    const writeFirst = [trace[1]!, trace[0]!];
    expect(
      scoreTraceAssertion({ check: 'call_order', value: ['get_session', 'edit_session'] }, writeFirst),
    ).toBe(false);

    expect(
      scoreTraceAssertion({ check: 'call_order', value: ['get_session', 'edit_session'] }, [
        { ...trace[0]!, success: false },
        trace[1]!,
      ]),
    ).toBe(false);

    const injected = [...trace, {
      name: 'edit_session',
      arguments: { session_id: 's', edit: { operation: 'set_tempo', tempo: 120 } },
    }];
    expect(scoreTraceAssertion({ check: 'no_operation', value: 'set_tempo' }, injected)).toBe(false);

    expect(
      scoreTraceAssertion({ check: 'steps_within', value: 16 }, [{
        name: 'edit_session',
        arguments: { session_id: 's', edit: { operation: 'set_steps', track_id: 't', changes: [{ step: 19, value: true }] } },
      }]),
    ).toBe(false);

    expect(
      scoreTraceAssertion({ check: 'added_track_id_matches', value: '[0-9a-fA-F]{8,}$' }, [{
        name: 'edit_session',
        arguments: { session_id: 's', edit: { operation: 'add_track', track_id: 'user-kick', sample_id: 'kick' } },
      }]),
    ).toBe(false);
  });

  it('rejects an unknown check instead of silently passing it', () => {
    // A typo in a manifest check name must not read as a pass.
    expect(() => scoreStateAssertion({ check: 'nope' }, { baseline, final })).toThrow();
    expect(() => scoreTraceAssertion({ check: 'nope' }, trace)).toThrow();
  });

  it('recognizes structured throttling without trusting session text', () => {
    expect(isRateLimited(429, '{"error":"slow down","retryAfter":2}')).toBe(true);
    expect(isRateLimited(200,
      'data: {"result":{"content":[{"text":"{\\"error\\":\\"slow down\\",\\"code\\":\\"RATE_LIMITED\\"}"}]}}\n',
    )).toBe(true);
    expect(isRateLimited(200,
      'data: {"result":{"structuredContent":{"tracks":[{"name":"RATE_LIMITED"}]}}}\n',
    )).toBe(false);
    expect(isRateLimited(200,
      'data: {"result":{"structuredContent":{"tracks":[{"name":"{\\"code\\":\\"RATE_LIMITED\\"}"}]}}}\n',
    )).toBe(false);
  });

  it('does not turn skipped security gates or adapter failures into passes', () => {
    expect(summarizeRun([{ severity: 'critical', passed: null }])).toMatchObject({
      passed: false,
      passRate: 0,
    });

    const infrastructure = summarize([
      { case: 'c', kind: 'execution', ok: false, scorable: false, model: 'm', variant: 'with_skill', split: 'tune' },
      { case: 'c', kind: 'execution', ok: true, scorable: true, passed: true, passRate: 1, model: 'm', variant: 'without_skill', split: 'tune' },
    ], { models: ['m'] }, { variants: ['with_skill', 'without_skill'] });
    expect(infrastructure.unscorablePairs).toBe(1);
    expect(infrastructure.byModel[0].variants.with_skill.runs).toBe(0);
    expect(infrastructure.byModel[0].variants.without_skill.runs).toBe(0);
  });

  it('inherits the evaluated model for judging and redacts edit capabilities', () => {
    expect(resolveJudgeModel(null, 'model-under-test')).toBe('model-under-test');
    expect(resolveJudgeModel('independent-judge', 'model-under-test')).toBe('independent-judge');
    expect(resolveJudgeModel(null, 'model-under-test', true)).toBeNull();

    const capability = '00000000-0000-4000-8000-000000000001';
    const redacted = redactCapability({
      session_id: capability,
      trace: [{ arguments: { session_id: capability } }],
    }, capability);
    expect(JSON.stringify(redacted)).not.toContain(capability);
    expect(redacted.session_id).toBe('<redacted-session-id>');

    const unicodeEncoded = capability.replaceAll('-', '\\u002d');
    const percentEncoded = capability.replaceAll('-', '%2D');
    const fullyEncoded = [...capability]
      .map((character) => `%${character.codePointAt(0)!.toString(16)}`)
      .join('');
    const doubleEncoded = fullyEncoded.replaceAll('%', '%25');
    const deeplyEncoded = Array.from({ length: 5 })
      .reduce((encoded) => encodeURIComponent(encoded), fullyEncoded);
    expect(redactCapability(unicodeEncoded, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(percentEncoded, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(doubleEncoded, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(deeplyEncoded, capability)).toBe('<redacted-session-id>');
    expect(redactCapability({ [doubleEncoded]: 'capability-key' }, capability))
      .toEqual({ '<redacted-session-id>': 'capability-key' });
  });
});
