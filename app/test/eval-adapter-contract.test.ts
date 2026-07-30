/**
 * The adapter contract is the reason these evals are not tied to one vendor.
 *
 * It is shared verbatim with skill-eval-harness's `run-subagent --agent-cmd`, so
 * a single adapter script drives both runners. If the envelope drifts, every
 * third-party adapter breaks silently and the evals quietly become
 * Claude-only — which is exactly what this guards.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- dependency-free ESM adapter helper, checked here rather than by tsc
import { numericUsage } from '../../evals/adapters/usage.mjs';
// @ts-expect-error -- dependency-free ESM adapter helper, checked here rather than by tsc
import {
  toolResultStructuredContent,
  toolResultSucceeded,
} from '../../evals/adapters/mcp-trace.mjs';

const adaptersDir = resolve('../evals/adapters');

function invoke(adapter: string, payload: Record<string, unknown>): string {
  return execFileSync('node', [resolve(adaptersDir, adapter)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

describe('eval adapter contract', () => {
  it('ships adapters for more than one provider', () => {
    const adapters = readdirSync(adaptersDir).filter((name) => name.endsWith('.mjs'));

    // Losing the vendor-neutral adapters would leave the CLI-specific one as the
    // only worked example, which is how a suite drifts into single-vendor.
    expect(adapters).toContain('stub.mjs');
    expect(adapters).toContain('openai-compatible.mjs');
    expect(adapters.length).toBeGreaterThanOrEqual(3);
  });

  it('reads the documented request and answers with the documented envelope', () => {
    const stdout = invoke('stub.mjs', {
      prompt: 'Return a call plan.',
      model: null,
      workspace: '/tmp',
    });
    const parsed = JSON.parse(stdout) as { answer: string };

    expect(parsed.answer).toBeTypeOf('string');
    expect(parsed.answer.length).toBeGreaterThan(0);
  });

  it('answers a judge request with a parseable verdict', () => {
    const stdout = invoke('stub.mjs', {
      prompt: '<answer-under-review>\nsome answer\n</answer-under-review>',
      model: null,
      workspace: '/tmp',
    });
    const verdict = JSON.parse(JSON.parse(stdout).answer) as { passed: boolean; score: number };

    expect(verdict.passed).toBeTypeOf('boolean');
    expect(verdict.score).toBeTypeOf('number');
  });

  it('documents the same envelope the harness runner speaks', () => {
    // Both sides must keep saying the same thing, or the "one adapter, two
    // runners" claim in evals/README.md silently stops being true.
    const readme = readFileSync(resolve('../evals/README.md'), 'utf8');

    for (const field of ['"prompt"', '"model"', '"workspace"', '"answer"']) {
      expect(readme, field).toContain(field);
    }
    expect(readme).toContain('run-subagent --agent-cmd');
  });

  it('keeps provider labels out of numeric harness telemetry', () => {
    expect(numericUsage({
      input_tokens: 12,
      output_tokens: 4,
      service_tier: 'standard',
      cache: { read_tokens: 3, mode: 'ephemeral' },
    })).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      cache: { read_tokens: 3 },
    });
  });

  it('correlates tool results without mistaking user text for MCP errors', () => {
    expect(toolResultSucceeded({ is_error: true, content: 'failed' })).toBe(false);
    expect(toolResultSucceeded({
      content: [{ type: 'text', text: '{"isError":true}' }],
    })).toBe(false);
    expect(toolResultSucceeded({
      content: [{ type: 'text', text: '{"structuredContent":{"name":"{\\"isError\\":true}"}}' }],
    })).toBe(true);
    expect(toolResultStructuredContent({
      content: [{ type: 'text', text: '{"session_id":"s","tempo":120,"tracks":[]}' }],
    })).toEqual({ session_id: 's', tempo: 120, tracks: [] });
  });
});
