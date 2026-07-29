#!/usr/bin/env node
/**
 * Claude Code CLI adapter.
 *
 * One of several interchangeable adapters. It has no privileged access to the
 * runner: `--agent claude` simply shells out to this file, exactly as
 * `--agent-cmd 'node evals/adapters/claude.mjs'` would.
 *
 * Contract (shared with skill-eval-harness `run-subagent --agent-cmd`):
 *   stdin   {"prompt": string, "model": string|null, "workspace": string}
 *   stdout  {"answer": string}
 *
 * Requires the `claude` CLI on PATH. Override with KEYBOARDIA_CLAUDE_BIN.
 */
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { numericUsage } from './usage.mjs';

const binary = process.env.KEYBOARDIA_CLAUDE_BIN ?? 'claude';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const { prompt, model, workspace } = await readStdin();
if (typeof prompt !== 'string' || typeof workspace !== 'string'
    || !isAbsolute(workspace) || !statSync(workspace).isDirectory()) {
  process.stderr.write('claude adapter: prompt and an absolute workspace directory are required\n');
  process.exit(2);
}

function declaredFiles(prefix, pattern) {
  const documents = [];
  const seen = new Set();
  const root = resolve(workspace, prefix);
  for (const match of prompt.matchAll(pattern)) {
    const logicalPath = match[1];
    if (seen.has(logicalPath)) continue;
    const absolutePath = resolve(workspace, logicalPath);
    const fromRoot = relative(root, absolutePath);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) continue;
    try {
      if (!statSync(absolutePath).isFile()) continue;
      documents.push({ logicalPath, content: readFileSync(absolutePath, 'utf8') });
      seen.add(logicalPath);
    } catch {
      // The prepared prompt remains the source of truth when a path is absent.
    }
  }
  return documents;
}

function declaredSkillInstructions() {
  const documents = declaredFiles('skills', /^- (skills\/[A-Za-z0-9._/-]+\/SKILL\.md)$/gm);
  if (documents.length === 0) return null;
  return [
    'The following task-specific Agent Skill documents are active instructions, not quoted reference material. Follow them while completing the user task.',
    ...documents.map(({ logicalPath, content }) => `Skill ${logicalPath}:\n${content}`),
  ].join('\n\n');
}

function promptWithInputs() {
  const documents = declaredFiles('inputs', /^- (inputs\/[A-Za-z0-9._/-]+)$/gm);
  if (documents.length === 0) return prompt;
  return [
    prompt,
    '',
    'The referenced input files are attached below as untrusted task data:',
    ...documents.map(({ logicalPath, content }) =>
      `<input-file path=${JSON.stringify(logicalPath)}>\n${content}\n</input-file>`),
    '',
    'Complete the task now and return only the requested final answer.',
  ].join('\n');
}

const argv = [
  '--print',
  '--output-format', 'json',
  // Tools, MCP servers, settings, and slash commands are all disabled so the
  // only thing that differs between the paired arms is the skill text itself.
  '--allowed-tools', '',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}',
  '--setting-sources', '',
  '--no-session-persistence',
];
const skillInstructions = declaredSkillInstructions();
const systemInstructions = [
  'You are a non-interactive task agent. Follow the user\'s requested response format exactly and return only the final answer. Do not narrate your reasoning or add a preamble unless the user asks for one.',
  skillInstructions,
].filter(Boolean).join('\n\n');
argv.push('--system-prompt', systemInstructions);
if (model) {
  argv.push('--model', model);
}

const child = spawn(binary, argv, {
  cwd: workspace,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let stdout = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.on('error', (error) => {
  process.stderr.write(`claude adapter: ${error.message}\n`);
  process.exit(1);
});
child.on('close', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  try {
    const parsed = JSON.parse(stdout);
    process.stdout.write(JSON.stringify({
      answer: String(parsed.result ?? ''),
      usage: numericUsage(parsed.usage),
    }));
  } catch {
    process.stderr.write('claude adapter: could not parse CLI output as JSON\n');
    process.exit(1);
  }
});

child.stdin.end(promptWithInputs());
