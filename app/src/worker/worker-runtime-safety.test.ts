import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards against Vite-only globals reaching the Cloudflare Workers runtime.
 *
 * `import.meta.env` is injected by Vite. It does not exist in workerd, so an
 * unguarded read throws at *module evaluation* — before any handler runs, and
 * only in production. No test catches it on its own: vitest transforms through
 * Vite, and so does vitest-pool-workers, so the global is always defined under
 * test even though it is absent in the deployed Worker.
 *
 * This caught a real 500 on every /mcp request: MIDI export used to reach
 * src/utils/logger.ts through instrument-ID parsing, and that module read
 * `import.meta.env.DEV` at the top level.
 */

const WORKER_ROOT = dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = resolve(WORKER_ROOT, 'index.ts');

const CANDIDATE_EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function readModule(path: string): { resolved: string; source: string } | null {
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = `${path}${extension}`;
    try {
      return { resolved: candidate, source: readFileSync(candidate, 'utf8') };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Comments describe these hazards as often as code commits them — including
 * the comment above this test. Strip them so prose cannot fail the build.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Walks static and dynamic relative imports out from the Worker entry point.
 * Bare specifiers are node_modules and are bundled by esbuild rather than
 * transformed by Vite, so they are out of scope here.
 *
 * Keyed by resolved path, so each module appears once however it was imported.
 */
function collectWorkerModules(entry: string): Map<string, string> {
  const modules = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const module = readModule(path);
    if (!module) continue;
    if (modules.has(module.resolved)) continue;
    modules.set(module.resolved, stripComments(module.source));

    const specifiers = [
      ...module.source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g),
    ].map(([, specifier]) => specifier);

    for (const specifier of specifiers) {
      queue.push(resolve(dirname(module.resolved), specifier));
    }
  }

  return modules;
}

describe('worker runtime safety', () => {
  const modules = collectWorkerModules(WORKER_ENTRY);

  it('reaches the modules it is supposed to be checking', () => {
    // A resolution regression would silently empty this test.
    expect(modules.size).toBeGreaterThan(20);
    expect([...modules.keys()].some((path) => path.endsWith('/worker/mcp.ts'))).toBe(true);
    expect([...modules.keys()].some((path) => path.endsWith('/shared/midi-core.ts'))).toBe(true);
    expect([...modules.keys()].some((path) => path.includes('/audio/'))).toBe(false);
  });

  it('never reads import.meta.env without a guard', () => {
    const offenders: string[] = [];

    for (const [path, source] of modules) {
      for (const [match] of source.matchAll(/import\.meta\.env(\??\.)?/g)) {
        // `import.meta.env?.` is the guarded form; anything else dereferences
        // a value that is undefined in workerd.
        if (!match.includes('?.')) {
          offenders.push(`${path.replace(/.*\/src\//, 'src/')}: ${match}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Same failure mode, different global. Indentation stands in for scope: a
   * module-scope declaration starts at column 0, while the same read inside a
   * function is fine because workerd never evaluates it unless called. That is
   * a heuristic, so treat a pass as "no obvious module-scope read" rather than
   * proof — the import.meta.env check above is the exact one.
   */
  it('never touches browser-only globals at module scope', () => {
    const offenders: string[] = [];
    const browserGlobals = /^(?:const|let|var)\s+\w+\s*=\s*(window|document|localStorage|navigator)\./gm;

    for (const [path, source] of modules) {
      for (const [, global] of source.matchAll(browserGlobals)) {
        offenders.push(`${path.replace(/.*\/src\//, 'src/')}: ${global}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
