#!/usr/bin/env node
/**
 * Claude Code adapter with live MCP tool access.
 *
 * The plain `claude.mjs` adapter runs the model with no tools, so a case can
 * only be graded on what the model says. This one points it at a real
 * Keyboardia `/mcp` endpoint and returns the ordered tool calls alongside the
 * answer, so a case can be graded on what the model did.
 *
 * Contract (the same one every adapter speaks; `trace` is an optional field the
 * contract already carries):
 *   stdin   {"prompt": string, "model": string|null, "workspace": string}
 *   stdout  {"answer": string, "trace": [{"name": string, "arguments": object,
 *             "success": boolean, "result": object|null}]}
 *
 * Nothing here is Claude-specific except the argv and the stream parsing. Any
 * MCP-capable client can supply the same envelope; the runner does not care
 * which one produced it.
 *
 * Environment:
 *   KEYBOARDIA_MCP_URL   endpoint to expose (default http://localhost:8787/mcp)
 *   KEYBOARDIA_CLAUDE_BIN  override the executable
 */
import { spawn } from 'node:child_process';
import { toolResultStructuredContent, toolResultSucceeded } from './mcp-trace.mjs';
import { numericUsage } from './usage.mjs';

const binary = process.env.KEYBOARDIA_CLAUDE_BIN ?? 'claude';
const endpoint = process.env.KEYBOARDIA_MCP_URL ?? 'http://localhost:8787/mcp';

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
  '--output-format', 'stream-json',
  '--verbose',
  '--max-turns', '12',
  '--strict-mcp-config',
  '--mcp-config', JSON.stringify({
    mcpServers: { keyboardia: { type: 'http', url: endpoint } },
  }),
  // Only the two Keyboardia tools plus the discovery tool the CLI needs to
  // surface them. No filesystem, no shell: the only thing the agent can affect
  // is the session under test.
  '--allowed-tools', 'mcp__keyboardia__get_session,mcp__keyboardia__edit_session,ToolSearch',
  '--disable-slash-commands',
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
  process.stderr.write(`claude-mcp adapter: ${error.message}\n`);
  process.exit(1);
});
child.on('close', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  const trace = [];
  const byToolUseId = new Map();
  let answer = '';
  let usage;

  for (const line of stdout.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('{')) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        // Keep only the Keyboardia calls: ToolSearch is CLI plumbing, not a
        // decision the skill influences, and counting it would corrupt any
        // call-count assertion.
        if (block.type === 'tool_use' && String(block.name).startsWith('mcp__keyboardia__')) {
          const call = {
            name: String(block.name).replace('mcp__keyboardia__', ''),
            arguments: block.input ?? {},
            success: null,
            result: null,
          };
          trace.push(call);
          if (block.id) byToolUseId.set(block.id, call);
        }
      }
    }
    if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_result' || !byToolUseId.has(block.tool_use_id)) continue;
        const call = byToolUseId.get(block.tool_use_id);
        call.success = toolResultSucceeded(block);
        if (call.success) call.result = toolResultStructuredContent(block);
      }
    }
    if (event.type === 'result') {
      answer = String(event.result ?? '');
      usage = numericUsage(event.usage);
    }
  }

  process.stdout.write(JSON.stringify({ answer, trace, usage }));
});

child.stdin.end(prompt);
