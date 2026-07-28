import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- dependency-free ESM eval tooling, checked here rather than by tsc
import {
  buildReceipt,
  canonicalJson,
  createSourceBinding,
  redactCapability,
  verifyReceipt,
  writeReceipt,
} from '../../evals/receipt.mjs';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function committedInputs() {
  const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-receipt-test-'));
  git(root, 'init', '-q');
  const files = [
    ['skill', 'skill/SKILL.md', '# Skill\n'],
    ['manifest', 'evals/manifest.json', '{"version":1}\n'],
    ['runner', 'evals/run.mjs', 'export {};\n'],
    ['receipt_runtime', 'evals/receipt.mjs', 'export {};\n'],
    ['receipt_schema', 'evals/receipt.schema.json', '{}\n'],
    ['answer_adapter', 'evals/adapter.mjs', 'export {};\n'],
  ] as const;
  for (const [, path, content] of files) {
    const absolute = resolve(root, path);
    execFileSync('mkdir', ['-p', resolve(absolute, '..')]);
    writeFileSync(absolute, content);
  }
  git(root, 'add', '.');
  execFileSync('git', [
    '-C', root,
    '-c', 'user.name=Receipt Test',
    '-c', 'user.email=receipt@example.test',
    'commit', '-qm', 'fixture',
  ]);
  const source = createSourceBinding(root, files.map(([role, path]) => ({
    role,
    path,
    bytes: readFileSync(resolve(root, path)),
  })));
  return { root, source };
}

function exampleReceipt() {
  const { root, source } = committedInputs();
  const receipt = buildReceipt({
    source,
    harness: {
      name: 'keyboardia-repo-runner',
      repository: source.repository,
      version: '1',
      git_commit: source.git_commit,
      mode: 'repo-owned',
    },
    invocation: {
      suite: 'receipt-test',
      models: ['test-model'],
      adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
      splits: ['tune'],
      repeats: 1,
      judge: false,
    },
    runs: [{
      model: 'test-model',
      case: 'case-1',
      kind: 'positive',
      split: 'tune',
      variant: 'with_skill',
      repeat: 0,
      ok: true,
      prompt: 'Exact prompt',
      response: 'Exact output',
      trace: [{ name: 'get_session', success: true }],
      assertions: [],
    }],
    summary: { errors: 0 },
  });
  return { root, receipt };
}

describe('eval receipts', () => {
  it('binds committed inputs and content-addresses exact run artifacts', () => {
    const { root, receipt } = exampleReceipt();
    expect(receipt.source.git_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(receipt.source.git_tree).toMatch(/^[0-9a-f]{40}$/);
    expect(receipt.runs[0].prompt_ref).toMatch(/^sha256:/);
    expect(receipt.runs[0].output_ref).toMatch(/^sha256:/);
    expect(receipt.runs[0].trace_ref).toMatch(/^sha256:/);
    expect(receipt.artifacts[receipt.runs[0].prompt_ref].content).toBe('Exact prompt');
    expect(verifyReceipt(receipt, { repoRoot: root })).toEqual([]);

    const path = resolve(root, 'receipt.json');
    writeReceipt(path, receipt);
    expect(JSON.parse(readFileSync(path, 'utf8')).source.git_commit)
      .toBe(receipt.source.git_commit);
  });

  it('detects tampered artifacts and immutable source mismatches', () => {
    const { root, receipt } = exampleReceipt();
    const promptRef = receipt.runs[0].prompt_ref;
    receipt.artifacts[promptRef].content = 'tampered prompt';
    expect(verifyReceipt(receipt, { repoRoot: root }).join('\n')).toContain('content hash mismatch');

    writeFileSync(resolve(root, 'skill/SKILL.md'), '# changed but uncommitted\n');
    expect(() => createSourceBinding(root, [{
      role: 'skill',
      path: 'skill/SKILL.md',
      bytes: readFileSync(resolve(root, 'skill/SKILL.md')),
    }])).toThrow(/does not match/);
  });

  it('fails closed when a registered capability survives in any encoding or key', () => {
    const { source } = committedInputs();
    const capability = '8c991b32-6ed8-4f4f-9433-976e68f62230';
    const encoded = encodeURIComponent(capability).replaceAll('-', '%2D');
    const doubleEncoded = encodeURIComponent(encoded);
    const base = {
      source,
      harness: {
        name: 'keyboardia-repo-runner',
        repository: source.repository,
        version: '1',
        git_commit: source.git_commit,
        mode: 'repo-owned',
      },
      invocation: {
        suite: 'receipt-test',
        models: ['test-model'],
        adapters: [{ role: 'answer', id: 'stub', path: 'evals/adapter.mjs' }],
        splits: ['tune'],
        repeats: 1,
        judge: false,
      },
      summary: {},
      capabilities: new Set([capability]),
    };
    for (const leaked of [capability, encoded, doubleEncoded]) {
      expect(() => buildReceipt({
        ...base,
        runs: [{
          model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
          variant: 'with_skill', repeat: 0, prompt: leaked, response: 'ok', assertions: [],
        }],
      })).toThrow(/edit capability/);
    }
    expect(() => buildReceipt({
      ...base,
      runs: [{
        model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
        variant: 'with_skill', repeat: 0, prompt: 'safe', response: 'ok',
        trace: [{ [doubleEncoded]: 'leaked-key' }], assertions: [],
      }],
    })).toThrow(/edit capability/);

    const safe = redactCapability({ prompt: doubleEncoded, trace: [{ [encoded]: capability }] }, capability);
    expect(JSON.stringify(safe)).not.toContain(capability);
    expect(redactCapability('benign%20URL', capability)).toBe('benign%20URL');
    expect(() => buildReceipt({
      ...base,
      runs: [{
        model: 'test-model', case: 'case-1', kind: 'execution', split: 'tune',
        variant: 'with_skill', repeat: 0, ...safe, response: 'ok', assertions: [],
      }],
    })).not.toThrow();
  });

  it('canonicalizes JSON independently of object insertion order', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));
  });
});
