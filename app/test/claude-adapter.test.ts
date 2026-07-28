import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function invokeAdapter(adapter: string, input: object, binary: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [adapter], {
      cwd: resolve('..'),
      env: { ...process.env, KEYBOARDIA_CLAUDE_BIN: binary },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

describe('Claude answer adapter', () => {
  it('runs the provider in the prepared arm workspace', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-claude-adapter-'));
    const workspace = resolve(root, 'without-skill');
    const binary = resolve(root, 'fake-claude.mjs');
    try {
      writeFileSync(binary, [
        '#!/usr/bin/env node',
        "process.stdin.resume();",
        "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ result: process.cwd(), usage: {} })));",
      ].join('\n'));
      chmodSync(binary, 0o700);
      mkdirSync(workspace);
      const result = await invokeAdapter(
        resolve('../evals/adapters/claude.mjs'),
        { prompt: 'test', model: null, workspace },
        binary,
      );
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(realpathSync(JSON.parse(result.stdout).answer)).toBe(realpathSync(workspace));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
