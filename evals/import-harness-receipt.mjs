#!/usr/bin/env node
/** Import a skill-eval-harness answer matrix into a durable Keyboardia receipt. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addArtifact,
  buildReceipt,
  createSourceBinding,
  sha256,
  writeReceipt,
} from './receipt.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');
const ARTIFACT_COMMIT = 'artifact-commit.json';
const REQUIRED_ARTIFACTS = ['output.md', 'events.json', 'metrics.json', 'metadata.json'];
const COPY_EXCLUDE = new Set(['evals', '.git']);

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
    else if (flag === '--harness-repo') options.harnessRepo = resolve(value);
    else if (flag === '--out') options.out = resolve(value);
    else fail(`unknown argument: ${flag}`);
    index += 1;
  }
  for (const name of ['manifest', 'runs', 'benchmark', 'harnessRepo', 'out']) {
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

function walkSkill(root, prefix, entries) {
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (dirent.name.startsWith('.') || COPY_EXCLUDE.has(dirent.name)) continue;
    const absolute = resolve(root, dirent.name);
    const rel = `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) walkSkill(absolute, rel, entries);
    else if (dirent.isSymbolicLink()) {
      const target = realpathSync(absolute);
      const rootReal = realpathSync(root);
      const targetRel = relative(rootReal, target);
      if (targetRel === '..' || targetRel.startsWith(`..${sep}`) || isAbsolute(targetRel)) {
        fail(`skill symlink escapes its root: ${absolute}`);
      }
      if (lstatSync(target).isDirectory()) walkSkill(target, rel, entries);
      else entries.push([rel, readFileSync(target)]);
    } else if (dirent.isFile()) entries.push([rel, readFileSync(absolute)]);
  }
}

export function canonicalSkillTreeHash(root, manifest) {
  const entries = [];
  for (const skillPath of manifest.skill_paths ?? []) {
    const source = resolve(root, skillPath);
    const stat = lstatSync(source);
    const sourceDir = stat.isDirectory() ? source : dirname(source);
    const key = skillPath.replace(/[^A-Za-z0-9_.-]/g, '_');
    walkSkill(sourceDir, key, entries);
  }
  const digest = createHash('sha256');
  for (const [path, bytes] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(path, 'utf8');
    digest.update(Buffer.from([0]));
    digest.update(bytes);
  }
  return digest.digest('hex');
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
  if (git(harnessRepo, ['status', '--porcelain', '--untracked-files=no'])) {
    fail('skill-eval-harness has uncommitted tracked changes');
  }
  const gitCommit = git(harnessRepo, ['rev-parse', 'HEAD']);
  const parent = git(harnessRepo, ['rev-parse', 'HEAD^']);
  const gitTree = git(harnessRepo, ['show', '-s', '--format=%T', gitCommit]);
  const repository = git(harnessRepo, ['config', '--get', 'remote.origin.url'], { optional: true }) ?? 'local';
  const pyproject = readFileSync(resolve(harnessRepo, 'pyproject.toml'), 'utf8');
  const version = pyproject.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!version) fail('cannot determine skill-eval-harness version');
  const patch = git(harnessRepo, ['diff', '--binary', parent, gitCommit], { bytes: true });
  return { gitCommit, parent, gitTree, repository, version, patch };
}

function sourceBinding() {
  return createSourceBinding(repoRoot, [
    { role: 'skill', path: 'app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md' },
    { role: 'manifest', path: 'evals/shared-benchmark.json' },
    { role: 'fixture', path: 'evals/fixtures/keyboardia-mcp-schema.json' },
    { role: 'oracle', path: 'evals/oracles/capability-answer.mjs' },
    { role: 'answer_adapter', path: 'evals/adapters/claude.mjs' },
    { role: 'runner', path: 'evals/import-harness-receipt.mjs' },
    { role: 'receipt_runtime', path: 'evals/receipt.mjs' },
    { role: 'receipt_schema', path: 'evals/receipt.schema.json' },
  ]);
}

function runEvidence(task, result, runsRoot, expectedManifestRevision, expectedSkillHash) {
  if (task.manifest_revision !== expectedManifestRevision) {
    fail(`${task.run_dir} was prepared from a different manifest revision`);
  }
  if (task.skill_tree_hash !== expectedSkillHash) {
    fail(`${task.run_dir} was prepared from a different skill tree`);
  }
  const runDir = checkedChild(runsRoot, task.run_dir);
  if (resolve(result.run_base) !== resolve(runDir)) fail(`${task.run_dir} does not match its benchmark result`);
  for (const [taskKey, resultKey] of [
    ['case_id', 'case_id'], ['variant', 'variant'], ['run_number', 'run_number'], ['model', 'model'],
  ]) {
    if (task[taskKey] !== result[resultKey]) fail(`${task.run_dir} has mismatched ${taskKey}`);
  }
  if (result.missing_output || result.execution_valid !== true) fail(`${task.run_dir} is not a complete scorable run`);
  const { commit, inventory } = verifyArtifactSet(runDir);
  const metadata = json(resolve(runDir, 'metadata.json'));
  if (metadata.manifest_revision !== expectedManifestRevision || metadata.skill_tree_hash !== expectedSkillHash) {
    fail(`${task.run_dir} metadata is not bound to the prepared inputs`);
  }
  const traceFiles = {};
  for (const name of Object.keys(inventory).sort()) {
    if (!['prompt.md', 'output.md'].includes(name)) {
      traceFiles[name] = readFileSync(resolve(runDir, name), 'utf8');
    }
  }
  traceFiles[ARTIFACT_COMMIT] = JSON.stringify(commit);
  return {
    model: task.model ?? null,
    case: task.case_id,
    kind: task.kind,
    split: task.split,
    variant: task.variant,
    repeat: task.run_number,
    ok: true,
    prompt: readFileSync(resolve(runDir, 'prompt.md'), 'utf8'),
    response: readFileSync(resolve(runDir, 'output.md'), 'utf8'),
    trace: { artifact_files: traceFiles },
    assertions: result.assertions ?? [],
    usage: metadata.usage_normalized ?? null,
    objective_passed: result.objective_passed,
    objective_total: result.objective_total,
    objective_pass_rate: result.objective_pass_rate,
    critical_failures: result.critical_failures ?? [],
    vetoed: result.vetoed === true,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const manifestRaw = readFileSync(options.manifest);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const expectedManifestRevision = sha256(manifestRaw);
  const expectedSkillHash = canonicalSkillTreeHash(repoRoot, manifest);
  const { tasks, rawFiles } = loadTasks(options.tasks);
  if (tasks.length === 0) fail('prepared task set is empty');
  const benchmarkRaw = readFileSync(options.benchmark, 'utf8');
  const benchmark = JSON.parse(benchmarkRaw);
  if (!Array.isArray(benchmark.results) || benchmark.results.length !== tasks.length) {
    fail(`benchmark has ${benchmark.results?.length ?? 0} results for ${tasks.length} tasks`);
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
    return runEvidence(task, result, options.runs, expectedManifestRevision, expectedSkillHash);
  });
  const harness = harnessBinding(options.harnessRepo);
  const source = sourceBinding();
  const models = [...new Set(tasks.map((task) => task.model ?? null))].sort();
  const repeats = Math.max(...tasks.map((task) => Number(task.run_number)));
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
      adapters: [
        { role: 'answer', id: 'claude-subagent', path: 'evals/adapters/claude.mjs' },
        { role: 'answer', id: 'codex-native', path: null },
      ],
      splits: [...new Set(tasks.map((task) => task.split))].sort(),
      repeats,
      judge: false,
      manifest_revision: expectedManifestRevision,
      skill_tree_hash: expectedSkillHash,
    },
    runs,
    summary: {
      results: benchmark.results.length,
      summary: benchmark.summary,
      paired_summary: benchmark.paired_summary,
      by_model: benchmark.by_model,
      case_flags: benchmark.case_flags,
      reliability: benchmark.reliability,
    },
  });
  receipt.harness.git_tree = harness.gitTree;
  receipt.harness.parent_git_commit = harness.parent;
  receipt.harness.patch_ref = addArtifact(receipt.artifacts, harness.patch, 'text/plain');
  receipt.invocation.prepared_tasks_refs = rawFiles.map(({ raw }) =>
    addArtifact(receipt.artifacts, raw, 'text/plain'));
  receipt.invocation.benchmark_ref = addArtifact(receipt.artifacts, benchmarkRaw, 'application/json');
  writeReceipt(options.out, receipt);
  process.stdout.write(`Imported ${runs.length} immutable harness runs\n${options.out}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
