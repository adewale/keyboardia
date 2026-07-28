#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractFirstJsonObject } from './public-changelog-safe.mjs';

function pass(reason) {
  return { passed: true, reason };
}

function fail(reason) {
  return { passed: false, reason };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getSessionCall(value, sessionId = null) {
  return exactKeys(value, ['tool', 'arguments'])
    && value.tool === 'get_session'
    && exactKeys(value.arguments, ['session_id'])
    && nonEmptyString(value.arguments.session_id)
    && (sessionId === null || value.arguments.session_id === sessionId);
}

function editSessionCall(value, sessionId = null) {
  return exactKeys(value, ['tool', 'arguments'])
    && value.tool === 'edit_session'
    && exactKeys(value.arguments, ['session_id', 'edit'])
    && nonEmptyString(value.arguments.session_id)
    && (sessionId === null || value.arguments.session_id === sessionId);
}

function parse(text) {
  try {
    return { value: extractFirstJsonObject(text) };
  } catch (error) {
    return { error: error.message };
  }
}

function namedEntries(value) {
  const source = Array.isArray(value) ? value : [value];
  const entries = [];
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.field === 'string' || typeof item.type === 'string') {
      const field = item.field ?? item.type;
      const payload = { ...item };
      delete payload.field;
      delete payload.type;
      entries.push({ field, payload });
      continue;
    }
    const keys = Object.keys(item);
    if (keys.length !== 1) return null;
    entries.push({ field: keys[0], payload: item[keys[0]] });
  }
  return entries;
}

function unwrapSinglePayload(value) {
  let payload = value;
  if (Array.isArray(payload) && payload.length === 1) payload = payload[0];
  for (const key of ['change', 'value']) {
    if (exactKeys(payload, [key]) && payload[key] && typeof payload[key] === 'object') {
      payload = payload[key];
    }
  }
  return payload;
}

export function humanStepsAnswer(text) {
  const parsed = parse(text);
  if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, ['calls', 'preserve_unmentioned_steps'])) {
    return fail('expected exactly calls and preserve_unmentioned_steps');
  }
  if (value.preserve_unmentioned_steps !== true) {
    return fail('preserve_unmentioned_steps must be true');
  }
  if (!Array.isArray(value.calls) || value.calls.length !== 3) {
    return fail('calls must contain exactly get_session, edit_session, get_session');
  }
  const [before, editCall, after] = value.calls;
  if (!getSessionCall(before)) return fail('first call must be get_session');
  const sessionId = before.arguments.session_id;
  if (!editSessionCall(editCall, sessionId)) return fail('second call must be edit_session for the same session');
  if (!getSessionCall(after, sessionId)) return fail('third call must verify with get_session for the same session');
  const edit = editCall.arguments.edit;
  if (!exactKeys(edit, ['operation', 'track_id', 'changes'])) {
    return fail('set_steps edit must contain exactly operation, track_id, and changes');
  }
  if (edit.operation !== 'set_steps' || edit.track_id !== 'user-kick') {
    return fail('edit must target user-kick with set_steps');
  }
  const expectedChanges = [{ step: 4, value: true }, { step: 12, value: true }];
  if (!isDeepStrictEqual(edit.changes, expectedChanges)) {
    return fail('changes must be exactly [{step:4,value:true},{step:12,value:true}]');
  }
  return pass('exact get/edit/get sequence preserves the pattern and sets only indices 4 and 12');
}

function addTrackCall(value, trackId, sessionId = null) {
  if (!editSessionCall(value, sessionId)) return false;
  const edit = value.arguments.edit;
  if (!edit || edit.operation !== 'add_track' || edit.track_id !== trackId) return false;
  if (edit.sample_id !== 'kick') return false;
  const allowed = edit.name === undefined
    ? ['operation', 'track_id', 'sample_id']
    : ['operation', 'track_id', 'sample_id', 'name'];
  return exactKeys(edit, allowed) && (edit.name === undefined || nonEmptyString(edit.name));
}

export function collisionRetryAnswer(text) {
  const parsed = parse(text);
  if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, [
    'ownership_from_prefix',
    'new_track_id',
    'initial_add',
    'uncertain_response',
  ])) {
    return fail('unexpected collision/retry answer fields');
  }
  if (value.ownership_from_prefix !== false) {
    return fail('ownership_from_prefix must be false');
  }
  if (!/^agent-[A-Za-z0-9._-]*[0-9a-fA-F]{8,}$/.test(value.new_track_id ?? '')) {
    return fail('new_track_id needs an agent- prefix and at least eight hexadecimal suffix characters');
  }
  if (value.new_track_id === 'agent-kick-1' || !addTrackCall(value.initial_add, value.new_track_id)) {
    return fail('initial_add must use the fresh ID in an exact add_track envelope');
  }
  const sessionId = value.initial_add.arguments.session_id;
  const recovery = value.uncertain_response;
  if (!exactKeys(recovery, ['first_call', 'if_track_present', 'if_track_absent_retry'])) {
    return fail('uncertain_response must enumerate read, present, and absent outcomes');
  }
  if (!getSessionCall(recovery.first_call, sessionId)) {
    return fail('uncertain recovery must read the same session first');
  }
  if (recovery.if_track_present !== 'do_not_retry') {
    return fail('a present track must not be retried');
  }
  if (!addTrackCall(recovery.if_track_absent_retry, value.new_track_id, sessionId)) {
    return fail('the absent-track retry must be add_track with the same ID');
  }
  if (!isDeepStrictEqual(recovery.if_track_absent_retry.arguments, value.initial_add.arguments)) {
    return fail('the retry arguments must be byte-for-byte structurally identical to the initial add arguments');
  }
  return pass('fresh ID, no prefix ownership inference, and stable read-before-retry payload');
}

export function uncertainTempoAnswer(text) {
  const parsed = parse(text);
  if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, ['first_call', 'decisions'])) {
    return fail('expected exactly first_call and decisions');
  }
  if (!getSessionCall(value.first_call)) return fail('first_call must be get_session');
  const sessionId = value.first_call.arguments.session_id;
  const decisions = value.decisions;
  if (!exactKeys(decisions, ['intended_124', 'prior_value_unchanged', 'different_value'])) {
    return fail('decision table must cover intended, unchanged, and different observed values');
  }
  if (!exactKeys(decisions.intended_124, ['action'])
      || decisions.intended_124.action !== 'accept_no_retry') {
    return fail('observed 124 must be accepted without retry');
  }
  if (!exactKeys(decisions.different_value, ['action'])
      || decisions.different_value.action !== 'ask_before_overwrite') {
    return fail('a different value must require confirmation before overwrite');
  }
  const unchanged = decisions.prior_value_unchanged;
  if (!exactKeys(unchanged, ['action', 'call']) || unchanged.action !== 'retry_same_assignment') {
    return fail('an unchanged prior value must retry the same assignment');
  }
  if (!editSessionCall(unchanged.call, sessionId)) {
    return fail('unchanged-value retry must edit the same session');
  }
  const edit = unchanged.call.arguments.edit;
  if (!exactKeys(edit, ['operation', 'tempo']) || edit.operation !== 'set_tempo' || edit.tempo !== 124) {
    return fail('retry must use the exact set_tempo 124 payload');
  }
  return pass('complete re-read decision table avoids blind or destructive retries');
}

export function concurrentDeltaAnswer(text) {
  const parsed = parse(text);
  if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, ['attempted', 'observed', 'unattributed'])) {
    return fail('expected separate attempted, observed, and unattributed fields');
  }
  const attempted = namedEntries(value.attempted);
  if (!attempted || attempted.length !== 1 || attempted[0].field !== 'kick_active_steps'
      || !isDeepStrictEqual(unwrapSinglePayload(attempted[0].payload), { step: 0, value: true })) {
    return fail('attempted must contain only the requested kick step assignment');
  }
  const observed = namedEntries(value.observed);
  if (!observed || observed.length !== 1 || observed[0].field !== 'kick_active_steps'
      || !isDeepStrictEqual(unwrapSinglePayload(observed[0].payload), [0])) {
    return fail('observed must contain only the confirmed kick post-state');
  }
  const expectedUnattributed = [
    { field: 'tempo', before: 120, after: 126 },
    { field: 'snare_active_steps', before: [4, 12], after: [0, 4, 8, 12] },
  ];
  const unattributed = namedEntries(value.unattributed);
  const sortedUnattributed = unattributed?.map(({ field, payload }) => ({
    field,
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
  })).sort((left, right) => String(left.field).localeCompare(String(right.field)));
  const sortedExpected = [...expectedUnattributed]
    .sort((left, right) => left.field.localeCompare(right.field));
  if (!isDeepStrictEqual(sortedUnattributed, sortedExpected)) {
    return fail('tempo and snare deltas must be exactly and only unattributed');
  }
  return pass('attempted work, observed result, and unrelated deltas are structurally separated');
}

export function partialTrackLimitAnswer(text) {
  const parsed = parse(text);
  if (parsed.error) return fail(parsed.error);
  const value = parsed.value;
  if (!exactKeys(value, ['next_calls', 'completed', 'unfinished', 'compensating_edits'])) {
    return fail('expected next_calls, completed, unfinished, and compensating_edits');
  }
  if (!Array.isArray(value.next_calls) || value.next_calls.length !== 1
      || !getSessionCall(value.next_calls[0])) {
    return fail('the only next call must be get_session');
  }
  if (!isDeepStrictEqual(value.completed, [{ part: 'hi-hat', status: 'confirmed' }])) {
    return fail('completed must report only the confirmed hi-hat');
  }
  if (!isDeepStrictEqual(value.unfinished, [{ part: 'cowbell', status: 'track_limit_reached' }])) {
    return fail('unfinished must report only the rejected cowbell');
  }
  if (!Array.isArray(value.compensating_edits) || value.compensating_edits.length !== 0) {
    return fail('compensating_edits must be empty');
  }
  return pass('re-read, honest partial result, and no compensating rollback');
}

export const CAPABILITY_ORACLES = {
  'human-steps': humanStepsAnswer,
  'collision-retry': collisionRetryAnswer,
  'uncertain-tempo': uncertainTempoAnswer,
  'concurrent-delta': concurrentDeltaAnswer,
  'partial-track-limit': partialTrackLimitAnswer,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , mode, outputPath] = process.argv;
  if (!CAPABILITY_ORACLES[mode] || !outputPath) {
    process.stderr.write(`usage: capability-answer.mjs MODE OUTPUT_PATH\nmodes: ${Object.keys(CAPABILITY_ORACLES).join(', ')}\n`);
    process.exitCode = 2;
  } else {
    const result = CAPABILITY_ORACLES[mode](readFileSync(outputPath, 'utf8'));
    process.stdout.write(`${result.reason}\n`);
    process.exitCode = result.passed ? 0 : 1;
  }
}
