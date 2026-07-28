import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findModuleEvaluationBrowserGlobals,
  reachableModules,
  scanProductionGraph,
} from '../../test/runtime-boundary-scanner';

/**
 * Guards against browser/Vite-only globals reaching Cloudflare Worker module
 * evaluation. Vitest transforms through Vite, so only an explicit production
 * graph check catches this failure mode before deployment.
 *
 * This caught a real 500 on every /mcp request: MIDI export once reached
 * src/utils/logger.ts, which read `import.meta.env.DEV` at module scope.
 */

const SRC_ROOT = fileURLToPath(new URL('../', import.meta.url));
const graph = scanProductionGraph(SRC_ROOT);
const workerModules = reachableModules('worker/index.ts', graph.edges, { runtimeOnly: true });

describe('worker runtime safety', () => {
  it('resolves the non-trivial Worker runtime graph without silently dropping imports', () => {
    expect(graph.parseFailures).toEqual([]);
    expect(graph.unresolvedRelativeImports).toEqual([]);
    expect(graph.unanalyzableModuleReferences).toEqual([]);
    expect(workerModules.length).toBeGreaterThan(20);
    expect(workerModules).toContain('worker/mcp.ts');
    expect(workerModules).toContain('shared/midi-core.ts');
    expect(workerModules.some(module => module.startsWith('audio/'))).toBe(false);
  });

  it('never reads import.meta.env without a guard', () => {
    const offenders: string[] = [];

    for (const module of workerModules) {
      const source = readFileSync(resolve(SRC_ROOT, module), 'utf8');
      for (const [match] of source.matchAll(/import\.meta\.env(\??\.)?/g)) {
        if (!match.includes('?.')) offenders.push(`src/${module}: ${match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never touches browser-only globals while evaluating a module', () => {
    const offenders: string[] = [];

    for (const module of workerModules) {
      const source = readFileSync(resolve(SRC_ROOT, module), 'utf8');
      for (const reference of findModuleEvaluationBrowserGlobals(source, module)) {
        offenders.push(
          `src/${module}:${reference.line}:${reference.column}: ${reference.global}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
