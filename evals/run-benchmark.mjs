#!/usr/bin/env node
/**
 * Executes evals/shared-benchmark.json against any agent.
 *
 * No provider is built in. The runner speaks one adapter contract and shells
 * out to whatever implements it, so a Keyboardia eval can be run with Claude,
 * Codex, Vibe, a hosted API, or an in-house harness without editing this file.
 * The contract is deliberately identical to skill-eval-harness's
 * `run-subagent --agent-cmd`, so a single adapter script drives both runners:
 *
 *   stdin   {"prompt": string, "model": string|null, "workspace": string}
 *   stdout  {"answer": string}        (bare text is accepted as a fallback)
 *
 * `--agent <name>` is sugar for the bundled adapters in evals/adapters/, which
 * are themselves ordinary adapter programs with no privileged access.
 *
 * What it measures:
 *   - answer cases run twice per model, once with the published SKILL.md in
 *     context and once without. Both arms receive the committed MCP schema
 *     fixture, so the baseline is never handicapped by a hidden tool contract.
 *   - trigger cases run once per model against a skill catalog. This measures
 *     description-driven selection, not autonomous loading; for real
 *     activation rates use `skill-trigger-matrix`, which mounts the skill where
 *     an agent discovers it on its own.
 *
 * Usage:
 *   node evals/run-benchmark.mjs --agent claude --repeats 3
 *   node evals/run-benchmark.mjs --agent-cmd './my-adapter.sh' --models gpt-5.4
 *   node evals/run-benchmark.mjs --rescore results.json --out regraded.json
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFirstJsonObject } from './oracles/public-changelog-safe.mjs';
import {
  buildReceipt,
  createSourceBinding,
  redactCapability,
  writeReceipt,
} from './receipt.mjs';
import { scoreExecution } from './score-execution.mjs';
import { createSession, isReachable, readCompactSession } from './session-harness.mjs';

export { redactCapability } from './receipt.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');

const ANSWER_PREAMBLE = [
  'You are an AI assistant connected to a Model Context Protocol (MCP) client.',
  'You cannot execute tool calls in this environment.',
  'Answer the request directly, and show exact JSON arguments wherever the request asks for them.',
].join(' ');

const TRIGGER_PREAMBLE = [
  'You are an AI assistant that loads skills on demand.',
  'You are given a catalog of available skills and one user message.',
  'Decide which skills, if any, you would load before answering.',
  'Reply with a JSON array of skill names and nothing else. Reply with [] when no skill applies.',
].join(' ');

const EXECUTION_PREAMBLE = [
  'You have live Keyboardia MCP tools connected. Actually perform the work with them.',
  'Do not describe what you would do: make the calls.',
].join(' ');

const JUDGE_PREAMBLE = [
  'You are grading one answer against a rubric. You did not write the answer.',
  'Reply with JSON only, no prose around it:',
  '{"passed": boolean, "score": 1-5, "dimension_scores": {"<name>": 1-5}, "rationale": "one sentence"}',
  'Score each named dimension against its anchors. Omit dimension_scores when no dimensions are given.',
].join(' ');

/**
 * Distractors keep the trigger catalog from being a one-option question. They
 * are plausible neighbours: audio, Keyboardia product work, and generic tooling.
 */
const TRIGGER_DISTRACTORS = [
  {
    name: 'web-audio-scheduling',
    description:
      'Explain and debug Web Audio API scheduling, AudioContext clocks, lookahead timers, and sample-accurate playback in browsers.',
  },
  {
    name: 'release-notes-writer',
    description:
      'Draft product release notes, changelog entries, and launch announcements from a described feature or a list of changes.',
  },
  {
    name: 'music-theory-reference',
    description:
      'Answer questions about scales, modes, chord construction, time signatures, and rhythmic notation.',
  },
  {
    name: 'sql-query-builder',
    description:
      'Write, review, and optimize SQL queries and schema migrations for relational databases.',
  },
  {
    name: 'github-pr-review',
    description:
      'Review a GitHub pull request diff and report correctness, style, and test-coverage issues.',
  },
];

const DEFAULT_JUDGE_THRESHOLD = 4;

function parseArgs(argv) {
  const options = {
    models: [null],
    repeats: 1,
    concurrency: 6,
    out: resolve(evalsDir, 'results', 'run.json'),
    cases: null,
    splits: ['tune'],
    timeoutMs: 300_000,
    rescore: null,
    manifest: resolve(evalsDir, 'shared-benchmark.json'),
    receipt: null,
    mcpBaseUrl: process.env.KEYBOARDIA_BASE_URL ?? 'http://localhost:8787',
    agentCmd: null,
    agentAdapter: null,
    judgeCmd: null,
    judgeAdapter: null,
    judgeCmdOverridden: false,
    judgeModel: null,
    judge: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--agent':
        options.agentAdapter = bundledAdapter(value);
        options.agentCmd = options.agentAdapter.command;
        index += 1;
        break;
      case '--agent-cmd':
        options.agentCmd = value;
        options.agentAdapter = { id: 'custom-command', path: null, command: value };
        index += 1;
        break;
      case '--judge-agent':
        options.judgeAdapter = bundledAdapter(value);
        options.judgeCmd = options.judgeAdapter.command;
        options.judgeCmdOverridden = true;
        index += 1;
        break;
      case '--judge-cmd':
        options.judgeCmd = value;
        options.judgeAdapter = { id: 'custom-command', path: null, command: value };
        options.judgeCmdOverridden = true;
        index += 1;
        break;
      case '--judge-model':
        options.judgeModel = value;
        index += 1;
        break;
      case '--no-judge':
        options.judge = false;
        break;
      case '--models':
        options.models = value.split(',').map((model) => model.trim()).filter(Boolean);
        index += 1;
        break;
      case '--repeats':
        options.repeats = Number(value);
        index += 1;
        break;
      case '--concurrency':
        options.concurrency = Number(value);
        index += 1;
        break;
      case '--split':
        options.splits = value === 'all'
          ? ['tune', 'holdout', 'holdback']
          : value.split(',').map((split) => split.trim()).filter(Boolean);
        index += 1;
        break;
      case '--out':
        options.out = resolve(process.cwd(), value);
        index += 1;
        break;
      case '--cases':
        options.cases = new Set(value.split(',').map((id) => id.trim()).filter(Boolean));
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(value);
        index += 1;
        break;
      case '--rescore':
        options.rescore = resolve(process.cwd(), value);
        index += 1;
        break;
      case '--manifest':
        options.manifest = resolve(process.cwd(), value);
        index += 1;
        break;
      case '--receipt':
        options.receipt = resolve(process.cwd(), value);
        index += 1;
        break;
      case '--mcp-base-url':
        options.mcpBaseUrl = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!options.rescore && !options.agentCmd) {
    throw new Error(
      'Choose an agent: --agent <name> for a bundled adapter in evals/adapters/, ' +
      'or --agent-cmd "<command>" for your own. See evals/README.md for the contract.'
    );
  }
  options.judgeCmd ??= options.agentCmd;
  options.judgeAdapter ??= options.agentAdapter;
  if (options.receipt && options.rescore) {
    throw new Error('--receipt requires fresh calls and cannot be combined with --rescore');
  }
  if (options.receipt && !options.agentAdapter?.path) {
    throw new Error('--receipt requires a bundled --agent so its adapter bytes can be bound');
  }
  if (options.receipt && options.judge && !options.judgeAdapter?.path) {
    throw new Error('--receipt requires a bundled --judge-agent so its adapter bytes can be bound');
  }
  return options;
}

function bundledAdapter(name) {
  if (!/^[a-z0-9-]+$/.test(name ?? '')) {
    throw new Error(`Invalid adapter name: ${name}`);
  }
  const path = resolve(evalsDir, 'adapters', `${name}.mjs`);
  return { id: name, path, command: `node ${JSON.stringify(path)}` };
}

function repoRelativePath(path) {
  return relative(repoRoot, resolve(path)).split(sep).join('/');
}

function snapshotRunInputs(manifest, options, manifestBytes) {
  const snapshots = new Map();
  const boundInputs = [];
  const seenBindings = new Set();
  const capture = (role, path, suppliedBytes = null) => {
    const absolute = resolve(path);
    const bytes = suppliedBytes ?? readFileSync(absolute);
    const existing = snapshots.get(absolute);
    if (existing && !existing.bytes.equals(bytes)) {
      throw new Error(`input changed while it was being snapshotted: ${absolute}`);
    }
    snapshots.set(absolute, { bytes, text: bytes.toString('utf8') });
    const bindingKey = `${role}:${absolute}`;
    if (!seenBindings.has(bindingKey)) {
      boundInputs.push({ role, path: repoRelativePath(absolute), bytes });
      seenBindings.add(bindingKey);
    }
  };
  const capturedModules = new Set();
  const captureModule = (role, path) => {
    const absolute = resolve(path);
    capture(role, absolute);
    if (capturedModules.has(absolute)) return;
    capturedModules.add(absolute);
    const source = snapshots.get(absolute).text;
    for (const match of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const imported = resolve(dirname(absolute), match[1]);
      const candidates = [imported, `${imported}.mjs`, `${imported}.js`];
      const dependency = candidates.find((candidate) => existsSync(candidate));
      if (dependency) captureModule(`${role}_dependency`, dependency);
    }
  };

  capture('manifest', options.manifest, manifestBytes);
  captureModule('runner', fileURLToPath(import.meta.url));
  captureModule('receipt_runtime', resolve(evalsDir, 'receipt.mjs'));
  capture('receipt_schema', resolve(evalsDir, 'receipt.schema.json'));
  for (const skillPath of manifest.skill_paths) {
    capture('skill', resolve(repoRoot, skillPath));
  }
  for (const testCase of manifest.cases) {
    for (const file of testCase.files ?? []) {
      capture('fixture', resolve(evalsDir, file));
    }
    if (testCase.prompt_ref) {
      const promptPath = resolve(evalsDir, testCase.prompt_ref);
      if (existsSync(promptPath)) capture('private_prompt', promptPath);
    }
    for (const assertion of testCase.assertions ?? []) {
      if (assertion.type !== 'script') continue;
      for (const part of assertion.command ?? []) {
        if (typeof part !== 'string' || !/\.(?:[cm]?js|json)$/.test(part)) continue;
        const oraclePath = resolve(evalsDir, part);
        if (existsSync(oraclePath)) captureModule('oracle', oraclePath);
      }
    }
  }
  if (options.agentAdapter?.path) captureModule('answer_adapter', options.agentAdapter.path);
  if (options.judge && options.judgeAdapter?.path) {
    captureModule('judge_adapter', options.judgeAdapter.path);
  }
  return { snapshots, boundInputs };
}

function snapshottedText(snapshots, path) {
  const snapshot = snapshots.get(resolve(path));
  if (!snapshot) throw new Error(`input was not snapshotted: ${path}`);
  return snapshot.text;
}

function assertBoundInputsUnchanged(boundInputs) {
  for (const input of boundInputs) {
    const current = readFileSync(resolve(repoRoot, input.path));
    if (!current.equals(input.bytes)) {
      throw new Error(`bound input changed during the eval run: ${input.path}`);
    }
  }
}

/**
 * The manifest uses leading inline flags, which JavaScript regular expressions
 * do not accept. Translate them into real flags instead of silently failing.
 */
export function compilePattern(pattern) {
  const inline = pattern.match(/^\(\?([imsx]+)\)/);
  if (!inline) {
    return new RegExp(pattern);
  }
  const flags = inline[1]
    .split('')
    .filter((flag) => 'ims'.includes(flag))
    .join('');
  return new RegExp(pattern.slice(inline[0].length), flags);
}

/** Objective assertions default to gating; judged ones only move the graded score. */
export function assertionSeverity(assertion) {
  if (assertion.severity) {
    return assertion.severity;
  }
  return isJudgeAssertion(assertion) ? 'soft' : 'gate';
}

export function isJudgeAssertion(assertion) {
  return assertion.type === 'judge' || assertion.type === 'rubric';
}

function schemaErrors(value, schema, path = '$') {
  const errors = [];
  const expected = schema.type;
  const matchesType = expected === undefined
    || (expected === 'object' && value && typeof value === 'object' && !Array.isArray(value))
    || (expected === 'array' && Array.isArray(value))
    || (expected === 'string' && typeof value === 'string')
    || (expected === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (expected === 'integer' && Number.isInteger(value))
    || (expected === 'boolean' && typeof value === 'boolean')
    || (expected === 'null' && value === null);
  if (!matchesType) return [`${path}: expected ${expected}`];
  if (expected === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}: unexpected ${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) errors.push(...schemaErrors(value[key], childSchema, `${path}.${key}`));
    }
  }
  if (expected === 'array' && schema.items) {
    value.forEach((entry, index) => errors.push(...schemaErrors(entry, schema.items, `${path}[${index}]`)));
  }
  return errors;
}

function runScriptAssertion(assertion, response) {
  const directory = mkdtempSync(resolve(tmpdir(), 'keyboardia-oracle-'));
  const outputPath = resolve(directory, 'output.md');
  try {
    writeFileSync(outputPath, response);
    const command = assertion.command.map((part) => String(part)
      .replaceAll('{output_dir}', directory)
      .replaceAll('{output_path}', outputPath));
    const result = spawnSync(command[0], command.slice(1), {
      cwd: evalsDir,
      encoding: 'utf8',
      timeout: (assertion.timeout_s ?? 30) * 1000,
    });
    return result.status === (assertion.pass_exit_code ?? 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function scoreObjectiveAssertions(assertions, response) {
  return assertions.filter((assertion) => !isJudgeAssertion(assertion)).map((assertion) => {
    let passed;
    if (assertion.type === 'regex' || assertion.type === 'not_regex') {
      const matched = compilePattern(assertion.pattern).test(response);
      passed = assertion.type === 'not_regex' ? !matched : matched;
    } else if (assertion.type === 'structured_output') {
      try {
        passed = schemaErrors(extractFirstJsonObject(response), assertion.schema).length === 0;
      } catch {
        passed = false;
      }
    } else if (assertion.type === 'script') {
      passed = runScriptAssertion(assertion, response);
    } else {
      throw new Error(`Unsupported objective assertion type: ${assertion.type}`);
    }
    return {
      name: assertion.name,
      type: assertion.type,
      severity: assertionSeverity(assertion),
      passed,
    };
  });
}

/**
 * A run's pass rate is the share of gating assertions it satisfied; a failed
 * critical assertion vetoes the run outright. Soft results stay in the graded
 * channel so a judge cannot quietly move a pass rate.
 */
export function summarizeRun(assertions) {
  const gates = assertions.filter((entry) => entry.severity === 'gate');
  const criticals = assertions.filter((entry) => entry.severity === 'critical');
  const vetoed = criticals.some((entry) => !entry.passed);
  const graded = assertions.filter((entry) => typeof entry.score === 'number');
  return {
    passRate: vetoed ? 0 : (gates.length === 0 ? null : gates.filter((entry) => entry.passed).length / gates.length),
    passed: !vetoed && gates.every((entry) => entry.passed) && criticals.every((entry) => entry.passed),
    gradedScore: graded.length === 0
      ? null
      : graded.reduce((total, entry) => total + entry.score, 0) / graded.length,
  };
}

/**
 * Runs one execution case: build a disposable session from the case's setup,
 * hand the agent live MCP tools, then score the session it left behind and the
 * calls it made. Nothing in this path reads the model's prose.
 */
async function runExecutionCase({ testCase, casePrompt, model, options, capabilities }) {
  const baseUrl = options.mcpBaseUrl;
  let sessionId;
  let baseline;
  try {
    sessionId = await createSession(baseUrl, testCase.setup);
    capabilities.add(sessionId);
    baseline = await readCompactSession(baseUrl, sessionId);
  } catch (error) {
    // A harness-side failure is a non-scorable run, not a model result, and
    // certainly not a reason to discard the rest of the sweep.
    const message = `setup: ${error.message}`;
    return {
      ok: false,
      scorable: false,
      error: sessionId ? redactCapability(message, sessionId) : message,
    };
  }

  const prompt = casePrompt.replaceAll('{{session_id}}', sessionId);
  const result = await runAdapter({
    command: options.agentCmd,
    prompt,
    model,
    timeoutMs: options.timeoutMs,
  });
  if (!result.ok) {
    // An adapter may have completed edits before its process or output failed.
    // Retrying against this session would score two attempts as one run.
    return {
      ok: false,
      scorable: false,
      prompt: redactCapability(prompt, sessionId),
      error: redactCapability(result.error, sessionId),
    };
  }

  let final;
  try {
    final = await readCompactSession(baseUrl, sessionId);
  } catch (error) {
    return redactCapability({
      ok: false,
      scorable: false,
      prompt,
      response: result.text,
      trace: result.trace,
      usage: result.usage,
      error: `final read: ${error.message}`,
    }, sessionId);
  }
  const assertions = scoreExecution(testCase.assertions ?? [], {
    baseline,
    final,
    trace: result.trace,
  });
  const recorded = redactCapability({
    prompt,
    response: result.text,
    usage: result.usage,
    execution: { baseline, final, trace: result.trace ?? [] },
  }, sessionId);
  return {
    ok: true,
    scorable: true,
    ...summarizeRun(assertions),
    assertions,
    prompt: recorded.prompt,
    response: recorded.response,
    usage: recorded.usage,
    // Enough to re-score with no Worker or agent, without persisting the live
    // edit capability that identified the disposable session.
    execution: recorded.execution,
  };
}

function runAdapter({ command, prompt, model, timeoutMs }) {
  const workspace = mkdtempSync(resolve(tmpdir(), 'keyboardia-eval-'));
  return new Promise((resolvePromise) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, {
      shell: true,
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // The process may have exited between the timer and the signal.
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, text: '', error: String(error.message ?? error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        finish({ ok: false, text: '', error: `adapter timed out after ${timeoutMs}ms` });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, text: '', error: stderr.trim() || `adapter exited ${code}` });
        return;
      }
      const { answer, trace, usage } = extractAnswer(stdout);
      finish({ ok: true, text: answer, trace, usage });
    });

    child.stdin.end(JSON.stringify({ prompt, model: model ?? null, workspace }));
  });
}

/** Adapters may emit the documented JSON envelope or, as a fallback, bare text. */
function extractAnswer(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.answer === 'string') {
        return { answer: parsed.answer, trace: parsed.trace, usage: parsed.usage };
      }
    } catch {
      // fall through to bare text
    }
  }
  return { answer: trimmed, trace: undefined, usage: undefined };
}

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function readCasePrompt(testCase, snapshots) {
  if (typeof testCase.prompt === 'string') {
    return testCase.prompt;
  }
  if (testCase.prompt_ref) {
    // Hidden splits keep their prompts out of the repository on purpose.
    const path = resolve(evalsDir, testCase.prompt_ref);
    if (!snapshots.has(path)) return null;
    try {
      const stored = JSON.parse(snapshottedText(snapshots, path));
      if (typeof stored.prompt !== 'string') {
        throw new Error(`${testCase.prompt_ref} has no "prompt" string`);
      }
      return stored.prompt;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  throw new Error(`Case ${testCase.id} has neither prompt nor prompt_ref`);
}

function buildAnswerPrompt(testCase, manifest, variant, casePrompt, snapshots) {
  const blocks = [ANSWER_PREAMBLE];
  if (variant === 'with_skill') {
    for (const skillPath of manifest.skill_paths) {
      blocks.push(
        `<available-skill name="${manifest.skill_name}">\n` +
        snapshottedText(snapshots, resolve(repoRoot, skillPath)).trimEnd() +
        '\n</available-skill>'
      );
    }
  }
  for (const file of testCase.files ?? []) {
    blocks.push(
      `<attached-file name="${file}">\n` +
      snapshottedText(snapshots, resolve(evalsDir, file)).trimEnd() +
      '\n</attached-file>'
    );
  }
  blocks.push(casePrompt);
  return blocks.join('\n\n');
}

function buildTriggerPrompt(manifest, skillDescription, casePrompt) {
  const catalog = [
    { name: manifest.skill_name, description: skillDescription },
    ...TRIGGER_DISTRACTORS,
  ]
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join('\n');
  return [
    TRIGGER_PREAMBLE,
    '',
    '<available-skills>',
    catalog,
    '</available-skills>',
    '',
    '<user-message>',
    casePrompt,
    '</user-message>',
  ].join('\n');
}

function buildJudgePrompt(assertion, casePrompt, answer) {
  const blocks = [JUDGE_PREAMBLE, '', '<task-given-to-the-assistant>', casePrompt, '</task-given-to-the-assistant>'];
  if (assertion.prompt) {
    blocks.push('', '<question>', assertion.prompt, '</question>');
  }
  if (assertion.rubric) {
    blocks.push('', '<rubric>', assertion.rubric.map((line) => `- ${line}`).join('\n'), '</rubric>');
  }
  if (assertion.graded_dimensions) {
    blocks.push(
      '',
      '<graded-dimensions>',
      assertion.graded_dimensions
        .map((dimension) => `- ${dimension.name} (${dimension.scale}): ${dimension.rubric}`)
        .join('\n'),
      '</graded-dimensions>'
    );
  }
  blocks.push('', '<answer-under-review>', answer, '</answer-under-review>');
  return blocks.join('\n');
}

function parseJudgeVerdict(text, assertion) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  let verdict;
  try {
    verdict = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const threshold = assertion.threshold ?? DEFAULT_JUDGE_THRESHOLD;
  const score = typeof verdict.score === 'number' ? verdict.score : null;
  const passed = typeof verdict.passed === 'boolean'
    ? verdict.passed
    : (score === null ? null : score >= threshold);
  return {
    passed,
    score,
    dimension_scores: verdict.dimension_scores ?? null,
    rationale: typeof verdict.rationale === 'string' ? verdict.rationale : null,
  };
}

function readSkillDescription(manifest, snapshots) {
  const skill = snapshottedText(snapshots, resolve(repoRoot, manifest.skill_paths[0]));
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    throw new Error('SKILL.md is missing YAML frontmatter');
  }
  const line = frontmatter[1].split('\n').find((entry) => entry.startsWith('description:'));
  if (!line) {
    throw new Error('SKILL.md frontmatter is missing a description');
  }
  return line.slice('description:'.length).trim();
}

function scoreTrigger(testCase, response, skillName) {
  const match = response.match(/\[[\s\S]*?\]/);
  let selected = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        selected = parsed.map(String);
      }
    } catch {
      selected = [];
    }
  }
  const loaded = selected.includes(skillName);
  const shouldLoad = testCase.trigger_type !== 'negative';
  return { selected, loaded, shouldLoad, passed: loaded === shouldLoad };
}

async function judgeRun({ testCase, casePrompt, answer, model, options }) {
  const judged = [];
  for (const assertion of testCase.assertions ?? []) {
    if (!isJudgeAssertion(assertion)) {
      continue;
    }
    const severity = assertionSeverity(assertion);
    if (!options.judge) {
      // A skipped security/process gate is unknown, never a silent pass.
      judged.push({ name: assertion.name, type: assertion.type, severity, skipped: true, passed: null });
      continue;
    }
    const judgePrompt = buildJudgePrompt(assertion, casePrompt, answer);
    const judgeModel = resolveJudgeModel(options.judgeModel, model, options.judgeCmdOverridden);
    const result = await runAdapter({
      command: options.judgeCmd,
      prompt: judgePrompt,
      model: judgeModel,
      timeoutMs: options.timeoutMs,
    });
    const verdict = result.ok ? parseJudgeVerdict(result.text, assertion) : null;
    judged.push({
      name: assertion.name,
      type: assertion.type,
      severity,
      passed: verdict?.passed ?? null,
      score: verdict?.score ?? undefined,
      dimension_scores: verdict?.dimension_scores ?? undefined,
      rationale: verdict?.rationale ?? undefined,
      error: result.ok ? (verdict ? undefined : 'unparseable judge verdict') : result.error,
      judge: {
        model: judgeModel,
        adapter: options.judgeAdapter.id,
        prompt: judgePrompt,
        response: result.text,
        usage: result.usage,
      },
    });
  }
  return judged;
}

export function resolveJudgeModel(configuredModel, evaluatedModel, judgeCmdOverridden = false) {
  return configuredModel ?? (judgeCmdOverridden ? null : evaluatedModel);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestBytes = readFileSync(options.manifest);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { snapshots, boundInputs } = snapshotRunInputs(manifest, options, manifestBytes);
  const skillDescription = readSkillDescription(manifest, snapshots);
  const capabilities = new Set();
  let receiptContext = null;

  if (options.receipt) {
    // Bind every byte before the first model call. A receipt from a dirty bound
    // input would name a Git commit that cannot reproduce what the model saw.
    const source = createSourceBinding(repoRoot, boundInputs);
    receiptContext = {
      source,
      harness: {
        name: 'keyboardia-repo-runner',
        repository: source.repository,
        version: '1',
        git_commit: source.git_commit,
        mode: 'repo-owned',
      },
      invocation: {
        suite: basename(options.manifest, '.json'),
        models: options.models,
        adapters: [
          {
            role: 'answer',
            id: options.agentAdapter.id,
            path: repoRelativePath(options.agentAdapter.path),
          },
          ...(options.judge ? [{
            role: 'judge',
            id: options.judgeAdapter.id,
            path: repoRelativePath(options.judgeAdapter.path),
          }] : []),
        ],
        splits: options.splits,
        repeats: options.repeats,
        judge: options.judge,
        judge_model: options.judgeModel,
        timeout_ms: options.timeoutMs,
      },
      capabilities,
      boundInputs,
    };
  }

  if (options.rescore) {
    rescore(options, manifest);
    return;
  }

  const selected = manifest.cases.filter((testCase) => {
    if (options.cases && !options.cases.has(testCase.id)) {
      return false;
    }
    return options.splits.includes(testCase.split ?? 'tune');
  });

  const prompts = new Map();
  const unavailable = [];
  for (const testCase of selected) {
    const prompt = readCasePrompt(testCase, snapshots);
    if (prompt === null) {
      unavailable.push(testCase.id);
      continue;
    }
    prompts.set(testCase.id, prompt);
  }
  if (unavailable.length > 0) {
    process.stderr.write(
      `Skipping ${unavailable.length} case(s) whose private prompt_ref is not present: ` +
      `${unavailable.join(', ')}\n`
    );
  }
  const runnable = selected.filter((testCase) => prompts.has(testCase.id));

  if (runnable.some((testCase) => testCase.kind === 'execution')) {
    if (!await isReachable(options.mcpBaseUrl)) {
      throw new Error(
        `Execution cases need a running Keyboardia at ${options.mcpBaseUrl}. ` +
        'Start one with `cd app && npx wrangler dev --port 8787 --local`, ' +
        'or point elsewhere with --mcp-base-url.'
      );
    }
  }

  const jobs = [];
  for (const model of options.models) {
    for (const testCase of runnable) {
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        if (testCase.kind === 'trigger') {
          jobs.push({ model, testCase, repeat, variant: 'catalog' });
          continue;
        }
        for (const variant of manifest.variants) {
          jobs.push({ model, testCase, repeat, variant });
        }
      }
    }
  }

  process.stderr.write(
    `Running ${jobs.length} agent calls ` +
    `(${runnable.length} cases x ${options.models.length} model(s) x ${options.repeats} repeats)\n`
  );

  let done = 0;
  const runs = await withConcurrency(jobs, options.concurrency, async (job) => {
    const isTrigger = job.testCase.kind === 'trigger';
    const casePrompt = prompts.get(job.testCase.id);
    const base = {
      model: job.model,
      case: job.testCase.id,
      kind: job.testCase.kind,
      split: job.testCase.split ?? 'tune',
      variant: job.variant,
      repeat: job.repeat,
    };

    if (job.testCase.kind === 'execution') {
      const skillBlock = job.variant === 'with_skill'
        ? manifest.skill_paths
          .map((path) => `<available-skill name="${manifest.skill_name}">\n` +
            snapshottedText(snapshots, resolve(repoRoot, path)).trimEnd() + '\n</available-skill>')
          .join('\n\n') + '\n\n'
        : '';
      const outcome = await runExecutionCase({
        testCase: job.testCase,
        casePrompt: skillBlock + EXECUTION_PREAMBLE + '\n\n' + casePrompt,
        model: job.model,
        options,
        capabilities,
      });
      done += 1;
      process.stderr.write(
        `  [${done}/${jobs.length}] ${job.model ?? 'default'} ${job.testCase.id} ${job.variant}\n`
      );
      return { ...base, ...outcome };
    }
    const prompt = isTrigger
      ? buildTriggerPrompt(manifest, skillDescription, casePrompt)
      : buildAnswerPrompt(job.testCase, manifest, job.variant, casePrompt, snapshots);

    let result = await runAdapter({
      command: options.agentCmd,
      prompt,
      model: job.model,
      timeoutMs: options.timeoutMs,
    });
    const attempts = [{ ...result, prompt }];
    if (!result.ok) {
      result = await runAdapter({
        command: options.agentCmd,
        prompt,
        model: job.model,
        timeoutMs: options.timeoutMs,
      });
      attempts.push({ ...result, prompt });
    }

    done += 1;
    process.stderr.write(
      `  [${done}/${jobs.length}] ${job.model ?? 'default'} ${job.testCase.id} ${job.variant}\n`
    );

    if (!result.ok) {
      return { ...base, ok: false, scorable: false, prompt, attempts, error: result.error };
    }

    if (isTrigger) {
      const trigger = scoreTrigger(job.testCase, result.text, manifest.skill_name);
      return {
        ...base,
        ok: true,
        passed: trigger.passed,
        trigger,
        prompt,
        response: result.text,
        trace: result.trace,
        usage: result.usage,
        attempts,
      };
    }

    const objective = scoreObjectiveAssertions(job.testCase.assertions ?? [], result.text);
    const judged = await judgeRun({
      testCase: job.testCase,
      casePrompt,
      answer: result.text,
      model: job.model,
      options,
    });
    const assertions = [...objective, ...judged];
    return {
      ...base,
      ok: true,
      ...summarizeRun(assertions),
      assertions,
      prompt,
      response: result.text,
      trace: result.trace,
      usage: result.usage,
      attempts,
    };
  });

  emit(runs, options, manifest, receiptContext);
}

function rescore(options, manifest) {
  const previous = JSON.parse(readFileSync(options.rescore, 'utf8'));
  const byId = new Map(manifest.cases.map((testCase) => [testCase.id, testCase]));
  const runs = previous.runs.map((run) => {
    if (!run.ok || run.kind === 'trigger' || !byId.has(run.case)) {
      return run;
    }
    if (run.kind === 'execution') {
      // Recorded baseline, final state, and trace are everything the scorer
      // needs, so an assertion edit is re-measured on identical evidence.
      const assertions = scoreExecution(byId.get(run.case).assertions ?? [], run.execution);
      return { ...run, ...summarizeRun(assertions), assertions };
    }
    // Judged verdicts are kept: re-running them would change the sample, which
    // is the opposite of what re-scoring is for.
    const judged = (run.assertions ?? []).filter((entry) => entry.score !== undefined || entry.type === 'judge');
    const objective = scoreObjectiveAssertions(byId.get(run.case).assertions ?? [], run.response);
    const assertions = [...objective, ...judged];
    return { ...run, ...summarizeRun(assertions), assertions };
  });
  // The sampled shape belongs to the recorded run; only the destination and the
  // provenance pointer come from this invocation. Letting this invocation's
  // defaults win would silently collapse a multi-model run into one column.
  emit(runs, {
    ...options,
    ...previous.options,
    out: options.out,
    rescoredFrom: options.rescore,
  }, manifest);
}

function emit(runs, options, manifest, receiptContext = null) {
  const summary = summarize(runs, options, manifest);
  if (receiptContext) {
    assertBoundInputsUnchanged(receiptContext.boundInputs);
    const receipt = buildReceipt({
      source: receiptContext.source,
      harness: receiptContext.harness,
      invocation: receiptContext.invocation,
      runs,
      summary,
      capabilities: receiptContext.capabilities,
    });
    writeReceipt(options.receipt, receipt, { capabilities: receiptContext.capabilities });
    process.stderr.write(`Sanitized receipt written to ${options.receipt}\n`);
  }
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify({ options, summary, runs }, null, 2));
  process.stdout.write(renderSummary(summary, options) + '\n');
  process.stderr.write(`\nFull transcript written to ${options.out}\n`);
}

function mean(values) {
  const usable = values.filter((value) => typeof value === 'number');
  return usable.length === 0 ? null : usable.reduce((total, value) => total + value, 0) / usable.length;
}

function rate(passed, total) {
  return total === 0 ? null : passed / total;
}

export function summarize(runs, options, manifest) {
  const comparisonKey = (run) => JSON.stringify([
    run.model ?? null,
    run.case,
    run.split ?? 'tune',
    run.repeat ?? 0,
  ]);
  const unscorablePairKeys = new Set(
    runs
      .filter((run) => run.kind !== 'trigger' && run.scorable === false)
      .map(comparisonKey)
  );
  // If infrastructure prevents either arm from being observed, exclude its
  // matched counterpart too. An adapter error has no trustworthy model result,
  // so it cannot be used to create lift in either direction.
  const answer = runs.filter((run) =>
    run.kind !== 'trigger' && !unscorablePairKeys.has(comparisonKey(run)));
  const successfulAnswers = answer.filter((run) => run.ok);
  const trigger = runs.filter((run) => run.kind === 'trigger');
  const models = options.models ?? [...new Set(runs.map((run) => run.model))];

  const byModel = models.map((model) => {
    const modelAnswers = answer.filter((run) => run.model === model);
    const variants = {};
    for (const variant of manifest.variants) {
      const subset = modelAnswers.filter((run) => run.variant === variant);
      variants[variant] = {
        runs: subset.length,
        casePassRate: rate(subset.filter((run) => run.passed).length, subset.length),
        // A provider failure is a failed sample, not a hard case that vanishes
        // from one arm's denominator.
        assertionPassRate: mean(subset.map((run) => run.ok ? run.passRate : 0)),
        gradedScore: mean(subset.map((run) => run.gradedScore)),
      };
    }
    const modelTriggers = trigger.filter((run) => run.model === model);
    const delta = (key) =>
      variants.with_skill?.[key] != null && variants.without_skill?.[key] != null
        ? variants.with_skill[key] - variants.without_skill[key]
        : null;
    return {
      model,
      variants,
      lift: { cases: delta('casePassRate'), assertions: delta('assertionPassRate'), graded: delta('gradedScore') },
      trigger: {
        runs: modelTriggers.length,
        accuracy: rate(modelTriggers.filter((run) => run.passed).length, modelTriggers.length),
      },
    };
  });

  const assertionBreakdown = {};
  for (const run of successfulAnswers) {
    for (const assertion of run.assertions ?? []) {
      const key = `${run.case}:${assertion.name}`;
      assertionBreakdown[key] ??= {};
      const bucket = (assertionBreakdown[key][run.variant] ??= { passed: 0, total: 0 });
      bucket.total += 1;
      bucket.passed += assertion.passed ? 1 : 0;
    }
  }

  // An assertion the baseline passes at least as often as the skilled arm is not
  // measuring the skill — but two very different things look like that, and
  // pooling them buries the real ones.
  //
  //   A `not_regex` both arms always satisfy is a regression guard holding. It
  //   is supposed to read 100/100 forever; it earns its keep the day someone
  //   reintroduces the payload it forbids.
  //
  //   A `regex` the baseline matches as often as the skilled arm is either a
  //   saturated case or a broken assertion, and is worth opening.
  const guardTypes = new Set(['not_regex']);
  const typeOf = new Map();
  for (const run of successfulAnswers) {
    for (const assertion of run.assertions ?? []) {
      typeOf.set(`${run.case}:${assertion.name}`, assertion.type);
    }
  }
  const flat = Object.entries(assertionBreakdown)
    .filter(([, arms]) => arms.with_skill && arms.without_skill)
    .map(([assertion, arms]) => ({
      assertion,
      type: typeOf.get(assertion),
      with_skill: arms.with_skill.passed / arms.with_skill.total,
      without_skill: arms.without_skill.passed / arms.without_skill.total,
    }))
    .filter((entry) => entry.with_skill <= entry.without_skill);

  const holdingGuards = flat.filter(
    (entry) => guardTypes.has(entry.type) && entry.with_skill === 1 && entry.without_skill === 1
  );
  const nonDiscriminating = flat.filter((entry) => !holdingGuards.includes(entry));

  return {
    byModel,
    assertionBreakdown,
    nonDiscriminating,
    holdingGuards,
    unscorablePairs: unscorablePairKeys.size,
    splits: [...new Set(runs.map((run) => run.split))],
    errors: runs.filter((run) => !run.ok).length,
  };
}

function percent(value) {
  return value == null ? '  n/a' : `${(value * 100).toFixed(1).padStart(5)}%`;
}

function renderSummary(summary, options) {
  const lines = ['', 'Answer cases (all gating assertions must pass)'];
  lines.push('model                        with_skill  without_skill      lift   trigger');
  lines.push('---------------------------------------------------------------------------');
  for (const entry of summary.byModel) {
    lines.push(
      String(entry.model ?? 'default').padEnd(28) +
      percent(entry.variants.with_skill?.casePassRate) + '      ' +
      percent(entry.variants.without_skill?.casePassRate) + '   ' +
      percent(entry.lift.cases) + '    ' +
      percent(entry.trigger.accuracy)
    );
  }
  lines.push('', 'Assertion-level pass rate');
  lines.push('model                        with_skill  without_skill      lift');
  lines.push('-----------------------------------------------------------------');
  for (const entry of summary.byModel) {
    lines.push(
      String(entry.model ?? 'default').padEnd(28) +
      percent(entry.variants.with_skill?.assertionPassRate) + '      ' +
      percent(entry.variants.without_skill?.assertionPassRate) + '   ' +
      percent(entry.lift.assertions)
    );
  }
  if (summary.byModel.some((entry) => entry.variants.with_skill?.gradedScore != null)) {
    lines.push('', 'Judged graded score (1-5, soft severity: does not move pass rates)');
    lines.push('model                        with_skill  without_skill');
    lines.push('---------------------------------------------------------');
    for (const entry of summary.byModel) {
      const format = (value) => (value == null ? ' n/a' : value.toFixed(2).padStart(5));
      lines.push(
        String(entry.model ?? 'default').padEnd(28) +
        format(entry.variants.with_skill?.gradedScore) + '      ' +
        format(entry.variants.without_skill?.gradedScore)
      );
    }
  }
  if (summary.nonDiscriminating.length > 0) {
    lines.push('', `${summary.nonDiscriminating.length} non-discriminating assertion(s) — saturated case or broken check:`);
    for (const entry of summary.nonDiscriminating) {
      lines.push(`  ${entry.assertion}  ${percent(entry.with_skill)} / ${percent(entry.without_skill)}`);
    }
  }
  if (summary.holdingGuards?.length > 0) {
    // Listed, not warned about: a guard at 100/100 is doing its job.
    lines.push('', `${summary.holdingGuards.length} regression guard(s) holding at 100% in both arms.`);
  }
  if (summary.errors > 0) {
    lines.push('', `${summary.errors} run(s) failed.`);
  }
  if (summary.unscorablePairs > 0) {
    lines.push(`${summary.unscorablePairs} matched pair(s) excluded after an infrastructure failure.`);
  }
  lines.push('', `splits=${summary.splits.join(',')} repeats=${options.repeats} concurrency=${options.concurrency}`);
  return lines.join('\n');
}

// Importable for the manifest test; only the CLI entry point runs the suite.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
