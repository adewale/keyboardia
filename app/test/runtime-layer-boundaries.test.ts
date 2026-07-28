import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findBrowserGlobalReferences,
  findExternalImportViolations,
  findImportMetaEnvReferences,
  findReachabilityViolations,
  findResourceImportViolations,
  reachableModules,
  scanProductionGraph,
} from './runtime-boundary-scanner';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC_ROOT = resolve(APP_ROOT, 'src');
const graph = scanProductionGraph(SRC_ROOT);

const workerRoots = graph.modules.filter(module => module.startsWith('worker/'));
const sharedRoots = graph.modules.filter(module => module.startsWith('shared/'));
const stateRoots = graph.modules.filter(module => module.startsWith('state/'));
const runtimeNeutralRoots = graph.modules.filter(module => /^(?:worker|shared|music)\//.test(module));

const WORKER_PACKAGES = new Set([
  '@modelcontextprotocol/server',
  'cloudflare:workers',
  'react',
  'workers-og',
  'zod',
]);
const SHARED_PACKAGES = new Set(['midi-writer-js']);
const STATE_PACKAGES = new Set(['react']);

describe('runtime dependency boundaries', () => {
  it('parses and resolves the real production graph without blind spots', () => {
    expect(graph.modules.length).toBeGreaterThan(150);
    expect(graph.edges.length).toBeGreaterThan(250);
    expect(graph.edges.some(edge => edge.importer === 'worker/index.ts')).toBe(true);
    expect(graph.edges.some(edge => edge.importer === 'state/grid.tsx')).toBe(true);
    expect(graph.parseFailures).toEqual([]);
    expect(graph.unresolvedRelativeImports).toEqual([]);
    expect(graph.unanalyzableModuleReferences).toEqual([]);
    expect(graph.excludedInternalImports).toEqual([]);
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

  it('keeps external packages and runtime resources inside explicit capability allow-lists', () => {
    expect(findExternalImportViolations({
      policyName: 'Worker packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('worker/'),
      isAllowed: specifier => WORKER_PACKAGES.has(specifier),
    })).toEqual([]);
    expect(findExternalImportViolations({
      policyName: 'Shared packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('shared/'),
      isAllowed: specifier => SHARED_PACKAGES.has(specifier),
    })).toEqual([]);
    expect(findExternalImportViolations({
      policyName: 'Music packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('music/'),
      isAllowed: () => false,
    })).toEqual([]);
    expect(findExternalImportViolations({
      policyName: 'State packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('state/'),
      isAllowed: specifier => STATE_PACKAGES.has(specifier),
    })).toEqual([]);
    expect(findResourceImportViolations({
      policyName: 'Runtime-neutral resources',
      imports: graph.resourceImports,
      appliesTo: module => /^(?:worker|shared|music|state)\//.test(module),
    })).toEqual([]);
  });

  it('keeps intrinsic browser and Vite capabilities out of every neutral-owned module', () => {
    const offenders: string[] = [];
    for (const module of runtimeNeutralRoots) {
      const source = readFileSync(resolve(SRC_ROOT, module), 'utf8');
      for (const reference of [
        ...findBrowserGlobalReferences(source, module),
        ...findImportMetaEnvReferences(source, module),
      ]) {
        offenders.push(`src/${module}:${reference.line}:${reference.column}: ${reference.global}`);
      }
    }
    expect(offenders).toEqual([]);
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
