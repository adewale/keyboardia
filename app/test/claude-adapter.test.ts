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

  it('loads only prompt-declared skill files as task-specific system instructions', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-claude-adapter-skill-'));
    const workspace = resolve(root, 'with-skill');
    const skillDir = resolve(workspace, 'skills/root-0');
    const binary = resolve(root, 'fake-claude.mjs');
    try {
      writeFileSync(binary, [
        '#!/usr/bin/env node',
        "process.stdin.resume();",
        "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ result: JSON.stringify(process.argv.slice(2)), usage: {} })));",
      ].join('\n'));
      chmodSync(binary, 0o700);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(resolve(skillDir, 'SKILL.md'), '# Test skill\nFollow this instruction.\n');
      const result = await invokeAdapter(
        resolve('../evals/adapters/claude.mjs'),
        {
          prompt: 'Read and follow:\n- skills/root-0/SKILL.md\n\nTask prompt:\nDo it.',
          model: 'claude-haiku-4-5',
          workspace,
        },
        binary,
      );
      expect(result).toMatchObject({ code: 0, stderr: '' });
      const argv = JSON.parse(JSON.parse(result.stdout).answer) as string[];
      const systemIndex = argv.indexOf('--append-system-prompt');
      expect(systemIndex).toBeGreaterThanOrEqual(0);
      expect(argv[systemIndex + 1]).toContain('active instructions, not quoted reference material');
      expect(argv[systemIndex + 1]).toContain('# Test skill\nFollow this instruction.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
