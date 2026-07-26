#!/usr/bin/env node
/**
 * Executes evals/shared-benchmark.json against one or more Claude models.
 *
 * The manifest names an external harness (skill-eval-harness). This runner is a
 * self-contained, dependency-free implementation of the same contract so that
 * the committed cases stay executable from this repository alone:
 *
 *   - answer cases (kind: positive | adversarial) run twice per model, once with
 *     the published SKILL.md in context and once without. Both arms receive the
 *     committed MCP schema fixture, so the baseline is never handicapped by a
 *     hidden tool contract.
 *   - trigger cases (kind: trigger) run once per model. The skill's published
 *     name and description are placed in a catalog alongside distractors, and
 *     the model chooses which skills, if any, to load.
 *
 * A trigger case measures description-driven selection from a catalog. It does
 * not prove autonomous loading inside any particular agent product.
 *
 * Usage:
 *   node evals/run-benchmark.mjs \
 *     --models claude-haiku-4-5-20251001,claude-sonnet-5,claude-opus-5 \
 *     --repeats 3 --concurrency 6 --out evals/results/run.json
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalsDir, '..');

const ANSWER_SYSTEM_PROMPT = [
  'You are an AI assistant connected to a Model Context Protocol (MCP) client.',
  'You cannot execute tool calls in this environment.',
  'Answer the request directly, and show exact JSON arguments wherever the request asks for them.',
].join(' ');

const TRIGGER_SYSTEM_PROMPT = [
  'You are an AI assistant that loads skills on demand.',
  'You are given a catalog of available skills and one user message.',
  'Decide which skills, if any, you would load before answering.',
  'Reply with a JSON array of skill names and nothing else. Reply with [] when no skill applies.',
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

function parseArgs(argv) {
  const options = {
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'],
    repeats: 1,
    concurrency: 6,
    out: resolve(evalsDir, 'results', 'run.json'),
    cases: null,
    timeoutMs: 300_000,
    rescore: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
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
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
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

function scoreAssertions(assertions, response) {
  return assertions.map((assertion) => {
    const matched = compilePattern(assertion.pattern).test(response);
    const passed = assertion.type === 'not_regex' ? !matched : matched;
    return { name: assertion.name, type: assertion.type, passed };
  });
}

function runClaude({ model, systemPrompt, prompt, timeoutMs }) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'keyboardia-eval-'));
  return new Promise((resolvePromise) => {
    const child = spawn(
      'claude',
      [
        '--print',
        '--model', model,
        '--system-prompt', systemPrompt,
        '--output-format', 'json',
        '--allowed-tools', '',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config', '{"mcpServers":{}}',
        '--setting-sources', '',
        '--no-session-persistence',
      ],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolvePromise({ ok: false, text: '', error: stderr.trim() || `exit ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolvePromise({ ok: true, text: String(parsed.result ?? ''), usage: parsed.usage });
      } catch {
        resolvePromise({ ok: false, text: '', error: `unparseable output: ${stdout.slice(0, 200)}` });
      }
    });

    child.stdin.end(prompt);
  });
}

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function buildAnswerPrompt(testCase, manifest, variant) {
  const blocks = [];
  if (variant === 'with_skill') {
    for (const skillPath of manifest.skill_paths) {
      blocks.push(
        `<available-skill name="${manifest.skill_name}">\n` +
        readFileSync(resolve(repoRoot, skillPath), 'utf8').trimEnd() +
        '\n</available-skill>'
      );
    }
  }
  for (const file of testCase.files ?? []) {
    blocks.push(
      `<attached-file name="${file}">\n` +
      readFileSync(resolve(evalsDir, file), 'utf8').trimEnd() +
      '\n</attached-file>'
    );
  }
  blocks.push(testCase.prompt);
  return blocks.join('\n\n');
}

function buildTriggerPrompt(testCase, manifest, skillDescription) {
  const catalog = [
    { name: manifest.skill_name, description: skillDescription },
    ...TRIGGER_DISTRACTORS,
  ]
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join('\n');
  return [
    '<available-skills>',
    catalog,
    '</available-skills>',
    '',
    '<user-message>',
    testCase.prompt,
    '</user-message>',
  ].join('\n');
}

function readSkillDescription(manifest) {
  const skill = readFileSync(resolve(repoRoot, manifest.skill_paths[0]), 'utf8');
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
  return {
    selected,
    loaded,
    shouldLoad,
    passed: loaded === shouldLoad,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(
    readFileSync(resolve(evalsDir, 'shared-benchmark.json'), 'utf8')
  );
  const skillDescription = readSkillDescription(manifest);
  const allCases = options.cases
    ? manifest.cases.filter((testCase) => options.cases.has(testCase.id))
    : manifest.cases;

  // Re-scoring applies the current assertions to responses a previous run
  // already recorded. An assertion change can then be measured on identical
  // text instead of a fresh sample, which is the only way to tell a real
  // behaviour change from a decoding difference.
  if (options.rescore) {
    const previous = JSON.parse(readFileSync(options.rescore, 'utf8'));
    const byId = new Map(manifest.cases.map((testCase) => [testCase.id, testCase]));
    const rescored = previous.runs.map((run) => {
      if (!run.ok || run.kind === 'trigger' || !byId.has(run.case)) {
        return run;
      }
      const assertions = scoreAssertions(byId.get(run.case).assertions, run.response);
      return { ...run, assertions, passed: assertions.every((entry) => entry.passed) };
    });
    // The sampled shape belongs to the recorded run; only the destination and
    // the provenance pointer come from this invocation.
    const rescoredOptions = {
      ...options,
      ...previous.options,
      out: options.out,
      rescoredFrom: options.rescore,
    };
    const summary = summarize(rescored, rescoredOptions, manifest);
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(
      options.out,
      JSON.stringify({ options: rescoredOptions, summary, runs: rescored }, null, 2)
    );
    process.stdout.write(renderSummary(summary, rescoredOptions) + '\n');
    process.stderr.write(`\nRe-scored ${options.rescore} into ${options.out}\n`);
    return;
  }

  const jobs = [];
  for (const model of options.models) {
    for (const testCase of allCases) {
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
    `Running ${jobs.length} model calls ` +
    `(${allCases.length} cases x ${options.models.length} models x ${options.repeats} repeats)\n`
  );

  let done = 0;
  const runs = await withConcurrency(jobs, options.concurrency, async (job) => {
    const isTrigger = job.testCase.kind === 'trigger';
    const prompt = isTrigger
      ? buildTriggerPrompt(job.testCase, manifest, skillDescription)
      : buildAnswerPrompt(job.testCase, manifest, job.variant);
    const systemPrompt = isTrigger ? TRIGGER_SYSTEM_PROMPT : ANSWER_SYSTEM_PROMPT;

    let result = await runClaude({
      model: job.model,
      systemPrompt,
      prompt,
      timeoutMs: options.timeoutMs,
    });
    if (!result.ok) {
      result = await runClaude({
        model: job.model,
        systemPrompt,
        prompt,
        timeoutMs: options.timeoutMs,
      });
    }

    done += 1;
    process.stderr.write(`  [${done}/${jobs.length}] ${job.model} ${job.testCase.id} ${job.variant}\n`);

    if (!result.ok) {
      return { ...job, testCase: job.testCase.id, ok: false, error: result.error };
    }

    if (isTrigger) {
      const trigger = scoreTrigger(job.testCase, result.text, manifest.skill_name);
      return {
        model: job.model,
        case: job.testCase.id,
        kind: job.testCase.kind,
        variant: job.variant,
        repeat: job.repeat,
        ok: true,
        passed: trigger.passed,
        trigger,
        response: result.text,
      };
    }

    const assertions = scoreAssertions(job.testCase.assertions, result.text);
    return {
      model: job.model,
      case: job.testCase.id,
      kind: job.testCase.kind,
      variant: job.variant,
      repeat: job.repeat,
      ok: true,
      passed: assertions.every((assertion) => assertion.passed),
      assertions,
      response: result.text,
    };
  });

  const summary = summarize(runs, options, manifest);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify({ options, summary, runs }, null, 2));
  process.stdout.write(renderSummary(summary, options) + '\n');
  process.stderr.write(`\nFull transcript written to ${options.out}\n`);
}

function rate(passed, total) {
  return total === 0 ? null : passed / total;
}

function summarize(runs, options, manifest) {
  const answer = runs.filter((run) => run.kind !== 'trigger' && run.ok);
  const trigger = runs.filter((run) => run.kind === 'trigger' && run.ok);
  const failed = runs.filter((run) => !run.ok);

  const byModel = options.models.map((model) => {
    const modelAnswers = answer.filter((run) => run.model === model);
    const variants = {};
    for (const variant of manifest.variants) {
      const subset = modelAnswers.filter((run) => run.variant === variant);
      const assertions = subset.flatMap((run) => run.assertions);
      variants[variant] = {
        cases: subset.length,
        casePassRate: rate(subset.filter((run) => run.passed).length, subset.length),
        assertionPassRate: rate(
          assertions.filter((assertion) => assertion.passed).length,
          assertions.length
        ),
      };
    }
    const modelTriggers = trigger.filter((run) => run.model === model);
    return {
      model,
      variants,
      lift: {
        cases:
          variants.with_skill?.casePassRate != null && variants.without_skill?.casePassRate != null
            ? variants.with_skill.casePassRate - variants.without_skill.casePassRate
            : null,
        assertions:
          variants.with_skill?.assertionPassRate != null &&
          variants.without_skill?.assertionPassRate != null
            ? variants.with_skill.assertionPassRate - variants.without_skill.assertionPassRate
            : null,
      },
      trigger: {
        cases: modelTriggers.length,
        accuracy: rate(modelTriggers.filter((run) => run.passed).length, modelTriggers.length),
      },
    };
  });

  const byCase = manifest.cases.map((testCase) => {
    const entry = { case: testCase.id, kind: testCase.kind, models: {} };
    for (const model of options.models) {
      const subset = runs.filter(
        (run) => run.ok && run.case === testCase.id && run.model === model
      );
      if (testCase.kind === 'trigger') {
        entry.models[model] = {
          accuracy: rate(subset.filter((run) => run.passed).length, subset.length),
        };
        continue;
      }
      entry.models[model] = Object.fromEntries(
        manifest.variants.map((variant) => {
          const arm = subset.filter((run) => run.variant === variant);
          return [variant, rate(arm.filter((run) => run.passed).length, arm.length)];
        })
      );
    }
    return entry;
  });

  const assertionBreakdown = {};
  for (const run of answer) {
    for (const assertion of run.assertions) {
      const key = `${run.case}:${assertion.name}`;
      assertionBreakdown[key] ??= {};
      assertionBreakdown[key][`${run.model}/${run.variant}`] ??= { passed: 0, total: 0 };
      const bucket = assertionBreakdown[key][`${run.model}/${run.variant}`];
      bucket.total += 1;
      bucket.passed += assertion.passed ? 1 : 0;
    }
  }

  return { byModel, byCase, assertionBreakdown, errors: failed.length };
}

function percent(value) {
  return value == null ? '  n/a' : `${(value * 100).toFixed(1).padStart(5)}%`;
}

function renderSummary(summary, options) {
  const lines = [];
  lines.push('');
  lines.push('Answer cases (all assertions must pass)');
  lines.push('model                        with_skill  without_skill      lift   trigger');
  lines.push('---------------------------------------------------------------------------');
  for (const entry of summary.byModel) {
    lines.push(
      entry.model.padEnd(28) +
      percent(entry.variants.with_skill?.casePassRate) + '      ' +
      percent(entry.variants.without_skill?.casePassRate) + '   ' +
      percent(entry.lift.cases) + '    ' +
      percent(entry.trigger.accuracy)
    );
  }
  lines.push('');
  lines.push('Assertion-level pass rate');
  lines.push('model                        with_skill  without_skill      lift');
  lines.push('-----------------------------------------------------------------');
  for (const entry of summary.byModel) {
    lines.push(
      entry.model.padEnd(28) +
      percent(entry.variants.with_skill?.assertionPassRate) + '      ' +
      percent(entry.variants.without_skill?.assertionPassRate) + '   ' +
      percent(entry.lift.assertions)
    );
  }
  if (summary.errors > 0) {
    lines.push('');
    lines.push(`${summary.errors} model call(s) failed after one retry.`);
  }
  lines.push('');
  lines.push(`repeats=${options.repeats}, concurrency=${options.concurrency}`);
  return lines.join('\n');
}

// Importable for the manifest test; only the CLI entry point runs the suite.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
