#!/usr/bin/env node
/**
 * Claude Code adapter for the origin-only autonomous discovery journey.
 *
 * Unlike claude-mcp.mjs, this never configures the target MCP endpoint. It
 * exposes only the capability-neutral audited transport, which can connect to
 * an endpoint the model extracts from digest-verified same-origin bytes.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numericUsage } from './usage.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const transportPath = resolve(repoRoot, 'app/scripts/autonomous-discovery-transport.mjs');
const binary = process.env.KEYBOARDIA_CLAUDE_BIN ?? 'claude';
const genericTools = [
  'mcp__discovery_transport__fetch_url',
  'mcp__discovery_transport__verify_sha256',
  'mcp__discovery_transport__connect_mcp',
  'mcp__discovery_transport__list_mcp_tools',
  'mcp__discovery_transport__call_mcp_tool',
  'mcp__discovery_transport__random_uuid',
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const input = await readStdin();
const { prompt, model, origin, trace_path: tracePath } = input;
if (typeof prompt !== 'string' || typeof origin !== 'string' || typeof tracePath !== 'string') {
  process.stderr.write('claude-discovery: prompt, origin and trace_path are required\n');
  process.exit(2);
}

const forbiddenPrompt = [
  /\.well-known\/agent-skills/i,
  /\/mcp\b/i,
  /\b(?:create|get|edit|publish|remix|export)_session\b/i,
  /\btools\/list\b/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
];
if (forbiddenPrompt.some((pattern) => pattern.test(prompt))) {
  process.stderr.write('claude-discovery: prompt contains target knowledge or a capability\n');
  process.exit(2);
}

const mcpConfig = {
  mcpServers: {
    discovery_transport: {
      type: 'stdio',
      command: process.execPath,
      args: [transportPath],
      env: {
        AUTONOMOUS_DISCOVERY_ORIGIN: new URL(origin).origin,
        AUTONOMOUS_DISCOVERY_TRACE: tracePath,
      },
    },
  },
};

const argv = [
  '--print',
  '--output-format', 'stream-json',
  '--verbose',
  '--max-turns', '24',
  '--strict-mcp-config',
  '--mcp-config', JSON.stringify(mcpConfig),
  '--tools', 'ToolSearch',
  '--allowed-tools', [...genericTools, 'ToolSearch'].join(','),
  '--permission-mode', 'dontAsk',
  '--disable-slash-commands',
  '--setting-sources', '',
  '--no-session-persistence',
];
if (model) argv.push('--model', model);

const child = spawn(binary, argv, {
  cwd: input.workspace,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.on('error', (error) => {
  process.stderr.write(`claude-discovery: ${error.message}\n`);
  process.exit(1);
});

child.on('close', (code) => {
  if (process.env.KEYBOARDIA_KEEP_AUTONOMOUS_CLI === '1') {
    writeFileSync(`${tracePath}.claude-stdout`, stdout, { mode: 0o600 });
    writeFileSync(`${tracePath}.claude-stderr`, stderr, { mode: 0o600 });
  }
  if (code !== 0) {
    process.stderr.write(
      stderr || stdout || `claude-discovery: CLI exited ${code}\n`,
    );
    process.exit(code ?? 1);
  }
  let answer = '';
  let usage;
  const cliTrace = [];
  let forbiddenTool;
  for (const line of stdout.split('\n')) {
    if (!line.trimStart().startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use') continue;
        cliTrace.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
        if (!genericTools.includes(block.name) && block.name !== 'ToolSearch') forbiddenTool = block.name;
      }
    }
    if (event.type === 'result') {
      answer = String(event.result ?? '');
      usage = numericUsage(event.usage);
    }
  }
  if (forbiddenTool) {
    process.stderr.write(`claude-discovery: agent attempted forbidden tool ${forbiddenTool}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    answer,
    usage,
    cli_trace: cliTrace,
    adapter_argv: argv,
    target_mcp_preconfigured: false,
  }));
});

child.stdin.end(prompt);
