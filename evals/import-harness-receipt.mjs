#!/usr/bin/env node
/** Import a skill-eval-harness answer matrix into a durable Keyboardia receipt. */
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  sanitizeReceiptText,
  sha256,
  skillEvalInputBundleHash,
  writeReceipt,
} from './receipt.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');
const ARTIFACT_COMMIT = 'artifact-commit.json';
const REQUIRED_ARTIFACTS = ['output.md', 'events.json', 'metrics.json', 'metadata.json'];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { tasks: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--tasks') options.tasks.push(resolve(value));
    else if (flag === '--manifest') options.manifest = resolve(value);
    else if (flag === '--runs') options.runs = resolve(value);
    else if (flag === '--benchmark') options.benchmark = resolve(value);
    else if (flag === '--audit') options.audit = resolve(value);
    else if (flag === '--harness-repo') options.harnessRepo = resolve(value);
    else if (flag === '--out') options.out = resolve(value);
    else fail(`unknown argument: ${flag}`);
    index += 1;
  }
  for (const name of ['manifest', 'runs', 'benchmark', 'audit', 'harnessRepo', 'out']) {
    if (!options[name]) fail(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (options.tasks.length === 0) fail('at least one --tasks file is required');
  return options;
}

function git(root, args, { bytes = false, optional = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: bytes ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (optional) return null;
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr ?? '').trim();
    fail(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return bytes ? result.stdout : result.stdout.trim();
}

function checkedChild(root, child) {
  const absoluteRoot = realpathSync(root);
  const absolute = resolve(absoluteRoot, child);
  const rel = relative(absoluteRoot, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`run path escapes the runs root: ${child}`);
  }
  return absolute;
}

function json(path, label = path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function loadTasks(paths) {
  const tasks = [];
  const rawFiles = [];
  for (const path of paths) {
    const raw = readFileSync(path, 'utf8');
    rawFiles.push({ path, raw });
    for (const [index, line] of raw.split('\n').entries()) {
      if (!line.trim()) continue;
      try {
        tasks.push(JSON.parse(line));
      } catch (error) {
        fail(`${path}:${index + 1} is not valid JSON: ${error.message}`);
      }
    }
  }
  return { tasks, rawFiles };
}

function taskIdentity(task) {
  return canonicalJson([
    task.case_id,
    task.kind,
    task.split,
    task.variant,
    task.run_number,
    task.model,
  ]);
}

function expectedMatrixIdentities(manifest, policy) {
  const identities = [];
  const splits = new Set(policy.splits);
  for (const evalCase of manifest.cases ?? []) {
    if (evalCase.kind === 'trigger' || !splits.has(evalCase.split ?? 'tune')) continue;
    for (const variant of manifest.variants ?? []) {
      for (const model of policy.models) {
        for (let repeat = 1; repeat <= policy.repeats; repeat += 1) {
          identities.push(taskIdentity({
            case_id: evalCase.id,
            kind: evalCase.kind ?? 'behavior',
            split: evalCase.split ?? 'tune',
            variant,
            run_number: repeat,
            model,
          }));
        }
      }
    }
  }
  return identities.sort();
}

export function verifyCompleteTaskMatrix(tasks, manifest, policy) {
  const actual = tasks.map(taskIdentity).sort();
  const expected = expectedMatrixIdentities(manifest, policy);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail('prepared tasks do not form the complete policy case × variant × model × repeat matrix');
  }
}

function verifyArtifactSet(runDir) {
  const commit = json(resolve(runDir, ARTIFACT_COMMIT), `${runDir}/${ARTIFACT_COMMIT}`);
  if (commit.schema_version !== 1 || JSON.stringify(commit.required_files) !== JSON.stringify(REQUIRED_ARTIFACTS)) {
    fail(`${runDir} has an unsupported artifact commit`);
  }
  const inventory = commit.inventory_sha256;
  if (!inventory || typeof inventory !== 'object' || !Object.hasOwn(inventory, 'prompt.md')) {
    fail(`${runDir} does not bind its exact prompt.md`);
  }
  for (const name of [...REQUIRED_ARTIFACTS, 'prompt.md']) {
    if (!Object.hasOwn(inventory, name)) fail(`${runDir} does not bind ${name}`);
  }
  for (const [name, digest] of Object.entries(inventory)) {
    if (isAbsolute(name) || name.split('/').includes('..') || !/^[0-9a-f]{64}$/.test(digest)) {
      fail(`${runDir} contains an invalid artifact inventory entry: ${name}`);
    }
    const path = checkedChild(runDir, name);
    if (sha256(readFileSync(path)) !== digest) fail(`${path} does not match ${ARTIFACT_COMMIT}`);
  }
  const files = [];
  function collect(path, prefix = '') {
    for (const dirent of readdirSync(path, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) collect(resolve(path, dirent.name), name);
      else if (dirent.isFile() && name !== ARTIFACT_COMMIT) files.push(name);
      else if (!dirent.isFile()) fail(`${runDir} contains a non-file artifact: ${name}`);
    }
  }
  collect(runDir);
  if (JSON.stringify(files.sort()) !== JSON.stringify(Object.keys(inventory).sort())) {
    fail(`${runDir} contains files outside its committed inventory`);
  }
  return { commit, inventory };
}

function harnessBinding(harnessRepo) {
  const binding = createPatchedGitBinding(harnessRepo);
  const repository = git(harnessRepo, ['config', '--get', 'remote.origin.url'], { optional: true }) ?? 'local';
  const pyproject = readFileSync(resolve(harnessRepo, 'pyproject.toml'), 'utf8');
  const version = pyproject.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!version) fail('cannot determine skill-eval-harness version');
  return { ...binding, repository, version };
}

function sourceBinding() {
  return createSourceBinding(repoRoot, [
    { role: 'skill', path: 'app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md' },
    { role: 'manifest', path: 'evals/shared-benchmark.json' },
    { role: 'answer_matrix_policy', path: 'evals/answer-matrix-policy.json' },
    { role: 'fixture', path: 'evals/fixtures/keyboardia-mcp-schema.json' },
    { role: 'oracle', path: 'evals/oracles/capability-answer.mjs' },
    // This module is both imported by capability-answer.mjs and invoked
    // directly by the public changelog case, so it is an oracle root too.
    { role: 'oracle', path: 'evals/oracles/public-changelog-safe.mjs' },
    { role: 'answer_adapter', path: 'evals/adapters/claude.mjs' },
    { role: 'answer_adapter_dependency', path: 'evals/adapters/usage.mjs' },
    { role: 'runner', path: 'evals/import-harness-receipt.mjs' },
    { role: 'receipt_runtime', path: 'evals/receipt.mjs' },
    { role: 'receipt_schema_validator', path: 'evals/validate-receipt-schema.mjs' },
    { role: 'receipt_schema', path: 'evals/receipt.schema.json' },
  ]);
}

function runEvidence(
  task,
  result,
  runsRoot,
  expectedCase,
  manifest,
  expectedManifestRevision,
  expectedSkillHash,
  expectedInputBundleHash,
) {
  if (!expectedCase) fail(`${task.run_dir} has no case in the supplied manifest`);
  if (task.prompt !== expectedCase.prompt) {
    fail(`${task.run_dir} prompt does not match the supplied manifest case`);
  }
  if (task.kind !== (expectedCase.kind ?? 'behavior')) {
    fail(`${task.run_dir} kind does not match the supplied manifest case`);
  }
  if (task.split !== (expectedCase.split ?? 'tune')) {
    fail(`${task.run_dir} split does not match the supplied manifest case`);
  }
  if (task.manifest_revision !== expectedManifestRevision) {
    fail(`${task.run_dir} was prepared from a different manifest revision`);
  }
  if (task.skill_tree_hash !== expectedSkillHash) {
    fail(`${task.run_dir} was prepared from a different skill tree`);
  }
  if (task.input_bundle_hash !== expectedInputBundleHash) {
    fail(`${task.run_dir} was prepared from a different input bundle`);
  }
  const runDir = checkedChild(runsRoot, task.run_dir);
  if (resolve(result.run_base) !== resolve(runDir)) fail(`${task.run_dir} does not match its benchmark result`);
  for (const [taskKey, resultKey] of [
    ['case_id', 'case_id'], ['variant', 'variant'], ['run_number', 'run_number'], ['model', 'model'],
  ]) {
    if (task[taskKey] !== result[resultKey]) fail(`${task.run_dir} has mismatched ${taskKey}`);
  }
  if (result.missing_output || result.execution_valid !== true) fail(`${task.run_dir} is not a complete scorable run`);
  const { inventory } = verifyArtifactSet(runDir);
  const metadata = json(resolve(runDir, 'metadata.json'));
  if (metadata.manifest_revision !== expectedManifestRevision
      || metadata.skill_tree_hash !== expectedSkillHash
      || metadata.input_bundle_hash !== expectedInputBundleHash) {
    fail(`${task.run_dir} metadata is not bound to the prepared inputs`);
  }
  const basis = metadata.telemetry?.basis;
  const expectedProvider = /^claude-/i.test(task.model) ? 'subagent'
    : /^gpt-/i.test(task.model) ? 'codex' : null;
  if (!expectedProvider || metadata.provider !== expectedProvider
      || basis?.provider !== expectedProvider || basis?.runner !== expectedProvider
      || basis?.model !== task.model) {
    fail(`${task.run_dir} provider/runner metadata does not match ${task.model}`);
  }
  const traceFiles = {};
  let output;
  const receiptInventory = {};
  for (const name of Object.keys(inventory).sort()) {
    const sanitized = sanitizeReceiptText(readFileSync(resolve(runDir, name), 'utf8'));
    receiptInventory[name] = sha256(sanitized);
    if (name === 'output.md') output = sanitized;
    else traceFiles[name] = sanitized;
  }
  traceFiles[ARTIFACT_COMMIT] = JSON.stringify({
    schema_version: 1,
    required_files: REQUIRED_ARTIFACTS,
    inventory_sha256: receiptInventory,
  });
  const prompt = traceFiles['prompt.md'];
  if (prompt !== answerHarnessPrompt(task, expectedCase, manifest)) {
    fail(`${task.run_dir} prompt.md does not match its prepared task and manifest`);
  }
  return {
    model: task.model ?? null,
    case: task.case_id,
    kind: task.kind,
    split: task.split,
    variant: task.variant,
    repeat: task.run_number,
    ok: true,
    prompt: task.prompt,
    response: output,
    trace: { artifact_files: traceFiles },
    assertions: result.assertions ?? [],
    usage: metadata.usage_normalized ?? null,
    objective_passed: result.objective_passed,
    objective_total: result.objective_total,
    objective_pass_rate: result.objective_pass_rate,
    critical_failures: result.critical_failures ?? [],
    vetoed: result.vetoed === true,
    input_bundle_hash: expectedInputBundleHash,
    complete_input_bundle_hash: completeSkillEvalInputBundleHash(
      expectedInputBundleHash,
      expectedSkillHash,
    ),
  };
}

function exactUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail(`${label} is not exact UTF-8 text`);
  return text;
}

async function main() {
  const options = parseArgs(process.argv);
  const manifestRaw = readFileSync(options.manifest);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const expectedManifestRevision = sha256(manifestRaw);
  const source = sourceBinding();
  const matrixPolicy = JSON.parse(source.files
    .find((file) => file.role === 'answer_matrix_policy').content);
  const expectedSkillHash = canonicalSkillTreeHashFromSource(manifest, source.files);
  const { tasks, rawFiles } = loadTasks(options.tasks);
  if (tasks.length === 0) fail('prepared task set is empty');
  verifyCompleteTaskMatrix(tasks, manifest, matrixPolicy);
  const benchmarkRaw = readFileSync(options.benchmark, 'utf8');
  const benchmark = JSON.parse(benchmarkRaw);
  const auditRaw = readFileSync(options.audit, 'utf8');
  const audit = JSON.parse(auditRaw);
  if (!Array.isArray(benchmark.results) || benchmark.results.length !== tasks.length) {
    fail(`benchmark has ${benchmark.results?.length ?? 0} results for ${tasks.length} tasks`);
  }
  if (!Array.isArray(audit.readiness?.blockers)) fail('run-aware audit has no readiness blockers array');
  if (audit.readiness.blockers.length > 0) fail('run-aware audit contains readiness blockers');
  if (canonicalJson(audit.benchmark?.summary) !== canonicalJson(benchmark.summary)
      || canonicalJson(audit.benchmark?.case_flags) !== canonicalJson(benchmark.case_flags)) {
    fail('run-aware audit was not produced from the supplied benchmark');
  }
  const sourceManifest = source.files.find((file) => file.role === 'manifest');
  if (sourceManifest.sha256 !== expectedManifestRevision) {
    fail('supplied manifest does not match the embedded source manifest');
  }
  const inputBundleByCase = new Map();
  const manifestCases = new Map((manifest.cases ?? []).map((evalCase) => [evalCase.id, evalCase]));
  for (const task of tasks) {
    if (!manifestCases.has(task.case_id)) fail(`prepared task has unknown case: ${task.case_id}`);
    if (!inputBundleByCase.has(task.case_id)) {
      inputBundleByCase.set(task.case_id, skillEvalInputBundleHash({
        manifestPath: sourceManifest.path,
        manifestContent: sourceManifest.content,
        caseId: task.case_id,
        sourceFiles: source.files,
      }));
    }
  }
  const resultByRun = new Map();
  for (const result of benchmark.results) {
    const key = resolve(result.run_base);
    if (resultByRun.has(key)) fail(`duplicate benchmark result: ${key}`);
    resultByRun.set(key, result);
  }
  const seenRunDirs = new Set();
  const runs = tasks.map((task) => {
    const runDir = checkedChild(options.runs, task.run_dir);
    if (seenRunDirs.has(runDir)) fail(`duplicate prepared run: ${task.run_dir}`);
    seenRunDirs.add(runDir);
    const result = resultByRun.get(resolve(runDir));
    if (!result) fail(`no benchmark result for ${task.run_dir}`);
    return runEvidence(
      task,
      result,
      options.runs,
      manifestCases.get(task.case_id),
      manifest,
      expectedManifestRevision,
      expectedSkillHash,
      inputBundleByCase.get(task.case_id),
    );
  });
  const harness = harnessBinding(options.harnessRepo);
  const models = [...new Set(tasks.map((task) => task.model ?? null))].sort();
  if (canonicalJson(models) !== canonicalJson([...matrixPolicy.models].sort())) {
    fail('prepared tasks do not match the answer-matrix policy model set');
  }
  const repeats = matrixPolicy.repeats;
  const adapters = [
    ...(models.some((model) => /^claude-/i.test(model))
      ? [{ role: 'answer', id: 'claude-subagent', path: 'evals/adapters/claude.mjs' }]
      : []),
    ...(models.some((model) => /^gpt-/i.test(model))
      ? [{ role: 'answer', id: 'codex-native', path: null }]
      : []),
  ];
  const receipt = buildReceipt({
    source,
    harness: {
      name: 'skill-eval-harness',
      repository: harness.repository,
      version: harness.version,
      git_commit: harness.gitCommit,
      mode: 'patched-local-checkout',
    },
    invocation: {
      suite: 'keyboardia-answer-matrix',
      models,
      adapters,
      splits: matrixPolicy.splits,
      repeats,
      judge: false,
      manifest_revision: expectedManifestRevision,
      skill_tree_hash: expectedSkillHash,
    },
    runs,
    summary: answerMatrixSummary(benchmark),
  });
  receipt.harness.git_tree = harness.gitTree;
  receipt.harness.parent_git_commit = harness.parentGitCommit;
  receipt.harness.parent_git_tree = harness.parentGitTree;
  receipt.harness.patch_ref = addArtifact(
    receipt.artifacts,
    exactUtf8(harness.patch, 'harness patch'),
    'text/plain',
    { sanitize: false },
  );
  receipt.harness.parent_tree_ref = addArtifact(
    receipt.artifacts,
    canonicalJson(harness.parentTreeSnapshot),
    'application/json',
    { sanitize: false },
  );
  receipt.harness.commit_ref = addArtifact(
    receipt.artifacts,
    exactUtf8(harness.commit, 'harness commit'),
    'text/plain',
    { sanitize: false },
  );
  receipt.harness.parent_commit_ref = addArtifact(
    receipt.artifacts,
    exactUtf8(harness.parentCommit, 'harness parent commit'),
    'text/plain',
    { sanitize: false },
  );
  receipt.invocation.prepared_tasks_refs = rawFiles.map(({ raw }) =>
    addArtifact(receipt.artifacts, raw, 'text/plain'));
  receipt.invocation.benchmark_ref = addArtifact(
    receipt.artifacts,
    exactUtf8(benchmarkRaw, 'benchmark report'),
    'application/json',
  );
  receipt.invocation.audit_ref = addArtifact(
    receipt.artifacts,
    exactUtf8(auditRaw, 'audit report'),
    'application/json',
  );
  writeReceipt(options.out, receipt);
  process.stdout.write(`Imported ${runs.length} immutable harness runs\n${options.out}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
