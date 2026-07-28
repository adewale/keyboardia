import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findReachabilityViolations,
  reachableModules,
  scanProductionGraph,
} from './runtime-boundary-scanner';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC_ROOT = resolve(APP_ROOT, 'src');
const graph = scanProductionGraph(SRC_ROOT);

const workerRoots = graph.modules.filter(module => module.startsWith('worker/'));
const sharedRoots = graph.modules.filter(module => module.startsWith('shared/'));
const stateRoots = graph.modules.filter(module => module.startsWith('state/'));

describe('runtime dependency boundaries', () => {
  it('parses and resolves the real production graph without blind spots', () => {
    expect(graph.modules.length).toBeGreaterThan(150);
    expect(graph.edges.length).toBeGreaterThan(250);
    expect(graph.edges.some(edge => edge.importer === 'worker/index.ts')).toBe(true);
    expect(graph.edges.some(edge => edge.importer === 'state/grid.tsx')).toBe(true);
    expect(graph.parseFailures).toEqual([]);
    expect(graph.unresolvedRelativeImports).toEqual([]);
    expect(graph.unanalyzableModuleReferences).toEqual([]);
  });

  it('keeps every Worker module inside Worker, shared, and pure music capabilities', () => {
    expect(findReachabilityViolations({
      policyName: 'Worker',
      roots: workerRoots,
      edges: graph.edges,
      isAllowed: module => /^(?:worker|shared|music)\//.test(module),
    })).toEqual([]);

    const entryGraph = reachableModules('worker/index.ts', graph.edges, { runtimeOnly: true });
    expect(entryGraph.length).toBeGreaterThan(20);
    expect(entryGraph).toContain('worker/mcp.ts');
    expect(entryGraph).toContain('shared/midi-core.ts');
  });

  it('keeps every shared module transitively inside the shared capability', () => {
    expect(sharedRoots.length).toBeGreaterThan(10);
    expect(findReachabilityViolations({
      policyName: 'Shared',
      roots: sharedRoots,
      edges: graph.edges,
      isAllowed: module => module.startsWith('shared/'),
    })).toEqual([]);
  });

  it('keeps every state module transitively out of the live audio runtime', () => {
    expect(stateRoots.length).toBeGreaterThan(1);
    expect(findReachabilityViolations({
      policyName: 'Serializable state',
      roots: stateRoots,
      edges: graph.edges,
      isAllowed: module => !module.startsWith('audio/'),
    })).toEqual([]);
  });
});
