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
  createPatchedGitBinding,
  createSourceBinding,
  redactCapability,
  sha256,
  skillEvalInputBundleHash,
  verifyReceipt,
  writeReceipt,
} from '../../evals/receipt.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import {
  buildExecutionReplayEvidence,
  summarize,
  summarizeRun,
} from '../../evals/run-benchmark.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { scoreExecution } from '../../evals/score-execution.mjs';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import { verifyExecutionReceipt } from '../../evals/verify-execution-receipt.mjs';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function committedInputs() {
  const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-receipt-test-'));
  git(root, 'init', '-q');
  const files = [
    ['skill', 'skill/SKILL.md', '# Skill\n'],
    ['manifest', 'evals/manifest.json', `${JSON.stringify({
      version: 1,
      cases: [{
        id: 'case-1',
        kind: 'positive',
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
    ['fixture', 'evals/fixture.txt', 'exact fixture\n'],
    ['runner', 'evals/run.mjs', 'export {};\n'],
    ['receipt_runtime', 'evals/receipt.mjs', 'export {};\n'],
    ['receipt_schema', 'evals/receipt.schema.json', '{}\n'],
    ['answer_adapter', 'evals/adapter.mjs', 'export {};\n'],
    ['oracle', 'evals/oracle.mjs', [
      "import { readFileSync } from 'node:fs';",
      "process.exitCode = readFileSync(process.argv[2], 'utf8') === '{\"ok\":true}' ? 0 : 1;",
      '',
    ].join('\n')],
    ['execution_receipt_verifier', 'evals/verify-execution-receipt.mjs', 'export {};\n'],
    ['system_under_test_entry', 'app/worker.ts', 'export {};\n'],
    ['system_under_test_config', 'app/wrangler.jsonc', '{}\n'],
    ['system_under_test_typescript_config', 'app/tsconfig.json', '{}\n'],
    ['system_under_test_package', 'app/package.json', '{}\n'],
    ['system_under_test_lock', 'app/package-lock.json', '{}\n'],
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

function answerReceiptFixture() {
  const { root, source } = committedInputs();
  const manifest = source.files.find((file) => file.role === 'manifest');
  const inputBundleHash = skillEvalInputBundleHash({
    manifestPath: manifest.path,
    manifestContent: manifest.content,
    caseId: 'case-1',
    sourceFiles: source.files,
  });
  const skillTreeHash = 'a'.repeat(64);
  const task = {
    case_id: 'case-1', kind: 'positive', split: 'tune', variant: 'with_skill',
    run_number: 0, model: 'test-model', prompt: 'Exact prompt',
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
      case_id: 'case-1', kind: 'positive', split: 'tune', variant: 'with_skill',
      run_number: 0, model: 'test-model', missing_output: false, execution_valid: true,
      assertions, objective_passed: 4, objective_total: 4,
      objective_pass_rate: 1, critical_failures: [], vetoed: false,
      metadata: { input_bundle_hash: inputBundleHash },
    }],
    summary: { with_skill: { runs: 1 }, without_skill: { runs: 0 } },
    paired_summary: { pairs: 0 },
    by_model: { 'test-model': { runs: 1 } },
    case_flags: [],
    reliability: { errors: 0 },
  };
  const audit = {
    counts: { cases: 1 },
    readiness: { blockers: [] },
    benchmark: { summary: benchmark.summary, case_flags: benchmark.case_flags },
  };
  const parsedManifest = JSON.parse(manifest.content);
  const evalCase = parsedManifest.cases[0];
  const receipt = buildReceipt({
    source,
    harness: {
      name: 'skill-eval-harness', repository: 'local', version: 'test',
      git_commit: source.git_commit, mode: 'fixture',
    },
    invocation: {
      suite: 'keyboardia-answer-matrix', models: ['test-model'],
      adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
      splits: ['tune'], repeats: 1, judge: false,
      manifest_revision: manifest.sha256, skill_tree_hash: skillTreeHash,
    },
    runs: [{
      model: 'test-model', case: 'case-1', kind: 'positive', split: 'tune',
      variant: 'with_skill', repeat: 0, ok: true, prompt: 'Exact prompt',
      response: '{"ok":true}', assertions, objective_passed: 4,
      objective_total: 4, objective_pass_rate: 1, critical_failures: [], vetoed: false,
      input_bundle_hash: inputBundleHash,
      trace: { artifact_files: {
        'metadata.json': JSON.stringify({ input_bundle_hash: inputBundleHash }),
        'prompt.md': answerHarnessPrompt(task, evalCase, parsedManifest),
      } },
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
  return { root, receipt };
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

  it('reconstructs a patched external harness without trusting Git history', () => {
    const { root, receipt } = exampleReceipt();
    writeFileSync(resolve(root, 'evals/adapter.mjs'), 'export const patched = true;\n');
    git(root, 'add', 'evals/adapter.mjs');
    execFileSync('git', [
      '-C', root, '-c', 'user.name=Receipt Test', '-c', 'user.email=receipt@example.test',
      'commit', '-qm', 'patch harness',
    ]);
    const binding = createPatchedGitBinding(root);
    attachPatchedHarness(receipt, binding);
    expect(verifyReceipt(receipt, { repoRoot: root })).toEqual([]);

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
  });

  it('rederives answer runs, summary, audit readiness and input bundles', () => {
    const { receipt } = answerReceiptFixture();
    expect(verifyReceipt(receipt)).toEqual([]);

    const fabricatedSummary = structuredClone(receipt);
    fabricatedSummary.summary.results = 999;
    expect(verifyReceipt(fabricatedSummary).join('\n')).toContain('summary does not match');

    const fabricatedRun = structuredClone(receipt);
    fabricatedRun.runs[0].objective_pass_rate = 0;
    expect(verifyReceipt(fabricatedRun).join('\n')).toContain('scoring does not match');

    const blockedAudit = structuredClone(receipt);
    const audit = { counts: { cases: 1 }, readiness: { blockers: ['blocked'] }, benchmark: {
      summary: receipt.summary.summary, case_flags: receipt.summary.case_flags,
    } };
    blockedAudit.invocation.audit_ref = addArtifact(
      blockedAudit.artifacts,
      JSON.stringify(audit),
      'application/json',
    );
    expect(verifyReceipt(blockedAudit).join('\n')).toContain('readiness blockers');

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
  });

  it('reconstructs live execution runs and summary from deterministic replay evidence', () => {
    const { source } = committedInputs();
    const baseline = { tempo: 120, tracks: [] };
    const final = { tempo: 120, tracks: [] };
    const trace: unknown[] = [];
    const assertions = [{
      name: 'tempo-preserved', type: 'state', check: 'tempo_unchanged', severity: 'gate',
    }];
    const scored = scoreExecution(assertions, { baseline, final, trace });
    const manifest = {
      variants: ['with_skill'],
      cases: [{ id: 'execution-case', kind: 'execution', assertions }],
    };
    const run = {
      model: 'test-model', case: 'execution-case', kind: 'execution', split: 'tune',
      variant: 'with_skill', repeat: 0, ok: true, scorable: true,
      ...summarizeRun(scored), assertions: scored, execution: { baseline, final, trace },
      prompt: 'Execute', response: 'done',
    };
    const summary = summarize([run], { models: ['test-model'] }, manifest);
    const replay = buildExecutionReplayEvidence(manifest, [run], { models: ['test-model'] }, summary);
    const tools = [{ name: 'get_session', inputSchema: { type: 'object' } }];
    const receipt = buildReceipt({
      source,
      harness: {
        name: 'keyboardia-repo-runner', repository: 'local', version: '1',
        git_commit: source.git_commit, mode: 'repo-owned',
      },
      invocation: {
        suite: 'execution-benchmark', models: ['test-model'],
        adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
        splits: ['tune'], repeats: 1, judge: false,
        system_under_test: {
          base_url: 'http://127.0.0.1:43189', mcp_endpoint: 'http://127.0.0.1:43189/mcp',
          launch: {
            mode: 'runner-owned-wrangler-local', wrangler_version: 'test',
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

    const fabricatedRun = structuredClone(receipt);
    fabricatedRun.runs[0].assertions[0].passed = false;
    expect(verifyExecutionReceipt(fabricatedRun).join('\n')).toContain('replay projection');

    const externalWorker = structuredClone(receipt);
    externalWorker.invocation.system_under_test.launch.mode = 'external-unattested';
    expect(verifyExecutionReceipt(externalWorker).join('\n')).toContain('runner-owned');
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

    receipt.summary.host = '/Users/example/private/eval-output.json';
    expect(verifyReceipt(receipt).join('\n')).toContain('unsanitized host path');
  });

  it('fails closed when a registered capability survives in any encoding or key', () => {
    const { source } = committedInputs();
    const capability = '8c991b32-6ed8-4f4f-9433-976e68f62230';
    const encoded = encodeURIComponent(capability).replaceAll('-', '%2D');
    const doubleEncoded = encodeURIComponent(encoded);
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
    for (const leaked of [capability, encoded, doubleEncoded]) {
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
    expect(() => buildReceipt({
      ...base,
      runs: [{
        model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
        variant: 'with_skill', repeat: 0, ...safe, response: 'ok', assertions: [],
      }],
    })).not.toThrow();
  });

  it('canonicalizes JSON independently of object insertion order', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));
  });
});
