#!/usr/bin/env node
/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * Works against any endpoint that speaks the `/v1/chat/completions` shape:
 * OpenAI, Azure OpenAI, Together, Groq, vLLM, Ollama, LM Studio, OpenRouter,
 * and most self-hosted gateways. This is the "not tied to any vendor" path —
 * point it at whatever you run.
 *
 * Contract (shared with skill-eval-harness `run-subagent --agent-cmd`):
 *   stdin   {"prompt": string, "model": string|null, "workspace": string}
 *   stdout  {"answer": string}
 *
 * Environment:
 *   EVAL_API_BASE     base URL, default https://api.openai.com/v1
 *   EVAL_API_KEY      bearer token; omit for local servers that need none
 *   EVAL_MODEL        fallback when the runner passes no --models entry
 *
 * Example:
 *   EVAL_API_BASE=http://localhost:11434/v1 EVAL_MODEL=llama3.3 \
 *     node evals/run-benchmark.mjs --agent openai-compatible
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const { prompt, model } = await readStdin();
const base = (process.env.EVAL_API_BASE ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const target = model ?? process.env.EVAL_MODEL;

if (!target) {
  process.stderr.write('openai-compatible adapter: set --models or EVAL_MODEL\n');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json' };
if (process.env.EVAL_API_KEY) {
  headers.Authorization = `Bearer ${process.env.EVAL_API_KEY}`;
}

const response = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: target,
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!response.ok) {
  process.stderr.write(`openai-compatible adapter: ${response.status} ${await response.text()}\n`);
  process.exit(1);
}

const body = await response.json();
const answer = body.choices?.[0]?.message?.content;
if (typeof answer !== 'string') {
  process.stderr.write('openai-compatible adapter: response had no message content\n');
  process.exit(1);
}

process.stdout.write(JSON.stringify({ answer, usage: body.usage }));
