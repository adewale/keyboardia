import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import {
  addArtifact,
  answerHarnessPrompt,
  answerMatrixSummary,
  buildReceipt,
  canonicalJson,
  canonicalSkillTreeHashFromSource,
  completeSkillEvalInputBundleHash,
  createPatchedGitBinding,
  createSourceBinding,
  assertSourceBindingStillClean,
  redactCapability,
  sanitizeReceiptValue,
  scoreObjectiveAssertions,
  sha256,
  skillEvalInputBundleHash,
  verifyReceipt,
  verifySourceModuleClosure,
  verifySourceProvenance,
  writeReceipt,
} from '../../evals/receipt.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import {
  buildExecutionReplayEvidence,
  projectExecutionReplay,
  registerCapabilitiesFromEvidence,
  summarize,
  summarizeRun,
} from '../../evals/run-benchmark.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { scoreExecution } from '../../evals/score-execution.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { verifyExecutionReceipt } from '../../evals/verify-execution-receipt.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { verifyCompleteTaskMatrix } from '../../evals/import-harness-receipt.mjs';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function committedInputs({ execution = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-receipt-test-'));
  git(root, 'init', '-q');
  const files = [
    ['skill', 'skill/SKILL.md', '# Skill\n'],
    ['manifest', execution ? 'evals/execution-benchmark.json' : 'evals/manifest.json', `${JSON.stringify(execution ? {
      version: 1,
      skill_paths: ['skill/SKILL.md'],
      variants: ['with_skill'],
      cases: [{
        id: 'execution-case', kind: 'execution', split: 'tune', prompt: 'Execute',
        assertions: [{
          name: 'tempo-preserved', type: 'state', check: 'tempo_unchanged', severity: 'gate',
        }],
      }],
    } : {
      version: 1,
      skill_paths: ['skill/SKILL.md'],
      variants: ['with_skill'],
      cases: [{
        id: 'case-1',
        kind: 'adversarial',
        split: 'tune',
        prompt: 'Exact prompt',
        files: ['fixture.txt'],
        assertions: [
          {
            name: 'exact-answer', type: 'regex', pattern: '^\\{"ok":true\\}$',
            severity: 'gate', oracle: 'strong',
          },
          {
            name: 'omits-forbidden', type: 'not_regex', pattern: 'forbidden',
            severity: 'gate', oracle: 'strong',
          },
          {
            name: 'structured-answer', type: 'structured_output', severity: 'gate',
            oracle: 'strong', schema: {
              type: 'object', required: ['ok'], additionalProperties: false,
              properties: { ok: { const: true } },
            },
          },
          {
            name: 'script-answer', type: 'script',
            command: ['node', 'oracle.mjs', '{output_path}'],
            severity: 'critical', oracle: 'strong',
          },
        ],
      }],
    })}\n`],
    ['answer_matrix_policy', 'evals/answer-matrix-policy.json', `${JSON.stringify({
      version: 1, suite: 'keyboardia-answer-matrix', splits: ['tune'], repeats: 1,
      models: ['gpt-test-model'],
    })}\n`],
    ['fixture', 'evals/fixture.txt', 'exact fixture\n'],
    ['runner', 'evals/run.mjs', 'export {};\n'],
    ['receipt_runtime', 'evals/receipt.mjs', 'export {};\n'],
    ['receipt_schema', 'evals/receipt.schema.json', '{}\n'],
    ['answer_adapter', execution ? 'evals/adapters/claude-mcp.mjs' : 'evals/adapter.mjs', 'export {};\n'],
    ['harness_manifest', 'pyproject.toml', '[project]\nversion = "test"\n'],
    ['oracle', 'evals/oracle.mjs', [
      "import { readFileSync } from 'node:fs';",
      "process.exitCode = readFileSync(process.argv[2], 'utf8') === '{\"ok\":true}' ? 0 : 1;",
      '',
    ].join('\n')],
    ['execution_receipt_verifier', 'evals/verify-execution-receipt.mjs', 'export {};\n'],
    ['runner_dependency', 'evals/score-execution.mjs', 'export {};\n'],
    ['runner_dependency', 'evals/session-harness.mjs', 'export {};\n'],
    ['system_under_test_entry', 'app/src/worker/index.ts', 'export {};\n'],
    ['system_under_test_config', 'app/wrangler.jsonc', '{}\n'],
    ['system_under_test_typescript_config', 'app/tsconfig.worker.json', '{}\n'],
    ['system_under_test_package', 'app/package.json', '{"devDependencies":{"wrangler":"^4.53.0"}}\n'],
    ['system_under_test_lock', 'app/package-lock.json', '{"packages":{"node_modules/wrangler":{"version":"4.53.0","integrity":"sha512-test"}}}\n'],
  ] as const;
  for (const [, path, content] of files) {
    const absolute = resolve(root, path);
    execFileSync('mkdir', ['-p', resolve(absolute, '..')]);
    writeFileSync(absolute, content);
  }
  git(root, 'add', '.');
  execFileSync('git', [
    '-C', root,
    '-c', 'user.name=Receipt Test',
    '-c', 'user.email=receipt@example.test',
    'commit', '-qm', 'fixture',
  ]);
  const source = createSourceBinding(root, files.map(([role, path]) => ({
    role,
    path,
    bytes: readFileSync(resolve(root, path)),
  })));
  source.repository = 'https://github.com/adewale/keyboardia.git';
  return { root, source };
}

function attachPatchedHarness(
  receipt: ReturnType<typeof buildReceipt>,
  binding: ReturnType<typeof createPatchedGitBinding>,
) {
  receipt.harness.git_commit = binding.gitCommit;
  receipt.harness.git_tree = binding.gitTree;
  receipt.harness.parent_git_commit = binding.parentGitCommit;
  receipt.harness.parent_git_tree = binding.parentGitTree;
  receipt.harness.patch_ref = addArtifact(
    receipt.artifacts,
    binding.patch.toString('utf8'),
    'text/plain',
    { sanitize: false },
  );
  receipt.harness.parent_tree_ref = addArtifact(
    receipt.artifacts,
    canonicalJson(binding.parentTreeSnapshot),
    'application/json',
    { sanitize: false },
  );
  receipt.harness.commit_ref = addArtifact(
    receipt.artifacts,
    binding.commit.toString('utf8'),
    'text/plain',
    { sanitize: false },
  );
  receipt.harness.parent_commit_ref = addArtifact(
    receipt.artifacts,
    binding.parentCommit.toString('utf8'),
    'text/plain',
    { sanitize: false },
  );
}

function parsedManifestFor(source: ReturnType<typeof createSourceBinding>) {
  return JSON.parse(source.files.find((file) => file.role === 'manifest')!.content);
}

function answerArtifactFiles(
  task: Record<string, unknown>,
  evalCase: Record<string, unknown>,
  manifest: Record<string, unknown>,
  inputBundleHash: string,
  skillTreeHash: string,
  manifestRevision: string,
  output: string,
) {
  const embedded = {
    'events.json': '{}\n',
    'metrics.json': '{}\n',
    'metadata.json': JSON.stringify({
      input_bundle_hash: inputBundleHash,
      complete_input_bundle_hash: completeSkillEvalInputBundleHash(inputBundleHash, skillTreeHash),
      skill_tree_hash: skillTreeHash,
      manifest_revision: manifestRevision,
      provider: 'codex',
      telemetry: { basis: { provider: 'codex', runner: 'codex', model: task.model } },
    }),
    'prompt.md': answerHarnessPrompt(task, evalCase, manifest),
    'output.md': output,
  };
  return {
    ...Object.fromEntries(Object.entries(embedded).filter(([name]) => name !== 'output.md')),
    'artifact-commit.json': JSON.stringify({
      schema_version: 1,
      required_files: ['output.md', 'events.json', 'metrics.json', 'metadata.json'],
      inventory_sha256: Object.fromEntries(Object.entries(embedded)
        .map(([name, content]) => [name, sha256(content)])),
    }),
  };
}

function answerReceiptFixture() {
  const { root, source } = committedInputs();
  const manifest = source.files.find((file) => file.role === 'manifest');
  const inputBundleHash = skillEvalInputBundleHash({
    manifestPath: manifest.path,
    manifestContent: manifest.content,
    caseId: 'case-1',
    sourceFiles: source.files,
  });
  const skillTreeHash = canonicalSkillTreeHashFromSource(parsedManifestFor(source), source.files);
  const task = {
    case_id: 'case-1', kind: 'adversarial', split: 'tune', variant: 'with_skill',
    run_number: 1, model: 'gpt-test-model', prompt: 'Exact prompt',
    manifest_revision: manifest.sha256, skill_tree_hash: skillTreeHash,
    input_bundle_hash: inputBundleHash,
  };
  const assertions = [
    { name: 'exact-answer', type: 'regex', severity: 'gate' },
    { name: 'omits-forbidden', type: 'not_regex', severity: 'gate' },
    { name: 'structured-answer', type: 'structured_output', severity: 'gate' },
    { name: 'script-answer', type: 'script', severity: 'critical' },
  ].map((assertion) => ({
    ...assertion, passed: true, evidence: 'passed', score: 1, oracle: 'strong',
  }));
  const benchmark = {
    results: [{
      case_id: 'case-1', kind: 'adversarial', split: 'tune', variant: 'with_skill',
      run_number: 1, model: 'gpt-test-model', missing_output: false, execution_valid: true,
      assertions, objective_passed: 4, objective_total: 4,
      objective_pass_rate: 1, critical_failures: [], vetoed: false,
      metadata: { input_bundle_hash: inputBundleHash },
    }],
    summary: { with_skill: { runs: 1 }, without_skill: { runs: 0 } },
    paired_summary: { pairs: 0 },
    by_model: { 'gpt-test-model': { runs: 1 } },
    case_flags: [],
    reliability: { errors: 0 },
  };
  const audit = {
    counts: {
      cases: 1, positive: 0, negative: 1, adversarial: 1, holdout: 0, holdback: 0,
      trigger: 0, trigger_positive: 0, trigger_negative: 0, ablations: 0,
      objective_assertions: 4, process_assertions: 0, efficiency_assertions: 0,
      judge_assertions: 0, fixture_cases: 1, input_files: 1, domain_tagged: 0,
      difficulty_tagged: 0, success_goal_tagged: 0, trigger_type_tagged: 0,
    },
    readiness: {
      ablations: { total: 0, materialized: 0, instruction_simulated: 0 },
      leak_saturated_cases: [], objective_only_cases: [], adversarial_cases: 1,
      judge_only_cases: 0, base_saturated_cases: [], qualitative_only_cases: [],
      regression_guards_holding: [], regression_guards_failing: [], blockers: [],
    },
    findings: [
      { kind: 'missing-positive-evals', severity: 'required', message: 'fixture' },
      { kind: 'missing-negative-evals', severity: 'required', message: 'fixture' },
      { kind: 'missing-adversarial-evals', severity: 'recommended', message: 'fixture' },
      { kind: 'missing-hidden-splits', severity: 'required', message: 'fixture' },
      { kind: 'missing-ablation-plan', severity: 'recommended', message: 'fixture' },
      { kind: 'missing-trigger-no-trigger-cases', severity: 'required', message: 'fixture' },
    ],
    benchmark: { summary: benchmark.summary, case_flags: benchmark.case_flags },
  };
  const parsedManifest = JSON.parse(manifest.content);
  const evalCase = parsedManifest.cases[0];
  const receipt = buildReceipt({
    source,
    harness: {
      name: 'skill-eval-harness',
      repository: 'https://github.com/adewale/skill-eval-harness.git', version: 'test',
      git_commit: source.git_commit, mode: 'patched-local-checkout',
    },
    invocation: {
      suite: 'keyboardia-answer-matrix', models: ['gpt-test-model'],
      adapters: [{ role: 'answer', id: 'codex-native', path: null }],
      splits: ['tune'], repeats: 1, judge: false,
      manifest_revision: manifest.sha256, skill_tree_hash: skillTreeHash,
    },
    runs: [{
      model: 'gpt-test-model', case: 'case-1', kind: 'adversarial', split: 'tune',
      variant: 'with_skill', repeat: 1, ok: true, prompt: 'Exact prompt',
      response: '{"ok":true}', assertions, objective_passed: 4,
      objective_total: 4, objective_pass_rate: 1, critical_failures: [], vetoed: false,
      input_bundle_hash: inputBundleHash,
      complete_input_bundle_hash: completeSkillEvalInputBundleHash(inputBundleHash, skillTreeHash),
      trace: { artifact_files: answerArtifactFiles(
        task,
        evalCase,
        parsedManifest,
        inputBundleHash,
        skillTreeHash,
        manifest.sha256,
        '{"ok":true}',
      ) },
    }],
    summary: answerMatrixSummary(benchmark, audit),
  });
  receipt.invocation.prepared_tasks_refs = [
    addArtifact(receipt.artifacts, `${JSON.stringify(task)}\n`),
  ];
  receipt.invocation.benchmark_ref = addArtifact(
    receipt.artifacts,
    JSON.stringify(benchmark),
    'application/json',
  );
  receipt.invocation.audit_ref = addArtifact(
    receipt.artifacts,
    JSON.stringify(audit),
    'application/json',
  );
  writeFileSync(resolve(root, 'evals/adapter.mjs'), 'export const patched = true;\n');
  git(root, 'add', 'evals/adapter.mjs');
  execFileSync('git', [
    '-C', root, '-c', 'user.name=Receipt Test', '-c', 'user.email=receipt@example.test',
    'commit', '-qm', 'patch answer harness',
  ]);
  attachPatchedHarness(receipt, createPatchedGitBinding(root));
  return { root, receipt };
}

function rewriteAnswerTrace(
  receipt: ReturnType<typeof buildReceipt>,
  mutate: (files: Record<string, string>) => void,
) {
  const run = receipt.runs[0];
  const trace = JSON.parse(receipt.artifacts[run.trace_ref].content);
  mutate(trace.artifact_files);
  delete trace.artifact_files['artifact-commit.json'];
  const embedded = {
    ...trace.artifact_files,
    'output.md': receipt.artifacts[run.output_ref].content,
  };
  trace.artifact_files['artifact-commit.json'] = JSON.stringify({
    schema_version: 1,
    required_files: ['output.md', 'events.json', 'metrics.json', 'metadata.json'],
    inventory_sha256: Object.fromEntries(Object.entries(embedded)
      .map(([name, content]) => [name, sha256(content)])),
  });
  run.trace_ref = addArtifact(receipt.artifacts, canonicalJson(trace), 'application/json');
}

function exampleReceipt() {
  const { root, source } = committedInputs();
  const receipt = buildReceipt({
    source,
    harness: {
      name: 'keyboardia-repo-runner',
      repository: source.repository,
      version: '1',
      git_commit: source.git_commit,
      mode: 'repo-owned',
    },
    invocation: {
      suite: 'receipt-test',
      models: ['test-model'],
      adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
      splits: ['tune'],
      repeats: 1,
      judge: false,
    },
    runs: [{
      model: 'test-model',
      case: 'case-1',
      kind: 'positive',
      split: 'tune',
      variant: 'with_skill',
      repeat: 0,
      ok: true,
      prompt: 'Exact prompt',
      response: 'Exact output',
      trace: [{ name: 'get_session', success: true }],
      assertions: [],
    }],
    summary: { errors: 0 },
  });
  return { root, receipt };
}

describe('eval receipts', () => {
  it('binds resolved private prompt bytes into the input bundle', () => {
    const manifest = JSON.stringify({
      cases: [{ id: 'private-case', prompt_ref: 'holdout/private.json' }],
    });
    const common = {
      manifestPath: 'evals/manifest.json', manifestContent: manifest,
      caseId: 'private-case', sourceFiles: [],
    };
    const first = skillEvalInputBundleHash({ ...common, resolvedPrompt: 'private prompt one' });
    const second = skillEvalInputBundleHash({ ...common, resolvedPrompt: 'private prompt two' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(() => skillEvalInputBundleHash(common)).toThrow(/cannot build input bundle/);
  });

  it('binds committed inputs and content-addresses exact run artifacts', () => {
    const { root, receipt } = exampleReceipt();
    expect(receipt.source.git_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(receipt.source.git_tree).toMatch(/^[0-9a-f]{40}$/);
    expect(receipt.runs[0].prompt_ref).toMatch(/^sha256:/);
    expect(receipt.runs[0].output_ref).toMatch(/^sha256:/);
    expect(receipt.runs[0].trace_ref).toMatch(/^sha256:/);
    expect(receipt.artifacts[receipt.runs[0].prompt_ref].content).toBe('Exact prompt');
    expect(verifyReceipt(receipt, { repoRoot: root })).toEqual([]);

    const path = resolve(root, 'receipt.json');
    writeReceipt(path, receipt);
    expect(JSON.parse(readFileSync(path, 'utf8')).source.git_commit)
      .toBe(receipt.source.git_commit);
  });

  it('detects tampered artifacts and immutable source mismatches', () => {
    const { root, receipt } = exampleReceipt();
    const promptRef = receipt.runs[0].prompt_ref;
    receipt.artifacts[promptRef].content = 'tampered prompt';
    expect(verifyReceipt(receipt, { repoRoot: root }).join('\n')).toContain('content hash mismatch');

    writeFileSync(resolve(root, 'skill/SKILL.md'), '# changed but uncommitted\n');
    expect(() => createSourceBinding(root, [{
      role: 'skill',
      path: 'skill/SKILL.md',
      bytes: readFileSync(resolve(root, 'skill/SKILL.md')),
    }])).toThrow(/dirty|does not match/);
  });

  it('self-verifies embedded source Git objects without local history', () => {
    const { source } = committedInputs();
    expect(verifySourceProvenance(source)).toEqual([]);

    const fabricatedCommit = structuredClone(source);
    fabricatedCommit.git_commit = 'f'.repeat(40);
    expect(verifySourceProvenance(fabricatedCommit).join('\n'))
      .toContain('commit object does not match');

    const fabricatedTree = structuredClone(source);
    fabricatedTree.tree_objects[0].content_base64 = Buffer.from('not a tree').toString('base64');
    expect(verifySourceProvenance(fabricatedTree).join('\n'))
      .toContain('failed self-verification');
  });

  it('closes CommonJS dependencies as well as ESM imports', () => {
    for (const content of [
      "require /* provenance comment */ ('./missing.cjs');\n",
      "require?.('./missing.cjs');\n",
      "const load = require; load('./missing.cjs');\n",
      "let load; load = require; load('./missing.cjs');\n",
      "module.require('./missing.cjs');\n",
      "(0, require)('./missing.cjs');\n",
    ]) {
      const source = { files: [{ path: 'evals/entry.cjs', content }] };
      expect(verifySourceModuleClosure(source, ['evals/entry.cjs']).join('\n'))
        .toContain('cannot resolve ./missing.cjs');
      source.files.push({ path: 'evals/missing.cjs', content: 'module.exports = {};\n' });
      expect(verifySourceModuleClosure(source, ['evals/entry.cjs'])).toEqual([]);
    }
  });

  it('reconstructs a patched external harness without trusting Git history', () => {
    const { root, receipt } = exampleReceipt();
    receipt.harness.version = 'test';
    writeFileSync(resolve(root, 'evals/adapter.mjs'), 'export const patched = true;\n');
    git(root, 'add', 'evals/adapter.mjs');
    execFileSync('git', [
      '-C', root, '-c', 'user.name=Receipt Test', '-c', 'user.email=receipt@example.test',
      'commit', '-qm', 'patch harness',
    ]);
    const binding = createPatchedGitBinding(root);
    attachPatchedHarness(receipt, binding);
    expect(verifyReceipt(receipt, { repoRoot: root })).toEqual([]);

    const fabricatedVersion = structuredClone(receipt);
    fabricatedVersion.harness.version = '999.0.0';
    expect(verifyReceipt(fabricatedVersion).join('\n')).toContain('reconstructed pyproject');

    const fabricatedId = structuredClone(receipt);
    fabricatedId.harness.git_commit = 'f'.repeat(40);
    expect(verifyReceipt(fabricatedId).join('\n')).toContain('commit artifact');

    const fabricatedPatch = structuredClone(receipt);
    fabricatedPatch.harness.patch_ref = addArtifact(
      fabricatedPatch.artifacts,
      '',
      'text/plain',
      { sanitize: false },
    );
    expect(verifyReceipt(fabricatedPatch).join('\n')).toContain('harness reconstruction failed');
  }, 60_000);

  it('rederives answer runs, summary, audit readiness and input bundles', () => {
    const { receipt } = answerReceiptFixture();
    expect(verifyReceipt(receipt)).toEqual([]);

    const multiReportReceipt = structuredClone(receipt);
    multiReportReceipt.invocation.benchmark_refs = [multiReportReceipt.invocation.benchmark_ref];
    multiReportReceipt.invocation.audit_refs = [multiReportReceipt.invocation.audit_ref];
    delete multiReportReceipt.invocation.benchmark_ref;
    delete multiReportReceipt.invocation.audit_ref;
    expect(verifyReceipt(multiReportReceipt)).toEqual([]);

    const fabricatedSummary = structuredClone(receipt);
    fabricatedSummary.summary.results = 999;
    expect(verifyReceipt(fabricatedSummary).join('\n')).toContain('summary does not match');

    const fabricatedRepository = structuredClone(receipt);
    fabricatedRepository.source.repository = 'https://attacker.invalid/keyboardia.git';
    fabricatedRepository.harness.repository = 'https://attacker.invalid/harness.git';
    expect(verifyReceipt(fabricatedRepository).join('\n')).toMatch(/canonical.*repository/);

    const fabricatedRun = structuredClone(receipt);
    fabricatedRun.runs[0].objective_pass_rate = 0;
    expect(verifyReceipt(fabricatedRun).join('\n')).toContain('scoring does not match');

    const blockedAudit = structuredClone(receipt);
    const benchmark = JSON.parse(
      blockedAudit.artifacts[blockedAudit.invocation.benchmark_ref].content,
    );
    const audit = {
      readiness: { blockers: ['blocked'] },
      benchmark: { summary: benchmark.summary, case_flags: benchmark.case_flags },
    };
    blockedAudit.invocation.audit_ref = addArtifact(
      blockedAudit.artifacts,
      JSON.stringify(audit),
      'application/json',
    );
    const blockedErrors = verifyReceipt(blockedAudit).join('\n');
    expect(blockedErrors).not.toContain('answer audit contains readiness blockers');
    expect(blockedErrors).toMatch(/audit counts|audit findings|audit readiness/);

    const strippedAudit = structuredClone(receipt);
    const strippedAuditValue = JSON.parse(
      strippedAudit.artifacts[strippedAudit.invocation.audit_ref].content,
    );
    strippedAuditValue.counts = {};
    strippedAuditValue.findings = [];
    strippedAudit.invocation.audit_ref = addArtifact(
      strippedAudit.artifacts,
      JSON.stringify(strippedAuditValue),
      'application/json',
    );
    expect(verifyReceipt(strippedAudit).join('\n'))
      .toMatch(/audit counts|audit findings/);

    const fabricatedReadiness = structuredClone(receipt);
    const fabricatedReadinessAudit = JSON.parse(
      fabricatedReadiness.artifacts[fabricatedReadiness.invocation.audit_ref].content,
    );
    fabricatedReadinessAudit.readiness.leak_saturated_cases = ['fabricated-case'];
    fabricatedReadinessAudit.readiness.ablations = {
      total: 99, materialized: 99, instruction_simulated: 99,
    };
    fabricatedReadiness.invocation.audit_ref = addArtifact(
      fabricatedReadiness.artifacts,
      JSON.stringify(fabricatedReadinessAudit),
      'application/json',
    );
    expect(verifyReceipt(fabricatedReadiness).join('\n')).toContain('audit readiness');

    const fabricatedPrompt = structuredClone(receipt);
    const task = {
      ...JSON.parse(fabricatedPrompt.artifacts[fabricatedPrompt.invocation.prepared_tasks_refs[0]].content),
      prompt: 'Fabricated prompt',
    };
    fabricatedPrompt.invocation.prepared_tasks_refs = [
      addArtifact(fabricatedPrompt.artifacts, `${JSON.stringify(task)}\n`),
    ];
    fabricatedPrompt.runs[0].prompt_ref = addArtifact(
      fabricatedPrompt.artifacts,
      'Fabricated prompt',
    );
    expect(verifyReceipt(fabricatedPrompt).join('\n')).toContain('prompt does not match embedded manifest');

    const coordinatedFabrication = structuredClone(receipt);
    coordinatedFabrication.runs[0].output_ref = addArtifact(
      coordinatedFabrication.artifacts,
      'This output fails the embedded oracle.',
    );
    expect(verifyReceipt(coordinatedFabrication).join('\n'))
      .toContain('independently regraded output');

    const coordinatedAggregate = structuredClone(receipt);
    const coordinatedBenchmark = JSON.parse(
      coordinatedAggregate.artifacts[coordinatedAggregate.invocation.benchmark_ref].content,
    );
    coordinatedBenchmark.summary = { fabricated: true };
    coordinatedBenchmark.by_model = { fabricated: true };
    coordinatedBenchmark.paired_summary = { fabricated: true };
    coordinatedBenchmark.case_flags = [{ case_id: 'case-1', flags: ['fabricated'] }];
    coordinatedBenchmark.reliability = { fabricated: true };
    coordinatedAggregate.invocation.benchmark_ref = addArtifact(
      coordinatedAggregate.artifacts,
      JSON.stringify(coordinatedBenchmark),
      'application/json',
    );
    const auditArtifact = {
      counts: { fabricated: 999 }, readiness: { blockers: [] },
      benchmark: {
        summary: coordinatedBenchmark.summary,
        case_flags: coordinatedBenchmark.case_flags,
      },
    };
    coordinatedAggregate.invocation.audit_ref = addArtifact(
      coordinatedAggregate.artifacts,
      JSON.stringify(auditArtifact),
      'application/json',
    );
    coordinatedAggregate.summary = { fabricated: true };
    expect(verifyReceipt(coordinatedAggregate).join('\n'))
      .toContain('independently derived result aggregates');

    const omittedHarness = structuredClone(receipt);
    omittedHarness.harness.mode = 'fixture';
    for (const field of [
      'git_tree', 'parent_git_commit', 'parent_git_tree', 'patch_ref',
      'parent_tree_ref', 'commit_ref', 'parent_commit_ref',
    ]) delete omittedHarness.harness[field];
    expect(verifyReceipt(omittedHarness).join('\n')).toContain('must be equal to constant');

    const inventoryDrift = structuredClone(receipt);
    const trace = JSON.parse(inventoryDrift.artifacts[inventoryDrift.runs[0].trace_ref].content);
    trace.artifact_files['events.json'] = '{"tampered":true}\n';
    inventoryDrift.runs[0].trace_ref = addArtifact(
      inventoryDrift.artifacts,
      canonicalJson(trace),
      'application/json',
    );
    expect(verifyReceipt(inventoryDrift).join('\n')).toContain('inventory digest mismatch');

    const missingCell = structuredClone(receipt);
    missingCell.invocation.prepared_tasks_refs = [addArtifact(missingCell.artifacts, '')];
    expect(verifyReceipt(missingCell).join('\n')).toContain('complete manifest × variant × model × repeat matrix');

    const adapterMismatch = structuredClone(receipt);
    rewriteAnswerTrace(adapterMismatch, (files) => {
      const metadata = JSON.parse(files['metadata.json']);
      metadata.provider = 'subagent';
      metadata.telemetry.basis.provider = 'subagent';
      metadata.telemetry.basis.runner = 'subagent';
      files['metadata.json'] = JSON.stringify(metadata);
    });
    expect(verifyReceipt(adapterMismatch).join('\n')).toContain('provider/runner metadata does not match');
  }, 60_000);

  it('reconstructs no-lift findings from the embedded benchmark', () => {
    const { receipt } = answerReceiptFixture();
    const noLiftBenchmark = JSON.parse(
      receipt.artifacts[receipt.invocation.benchmark_ref].content,
    );
    const noLiftFlag = {
      case_id: 'case-1',
      eval_intent: 'capability',
      with_skill: 1,
      without_skill: 0.5,
      flags: ['no objective lift'],
    };
    noLiftBenchmark.case_flags = [noLiftFlag];
    receipt.invocation.benchmark_ref = addArtifact(
      receipt.artifacts,
      JSON.stringify(noLiftBenchmark),
      'application/json',
    );
    const audit = JSON.parse(receipt.artifacts[receipt.invocation.audit_ref].content);
    audit.benchmark.case_flags = [noLiftFlag];
    audit.findings.push({
      kind: 'no-lift-eval',
      severity: 'recommended',
      message: 'fixture',
      evidence: noLiftFlag,
    });
    receipt.invocation.audit_ref = addArtifact(
      receipt.artifacts,
      JSON.stringify(audit),
      'application/json',
    );
    expect(verifyReceipt(receipt)).toEqual([]);

    audit.findings.pop();
    receipt.invocation.audit_ref = addArtifact(
      receipt.artifacts,
      JSON.stringify(audit),
      'application/json',
    );
    expect(verifyReceipt(receipt).join('\n')).toContain('audit findings');
  });

  it('preserves a fully committed provider timeout as negative evidence', () => {
    const { receipt } = answerReceiptFixture();
    const benchmark = JSON.parse(
      receipt.artifacts[receipt.invocation.benchmark_ref].content,
    );
    benchmark.results[0].execution_valid = false;
    benchmark.results[0].metadata.returncode = 124;
    benchmark.results[0].metadata.timed_out = true;
    receipt.runs[0].ok = false;
    receipt.summary = answerMatrixSummary(benchmark);
    receipt.invocation.benchmark_ref = addArtifact(
      receipt.artifacts,
      JSON.stringify(benchmark),
      'application/json',
    );

    expect(verifyReceipt(receipt)).toEqual([]);
  });

  it('reconstructs live execution runs and summary from deterministic replay evidence', () => {
    const { source } = committedInputs({ execution: true });
    const baseline = { tempo: 120, tracks: [] };
    const final = { tempo: 120, tracks: [] };
    const trace: unknown[] = [];
    const assertions = [{
      name: 'tempo-preserved', type: 'state', check: 'tempo_unchanged', severity: 'gate',
    }];
    const scored = scoreExecution(assertions, { baseline, final, trace });
    const manifest = parsedManifestFor(source);
    const run = {
      model: 'claude-test-model', case: 'execution-case', kind: 'execution', split: 'tune',
      variant: 'with_skill', repeat: 0, ok: true, scorable: true,
      ...summarizeRun(scored), assertions: scored, execution: { baseline, final, trace },
      prompt: 'Execute', response: 'done',
    };
    const summary = summarize([run], { models: ['claude-test-model'] }, manifest);
    const replay = buildExecutionReplayEvidence(manifest, [run], { models: ['claude-test-model'] }, summary);
    const tools = [{ name: 'get_session', inputSchema: { type: 'object' } }];
    const receipt = buildReceipt({
      source,
      harness: {
        name: 'keyboardia-repo-runner',
        repository: 'https://github.com/adewale/keyboardia.git', version: '1',
        git_commit: source.git_commit, mode: 'repo-owned',
      },
      invocation: {
        suite: 'execution-benchmark', models: ['claude-test-model'],
        adapters: [{ role: 'answer', id: 'claude-mcp', path: 'evals/adapters/claude-mcp.mjs' }],
        splits: ['tune'], repeats: 1, judge: false,
        system_under_test: {
          base_url: 'http://127.0.0.1:43189', mcp_endpoint: 'http://127.0.0.1:43189/mcp',
          launch: {
            mode: 'runner-owned-wrangler-local', wrangler_version: 'wrangler 4.53.0',
            wrangler_lock_version: '4.53.0', wrangler_lock_integrity: 'sha512-test',
            source_git_commit: source.git_commit, source_git_tree: source.git_tree,
          },
          tools_list: tools, tools_list_sha256: sha256(canonicalJson(tools)),
        },
        execution_replay: replay,
      },
      runs: [run],
      summary,
    });
    expect(verifyReceipt(receipt)).toEqual([]);
    expect(verifyExecutionReceipt(receipt)).toEqual([]);

    const missingScorer = structuredClone(receipt);
    missingScorer.source.files = missingScorer.source.files
      .filter((file) => file.path !== 'evals/score-execution.mjs');
    expect(verifyExecutionReceipt(missingScorer).join('\n'))
      .toContain('must bind evals/score-execution.mjs');

    const adapterMismatch = structuredClone(receipt);
    adapterMismatch.invocation.adapters[0] = { role: 'answer', id: 'untrusted', path: null };
    expect(verifyExecutionReceipt(adapterMismatch).join('\n'))
      .toContain('exactly the bound claude-mcp answer adapter');

    const fabricatedRun = structuredClone(receipt);
    fabricatedRun.runs[0].assertions[0].passed = false;
    expect(verifyExecutionReceipt(fabricatedRun).join('\n')).toContain('replay projection');

    const externalWorker = structuredClone(receipt);
    externalWorker.invocation.system_under_test.launch.mode = 'external-unattested';
    expect(verifyExecutionReceipt(externalWorker).join('\n')).toContain('runner-owned');

    const manifestDrift = structuredClone(receipt);
    manifestDrift.invocation.execution_replay.input.cases[0].assertions[0].check = 'tempo_equals';
    manifestDrift.invocation.execution_replay.input.cases[0].assertions[0].value = 120;
    manifestDrift.invocation.execution_replay.input_sha256 = sha256(canonicalJson(
      manifestDrift.invocation.execution_replay.input,
    ));
    manifestDrift.invocation.execution_replay.projection = projectExecutionReplay(
      manifestDrift.invocation.execution_replay.input,
    );
    manifestDrift.invocation.execution_replay.projection_sha256 = sha256(canonicalJson(
      manifestDrift.invocation.execution_replay.projection,
    ));
    expect(verifyExecutionReceipt(manifestDrift).join('\n'))
      .toContain('do not match the embedded manifest');

    const wrongEndpoint = structuredClone(receipt);
    wrongEndpoint.invocation.system_under_test.mcp_endpoint = 'http://127.0.0.1:43189/not-mcp';
    expect(verifyExecutionReceipt(wrongEndpoint).join('\n')).toContain('does not match the owned Worker');
  });

  it('is shallow-history safe and rejects unsanitized host paths', () => {
    const { receipt } = answerReceiptFixture();
    const unrelated = mkdtempSync(resolve(tmpdir(), 'keyboardia-unrelated-git-'));
    git(unrelated, 'init', '-q');
    writeFileSync(resolve(unrelated, 'README.md'), 'unrelated\n');
    git(unrelated, 'add', '.');
    execFileSync('git', [
      '-C', unrelated, '-c', 'user.name=Receipt Test', '-c', 'user.email=receipt@example.test',
      'commit', '-qm', 'unrelated',
    ]);
    expect(verifyReceipt(receipt, { repoRoot: unrelated })).toEqual([]);

    const fabricatedSource = structuredClone(receipt);
    fabricatedSource.source.git_commit = 'f'.repeat(40);
    expect(verifyReceipt(fabricatedSource, { repoRoot: unrelated }).join('\n'))
      .toContain('source commit object does not match');

    receipt.summary.host = '/Users/example/private/eval-output.json';
    expect(verifyReceipt(receipt).join('\n')).toContain('unsanitized host path');

    const rootPath = structuredClone(receipt);
    rootPath.summary.host = '/root/private/eval-output.json';
    expect(verifyReceipt(rootPath).join('\n')).toContain('unsanitized host path');

    const encodedPath = structuredClone(receipt);
    encodedPath.summary.host = Buffer.from('/Users/example/private/eval-output.json')
      .toString('base64url');
    expect(verifyReceipt(encodedPath).join('\n')).toContain('unsanitized host path');

    const deeplyEncodedPath = structuredClone(receipt);
    deeplyEncodedPath.summary.host = Array.from({ length: 9 }).reduce(
      (value) => Buffer.from(value).toString('base64'),
      '/Users/example/private/eval-output.json',
    );
    expect(verifyReceipt(deeplyEncodedPath).join('\n')).toContain('unsanitized host path');
  }, 60_000);

  it('fails closed when a registered capability survives in any encoding or key', () => {
    const { source } = committedInputs();
    const capability = '8c991b32-6ed8-4f4f-9433-976e68f62230';
    const encoded = encodeURIComponent(capability).replaceAll('-', '%2D');
    const doubleEncoded = encodeURIComponent(encoded);
    const base64Encoded = Buffer.from(capability).toString('base64');
    const compact = capability.replaceAll('-', '');
    const compactBase64 = Buffer.from(compact).toString('base64url');
    const base = {
      source,
      harness: {
        name: 'keyboardia-repo-runner',
        repository: source.repository,
        version: '1',
        git_commit: source.git_commit,
        mode: 'repo-owned',
      },
      invocation: {
        suite: 'receipt-test',
        models: ['test-model'],
        adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
        splits: ['tune'],
        repeats: 1,
        judge: false,
      },
      summary: {},
      capabilities: new Set([capability]),
    };
    const deeplyEncoded = Array.from({ length: 9 }).reduce(
      (value) => Buffer.from(value).toString('base64'),
      capability,
    );
    for (const leaked of [
      capability,
      encoded,
      doubleEncoded,
      base64Encoded,
      compact,
      compactBase64,
      deeplyEncoded,
    ]) {
      expect(() => buildReceipt({
        ...base,
        runs: [{
          model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
          variant: 'with_skill', repeat: 0, prompt: leaked, response: 'ok', assertions: [],
        }],
      })).toThrow(/edit capability/);
    }
    expect(() => buildReceipt({
      ...base,
      runs: [{
        model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
        variant: 'with_skill', repeat: 0, prompt: 'safe', response: 'ok',
        trace: [{ [doubleEncoded]: 'leaked-key' }], assertions: [],
      }],
    })).toThrow(/edit capability/);

    const safe = redactCapability({ prompt: doubleEncoded, trace: [{ [encoded]: capability }] }, capability);
    expect(JSON.stringify(safe)).not.toContain(capability);
    expect(redactCapability('benign%20URL', capability)).toBe('benign%20URL');
    expect(redactCapability(base64Encoded, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(compact, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(compactBase64, capability)).toBe('<redacted-session-id>');
    expect(redactCapability(deeplyEncoded, capability)).toBe('<redacted-session-id>');
    const returnedCapability = '24a1e192-6ea3-4c2c-8797-28ea4b06f8b9';
    const registered = registerCapabilitiesFromEvidence({
      result: { session_id: returnedCapability },
    }, new Set<string>());
    expect(registered.has(returnedCapability)).toBe(true);
    expect(() => buildReceipt({
      ...base,
      runs: [{
        model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
        variant: 'with_skill', repeat: 0, ...safe, response: 'ok', assertions: [],
      }],
    })).not.toThrow();
  });

  it('rejects unsafe receipt oracle commands without executing them', () => {
    const { source } = committedInputs();
    expect(() => scoreObjectiveAssertions({
      assertions: [{
        name: 'unsafe', type: 'script', command: ['sh', '-c', 'exit 0'], severity: 'gate',
      }],
    }, 'output', 'evals/manifest.json', source.files)).toThrow(/unsafe script assertion command/);
  });

  it('sanitizes nested JSON arguments without corrupting their structure', () => {
    const value = {
      adapter_argv: [
        '{"mcpServers":{"transport":{"env":{"TRACE":"/var/folders/example/run.jsonl"}}}}',
      ],
    };
    const sanitized = sanitizeReceiptValue(value);
    expect(JSON.parse(sanitized.adapter_argv[0])).toEqual({
      mcpServers: { transport: { env: { TRACE: '<temp-path>' } } },
    });
  });

  it('regrades a bound oracle with an imported dependency under canonical temp paths', () => {
    const sourceFiles = [{
      role: 'oracle',
      path: 'evals/oracle.mjs',
      content: [
        "import { readFileSync } from 'node:fs';",
        "import { expected } from './oracle-dependency.mjs';",
        "process.exitCode = readFileSync(process.argv[2], 'utf8') === expected ? 0 : 1;",
        '',
      ].join('\n'),
    }, {
      role: 'oracle_dependency',
      path: 'evals/oracle-dependency.mjs',
      content: "export const expected = 'safe';\n",
    }];
    expect(scoreObjectiveAssertions({
      assertions: [{
        name: 'dependent', type: 'script',
        command: ['node', 'oracle.mjs', '{output_path}'], severity: 'critical',
      }],
    }, 'safe', 'evals/manifest.json', sourceFiles)).toEqual([{
      name: 'dependent', type: 'script', severity: 'critical', passed: true,
    }]);
    expect(() => scoreObjectiveAssertions({
      assertions: [{
        name: 'dependency-is-not-a-root', type: 'script',
        command: ['node', 'oracle-dependency.mjs', '{output_path}'], severity: 'critical',
      }],
    }, 'safe', 'evals/manifest.json', sourceFiles)).toThrow(/not a bound oracle/);
  });

  it('rejects incomplete importer matrices and end-of-run worktree drift', () => {
    const manifest = {
      variants: ['with_skill', 'without_skill'],
      cases: [{ id: 'case-1', kind: 'positive', split: 'tune' }],
    };
    const policy = {
      splits: ['tune'], repeats: 2, models: ['claude-test', 'gpt-test'],
    };
    expect(() => verifyCompleteTaskMatrix([{
      case_id: 'case-1', kind: 'positive', split: 'tune', variant: 'with_skill',
      run_number: 1, model: 'gpt-test',
    }], manifest, policy)).toThrow(/complete policy case/);

    const { root, source } = committedInputs();
    expect(() => assertSourceBindingStillClean(root, source)).not.toThrow();
    writeFileSync(resolve(root, 'untracked-after-run.txt'), 'drift\n');
    expect(() => assertSourceBindingStillClean(root, source)).toThrow(/changed during evaluation/);
  });

  it('enforces the committed JSON Schema at runtime', () => {
    const { receipt } = exampleReceipt();
    const unexpected = { ...receipt, unexpected: true };
    expect(verifyReceipt(unexpected).join('\n')).toContain('must NOT have additional properties');
    const unexpectedInvocation = structuredClone(receipt);
    unexpectedInvocation.invocation.unexpected = true;
    expect(verifyReceipt(unexpectedInvocation).join('\n'))
      .toContain('must NOT have additional properties');
    const unexpectedRun = structuredClone(receipt);
    unexpectedRun.runs[0].unexpected = true;
    expect(verifyReceipt(unexpectedRun).join('\n'))
      .toContain('must NOT have additional properties');
  });

  it('canonicalizes JSON independently of object insertion order', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));
  });
});
