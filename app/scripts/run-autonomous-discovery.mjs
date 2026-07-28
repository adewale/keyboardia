#!/usr/bin/env node
/** Run one origin-only autonomous discovery journey against an isolated Worker. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  createSourceBinding,
  sanitizeReceiptText,
  sanitizeReceiptValue,
} from '../../evals/receipt.mjs';
import {
  sanitizeForReceipt,
  sensitiveUuidsFromTrace,
  validateAutonomousTrace,
  validateOriginOnlyPrompt,
  validateRawAnswerCapabilities,
} from './autonomous-discovery-validator.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..');
const adapterPath = resolve(repoRoot, 'evals/adapters/claude-discovery.mjs');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const options = {
    model: 'claude-sonnet-5',
    out: null,
    skipBuild: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    else if (arg === '--out') options.out = resolve(argv[++index]);
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index]) * 1000;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout must be a positive number of seconds');
  }
  return options;
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForWorker(origin, worker, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`wrangler exited ${worker.exitCode} before readiness`);
    try {
      const response = await fetch(new URL('/api/health', origin), {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('wrangler did not become ready within 120 seconds');
}

async function stopWorker(worker) {
  if (!worker || worker.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const forced = setTimeout(() => {
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }, 5000);
    worker.once('exit', () => {
      clearTimeout(forced);
      resolveStop();
    });
    worker.kill('SIGTERM');
  });
}

function buildPrompt(origin) {
  return [
    'The only location you know for this music site is its origin:',
    origin,
    '',
    'Use the Agent Skills discovery standard to discover any agent instructions the site publishes. Fetch the selected instructions as exact bytes and cryptographically verify them against the catalog digest before following them. Derive every service endpoint from those verified bytes and inspect the live service capabilities instead of assuming a cached contract.',
    '',
    'Create exactly one new disposable, unpublished session. Inspect its state before editing. Add one kick track whose active steps are exactly 0, 4, 8, and 12 without changing the tempo or anything unrelated. Treat the requested result as potentially requiring more than one state-changing operation. After each individual state-changing operation, inspect the live state and verify that operation’s post-state before issuing the next state-changing operation. Finish only after a final inspection confirms the whole request. Do not publish, remix, or export. Do not reveal the editable URL or session capability in your final answer.',
  ].join('\n');
}

function runAdapter({ prompt, model, origin, tracePath, workspace, timeoutMs }) {
  return new Promise((resolveRun) => {
    const detached = process.platform !== 'win32';
    const child = spawn(process.execPath, [adapterPath], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // It may have exited between the timeout and signal.
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ ok: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolveRun({ ok: false, error: `agent timed out after ${timeoutMs}ms` });
      if (code !== 0) return resolveRun({ ok: false, error: stderr.trim() || `adapter exited ${code}` });
      try {
        resolveRun({ ok: true, value: JSON.parse(stdout) });
      } catch (error) {
        resolveRun({ ok: false, error: `adapter returned invalid JSON: ${error.message}` });
      }
    });
    child.stdin.end(JSON.stringify({ prompt, model, origin, trace_path: tracePath, workspace }));
  });
}

function readTrace(path) {
  if (!existsSync(path)) throw new Error('audited transport produced no trace');
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function sourceClosure(entryPaths) {
  const found = new Set();
  const visit = (absolutePath) => {
    const absolute = resolve(absolutePath);
    if (found.has(absolute)) return;
    found.add(absolute);
    const source = readFileSync(absolute, 'utf8');
    const imports = [
      ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g),
    ];
    for (const match of imports) {
      const imported = resolve(dirname(absolute), match[1]);
      const candidates = [
        imported,
        `${imported}.ts`, `${imported}.tsx`, `${imported}.mjs`, `${imported}.js`, `${imported}.json`,
        resolve(imported, 'index.ts'), resolve(imported, 'index.tsx'), resolve(imported, 'index.js'),
      ];
      const dependency = candidates.find((candidate) => existsSync(candidate));
      if (dependency) visit(dependency);
    }
  };
  for (const entryPath of entryPaths) visit(resolve(repoRoot, entryPath));
  return [...found].sort().map((absolute) => ({
    role: 'system_under_test_dependency',
    path: relative(repoRoot, absolute).split(sep).join('/'),
  }));
}

function sourceBinding() {
  const inputs = [
    { role: 'skill', path: 'app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md' },
    { role: 'manifest', path: 'app/public/.well-known/agent-skills/index.json' },
    { role: 'transport', path: 'app/scripts/autonomous-discovery-transport.mjs' },
    { role: 'validator', path: 'app/scripts/autonomous-discovery-validator.mjs' },
    { role: 'runner', path: 'app/scripts/run-autonomous-discovery.mjs' },
    { role: 'answer_adapter', path: 'evals/adapters/claude-discovery.mjs' },
    { role: 'answer_adapter_dependency', path: 'evals/adapters/usage.mjs' },
    { role: 'system_under_test_config', path: 'app/wrangler.jsonc' },
    { role: 'system_under_test_typescript_config', path: 'app/tsconfig.worker.json' },
    { role: 'dependency_manifest', path: 'app/package.json' },
    { role: 'dependency_lock', path: 'app/package-lock.json' },
    { role: 'receipt_runtime', path: 'evals/receipt.mjs' },
    { role: 'receipt_schema', path: 'evals/receipt.schema.json' },
    ...sourceClosure(['app/src/worker/index.ts']),
  ];
  const unique = [...new Map(inputs.map((input) => [input.path, input])).values()];
  return createSourceBinding(repoRoot, unique);
}

function transcriptHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function main() {
  const options = parseArgs(process.argv);
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'keyboardia-autonomous-'));
  const tracePath = resolve(tempRoot, 'raw-transport.jsonl');
  const workspace = resolve(tempRoot, 'agent-workspace');
  const persistence = resolve(tempRoot, 'wrangler-state');
  mkdirSync(workspace, { recursive: true });
  let worker;
  let workerStderr = '';
  let completed = false;
  try {
    if (!options.skipBuild) {
      const built = spawnSync('npm', ['run', 'build'], {
        cwd: appRoot,
        stdio: 'inherit',
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      });
      if (built.status !== 0) throw new Error(`build failed with status ${built.status}`);
    }

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    worker = spawn('npx', [
      'wrangler', 'dev', '--local', '--port', String(port),
      '--persist-to', persistence,
      '--show-interactive-dev-session', 'false',
      '--var', 'SESSION_CREATE_RATE_LIMIT_PER_MINUTE:100',
      '--var', 'MCP_RATE_LIMIT_PER_MINUTE:100',
    ], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG: 'none',
      },
    });
    worker.stdout.on('data', () => {});
    worker.stderr.on('data', (chunk) => { workerStderr += chunk; });
    await waitForWorker(origin, worker);

    const prompt = buildPrompt(origin);
    validateOriginOnlyPrompt(prompt, { origin });
    // This fails before a model call if any bound byte differs from HEAD.
    const source = sourceBinding();
    const run = await runAdapter({
      prompt,
      model: options.model,
      origin,
      tracePath,
      workspace,
      timeoutMs: options.timeoutMs,
    });
    if (!run.ok) throw new Error(run.error);
    if (run.value.target_mcp_preconfigured !== false) {
      throw new Error('adapter did not prove the target MCP was unconfigured');
    }
    const argvText = JSON.stringify(run.value.adapter_argv ?? []);
    if (/\b(?:create|get|edit|publish|remix|export)_session\b/i.test(argvText)) {
      throw new Error('adapter argv preconfigured a target tool');
    }

    const rawTrace = readTrace(tracePath);
    const validation = validateAutonomousTrace(rawTrace, { origin });
    const sensitiveUuids = sensitiveUuidsFromTrace(rawTrace);
    const rawAnswerCapabilityScan = validateRawAnswerCapabilities(
      run.value.answer,
      sensitiveUuids,
    );
    const { sanitized, redacted_uuids: redactedUuids } = sanitizeForReceipt({
      trace: rawTrace,
      answer: run.value.answer,
      cli_trace: run.value.cli_trace,
      adapter_argv: run.value.adapter_argv,
    }, { onlyUuids: sensitiveUuids });
    sanitized.answer = sanitizeReceiptText(sanitized.answer);
    sanitized.cli_trace = sanitizeReceiptValue(sanitized.cli_trace);
    sanitized.adapter_argv = sanitizeReceiptValue(sanitized.adapter_argv);
    const sanitizedValidation = validateAutonomousTrace(sanitized.trace, { origin });
    const receipt = {
      version: 1,
      kind: 'origin-only-autonomous-skill-discovery',
      target_mcp_preconfigured: false,
      created_at: new Date().toISOString(),
      origin,
      prompt,
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      agent: { adapter: 'claude-discovery', model: options.model, usage: run.value.usage ?? null },
      source,
      validation: sanitizedValidation,
      trace_sha256: transcriptHash(sanitized.trace),
      answer_sha256: createHash('sha256').update(sanitized.answer).digest('hex'),
      cli_trace_sha256: transcriptHash(sanitized.cli_trace),
      adapter_argv_sha256: transcriptHash(sanitized.adapter_argv),
      raw_answer_capability_scan: rawAnswerCapabilityScan,
      redacted_uuids: redactedUuids,
      trace: sanitized.trace,
      answer: sanitized.answer,
      cli_trace: sanitized.cli_trace,
      adapter_argv: sanitized.adapter_argv,
    };
    const receiptJson = JSON.stringify(receipt).toLowerCase();
    if ([...sensitiveUuids].some((uuid) => receiptJson.includes(uuid))) {
      throw new Error('sanitized receipt still contains a UUID capability or request token');
    }
    const output = options.out ?? resolve(tmpdir(), `keyboardia-autonomous-${options.model}-${Date.now()}.json`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    completed = true;
    process.stdout.write(`Autonomous discovery: PASS (${validation.event_count} events)\n${output}\n`);
  } catch (error) {
    const detail = workerStderr.trim() ? `\nWrangler: ${workerStderr.slice(-1000)}` : '';
    throw new Error(`${error.message}${detail}`);
  } finally {
    await stopWorker(worker);
    if (!completed && process.env.KEYBOARDIA_KEEP_AUTONOMOUS_TEMP === '1') {
      process.stderr.write(`Preserved failed autonomous run at ${tempRoot}\n`);
    } else {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Autonomous discovery: FAIL: ${error.message}\n`);
  process.exit(1);
});
