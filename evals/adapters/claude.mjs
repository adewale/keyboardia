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

const binary = process.env.KEYBOARDIA_CLAUDE_BIN ?? 'claude';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const { prompt, model } = await readStdin();

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
if (model) {
  argv.push('--model', model);
}

const child = spawn(binary, argv, { stdio: ['pipe', 'pipe', 'inherit'] });

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
    process.stdout.write(JSON.stringify({ answer: String(parsed.result ?? ''), usage: parsed.usage }));
  } catch {
    process.stderr.write('claude adapter: could not parse CLI output as JSON\n');
    process.exit(1);
  }
});

child.stdin.end(prompt);
