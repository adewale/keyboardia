import { canonicalJson, sha256 } from './receipt.mjs';
import { verifyExecutionReplayEvidence } from './run-benchmark.mjs';

function artifactJson(receipt, ref, label, errors) {
  if (ref === null || ref === undefined) return null;
  const content = receipt.artifacts?.[ref]?.content;
  if (typeof content !== 'string') {
    errors.push(`${label} has a dangling artifact reference`);
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function projectedReceiptRun(receipt, run, index, errors) {
  const trace = artifactJson(receipt, run.trace_ref, `runs[${index}].trace_ref`, errors);
  const state = artifactJson(receipt, run.execution_ref, `runs[${index}].execution_ref`, errors);
  let execution = null;
  if (state !== null || trace !== null) {
    if (!state || !Object.hasOwn(state, 'baseline') || !Object.hasOwn(state, 'final')
        || !Array.isArray(trace)) {
      errors.push(`runs[${index}] does not contain reconstructable execution evidence`);
    } else {
      execution = { baseline: state.baseline, final: state.final, trace };
    }
  }
  return {
    model: run.model ?? null,
    case: run.case,
    kind: run.kind,
    split: run.split ?? 'tune',
    variant: run.variant,
    repeat: run.repeat ?? 0,
    ok: run.ok === true,
    scorable: run.scorable === true,
    error: run.error ?? null,
    passed: run.passed ?? null,
    passRate: run.passRate ?? null,
    gradedScore: run.gradedScore ?? null,
    assertions: run.assertions ?? [],
    execution,
  };
}

/** Verify live execution scores solely from bound replay state and trace evidence. */
export function verifyExecutionReceipt(receipt) {
  const executionRuns = (receipt.runs ?? []).filter((run) => run.kind === 'execution');
  if (executionRuns.length === 0) return [];
  const errors = [];
  const invocation = receipt.invocation ?? {};
  const system = invocation.system_under_test;
  if (!system || typeof system !== 'object') {
    errors.push('execution receipt requires invocation.system_under_test');
    return errors;
  }
  if (system.launch?.mode !== 'runner-owned-wrangler-local') {
    errors.push('execution receipt must use a runner-owned Worker launch');
  }
  if (system.launch?.source_git_commit !== receipt.source?.git_commit
      || system.launch?.source_git_tree !== receipt.source?.git_tree) {
    errors.push('execution Worker source identity does not match receipt source');
  }
  try {
    const hostname = new URL(system.base_url).hostname;
    if (!['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
      errors.push('execution Worker base URL is not loopback-owned');
    }
  } catch {
    errors.push('execution Worker base URL is invalid');
  }
  if (!Array.isArray(system.tools_list) || system.tools_list.length === 0) {
    errors.push('execution receipt requires a non-empty MCP tools list');
  } else if (sha256(canonicalJson(system.tools_list)) !== system.tools_list_sha256) {
    errors.push('execution MCP tools list hash mismatch');
  }
  const roles = new Set((receipt.source?.files ?? []).map((file) => file.role));
  for (const role of [
    'execution_receipt_verifier',
    'system_under_test_entry',
    'system_under_test_config',
    'system_under_test_typescript_config',
    'system_under_test_package',
    'system_under_test_lock',
  ]) {
    if (!roles.has(role)) errors.push(`execution receipt source is missing role ${role}`);
  }
  const replay = invocation.execution_replay;
  try {
    verifyExecutionReplayEvidence(replay);
  } catch (error) {
    errors.push(`execution replay is invalid: ${error.message}`);
    return errors;
  }
  const projectedRuns = executionRuns.map((run, index) =>
    projectedReceiptRun(receipt, run, index, errors));
  if (canonicalJson(projectedRuns) !== canonicalJson(replay.projection.runs)) {
    errors.push('execution receipt runs do not match deterministic replay projection');
  }
  if (canonicalJson(receipt.summary) !== canonicalJson(replay.projection.summary)) {
    errors.push('execution receipt summary does not match deterministic replay projection');
  }
  return errors;
}
