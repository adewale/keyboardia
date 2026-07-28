import { canonicalJson, sha256, verifySourceModuleClosure } from './receipt.mjs';
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

function sourceFile(receipt, role, expectedPath, errors) {
  const matches = (receipt.source?.files ?? []).filter((file) => file.role === role);
  if (matches.length !== 1 || matches[0].path !== expectedPath) {
    errors.push(`execution receipt source role ${role} must bind ${expectedPath} exactly once`);
    return null;
  }
  return matches[0];
}

function exactSourcePath(receipt, expectedPath, errors) {
  const matches = (receipt.source?.files ?? []).filter((file) => file.path === expectedPath);
  if (matches.length !== 1) {
    errors.push(`execution receipt must bind ${expectedPath} exactly once`);
    return null;
  }
  return matches[0];
}

function parseSourceJson(file, label, errors) {
  if (!file) return null;
  try {
    return JSON.parse(file.content);
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function executionIdentity(value) {
  return canonicalJson([
    value.model ?? null,
    value.case,
    value.kind,
    value.split ?? 'tune',
    value.variant,
    value.repeat ?? 0,
  ]);
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
    const base = new URL(system.base_url);
    const hostname = base.hostname;
    if (!['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
      errors.push('execution Worker base URL is not loopback-owned');
    }
    if (system.mcp_endpoint !== new URL('/mcp', base).href) {
      errors.push('execution MCP endpoint does not match the owned Worker base URL');
    }
  } catch {
    errors.push('execution Worker base URL is invalid');
  }
  if (!Array.isArray(system.tools_list) || system.tools_list.length === 0) {
    errors.push('execution receipt requires a non-empty MCP tools list');
  } else if (sha256(canonicalJson(system.tools_list)) !== system.tools_list_sha256) {
    errors.push('execution MCP tools list hash mismatch');
  }
  const manifestFile = sourceFile(receipt, 'manifest', 'evals/execution-benchmark.json', errors);
  sourceFile(receipt, 'execution_receipt_verifier', 'evals/verify-execution-receipt.mjs', errors);
  exactSourcePath(receipt, 'evals/score-execution.mjs', errors);
  exactSourcePath(receipt, 'evals/session-harness.mjs', errors);
  sourceFile(receipt, 'system_under_test_entry', 'app/src/worker/index.ts', errors);
  sourceFile(receipt, 'system_under_test_config', 'app/wrangler.jsonc', errors);
  sourceFile(receipt, 'system_under_test_typescript_config', 'app/tsconfig.worker.json', errors);
  const packageFile = sourceFile(receipt, 'system_under_test_package', 'app/package.json', errors);
  const lockFile = sourceFile(receipt, 'system_under_test_lock', 'app/package-lock.json', errors);
  const manifest = parseSourceJson(manifestFile, 'execution manifest', errors);
  parseSourceJson(packageFile, 'execution package', errors);
  const lock = parseSourceJson(lockFile, 'execution package lock', errors);
  const expectedAdapter = {
    role: 'answer',
    id: 'claude-mcp',
    path: 'evals/adapters/claude-mcp.mjs',
  };
  if (canonicalJson(invocation.adapters) !== canonicalJson([expectedAdapter])) {
    errors.push('execution receipt must use exactly the bound claude-mcp answer adapter');
  }
  if (!(invocation.models ?? []).every((model) => /^claude-/i.test(model))) {
    errors.push('execution claude-mcp adapter is bound only to Claude model identifiers');
  }
  const adapterMatches = (receipt.source?.files ?? []).filter((file) =>
    file.role === 'answer_adapter' && file.path === expectedAdapter.path);
  if (adapterMatches.length !== 1) {
    errors.push(`execution answer adapter ${expectedAdapter.id} must bind ${expectedAdapter.path} exactly once`);
  } else {
    errors.push(...verifySourceModuleClosure(receipt.source, [expectedAdapter.path]));
  }
  const lockedWrangler = lock?.packages?.['node_modules/wrangler'];
  if (!lockedWrangler?.version || !lockedWrangler?.integrity
      || system.launch?.wrangler_lock_version !== lockedWrangler.version
      || system.launch?.wrangler_lock_integrity !== lockedWrangler.integrity
      || !String(system.launch?.wrangler_version).includes(lockedWrangler.version)) {
    errors.push('execution Wrangler launch does not match the embedded package lock');
  }
  const replay = invocation.execution_replay;
  try {
    verifyExecutionReplayEvidence(replay);
  } catch (error) {
    errors.push(`execution replay is invalid: ${error.message}`);
    return errors;
  }
  if (manifest) {
    const expectedCases = manifest.cases
      .filter((testCase) => testCase.kind === 'execution'
        && (invocation.splits ?? []).includes(testCase.split ?? 'tune'))
      .map((testCase) => ({
        id: testCase.id,
        kind: testCase.kind,
        assertions: testCase.assertions ?? [],
      }));
    if (canonicalJson(replay.input.cases) !== canonicalJson(expectedCases)
        || canonicalJson(replay.input.variants) !== canonicalJson(manifest.variants)
        || canonicalJson(replay.input.models) !== canonicalJson(invocation.models)) {
      errors.push('execution replay cases/assertions/models/variants do not match the embedded manifest');
    }
    const expectedIdentities = [];
    for (const testCase of expectedCases) {
      for (const variant of manifest.variants ?? []) {
        for (const model of invocation.models ?? []) {
          for (let repeat = 0; repeat < invocation.repeats; repeat += 1) {
            expectedIdentities.push(executionIdentity({
              model,
              case: testCase.id,
              kind: testCase.kind,
              split: manifest.cases.find((entry) => entry.id === testCase.id)?.split ?? 'tune',
              variant,
              repeat,
            }));
          }
        }
      }
    }
    const actualIdentities = replay.input.runs.map(executionIdentity);
    if (canonicalJson(actualIdentities.sort()) !== canonicalJson(expectedIdentities.sort())) {
      errors.push('execution replay does not contain the complete manifest run matrix');
    }
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
