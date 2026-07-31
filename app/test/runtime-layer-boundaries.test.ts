import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findBrowserGlobalReferences,
  findExternalImportViolations,
  findImportMetaReferences,
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
const musicRoots = graph.modules.filter(module => module.startsWith('music/'));
const stateRoots = graph.modules.filter(module => module.startsWith('state/'));
const stateRuntimeModules = new Set(
  stateRoots.flatMap(root => reachableModules(root, graph.edges, { runtimeOnly: true })),
);
const runtimeCapabilityModules = graph.modules.filter(module =>
  /^(?:worker|shared|music|state)\//.test(module) || stateRuntimeModules.has(module));

const WORKER_PACKAGES = new Set([
  '@modelcontextprotocol/server',
  'cloudflare:workers',
  'react',
  'workers-og',
  'zod',
]);
const SHARED_PACKAGES = new Set(['midi-writer-js']);
const STATE_PACKAGES = new Set(['react']);
const WORKER_TEXT_RESOURCES = new Set([
  '../../public/.well-known/agent-skills/index.json',
  '../../public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md',
]);

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : (parts[0] ?? specifier);
}

function packageIsAllowed(allowed: ReadonlySet<string>, specifier: string): boolean {
  return allowed.has(packageName(specifier));
}

describe('runtime dependency boundaries', () => {
  it('parses and resolves the real production graph without blind spots', () => {
    expect(graph.modules.length).toBeGreaterThan(150);
    expect(graph.edges.length).toBeGreaterThan(250);
    expect(graph.edges.some(edge => edge.importer === 'worker/index.ts')).toBe(true);
    expect(graph.edges.some(edge => edge.importer === 'state/grid.tsx')).toBe(true);
    expect(graph.edges).toContainEqual({
      importer: 'audio/midiExport.ts',
      imported: 'audio/midiExport.worker.ts',
      typeOnly: false,
    });
    expect(graph.externalImports).toContainEqual({
      importer: 'worker/og-image.tsx',
      specifier: 'react/jsx-runtime',
      typeOnly: false,
    });
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

  it('keeps every music module transitively inside music and shared capabilities', () => {
    expect(musicRoots.length).toBeGreaterThan(1);
    expect(findReachabilityViolations({
      policyName: 'Music',
      roots: musicRoots,
      edges: graph.edges,
      isAllowed: module => /^(?:music|shared)\//.test(module),
    })).toEqual([]);
  });

  it('keeps external packages and runtime resources inside explicit capability allow-lists', () => {
    expect(findExternalImportViolations({
      policyName: 'Worker packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('worker/'),
      isAllowed: specifier => packageIsAllowed(WORKER_PACKAGES, specifier),
    })).toEqual([]);
    expect(findExternalImportViolations({
      policyName: 'Shared packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('shared/'),
      isAllowed: specifier => packageIsAllowed(SHARED_PACKAGES, specifier),
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
      appliesTo: module => stateRuntimeModules.has(module),
      isAllowed: specifier => packageIsAllowed(STATE_PACKAGES, specifier),
    })).toEqual([]);
    expect(findResourceImportViolations({
      policyName: 'Runtime-neutral resources',
      imports: graph.resourceImports,
      appliesTo: module => runtimeCapabilityModules.includes(module),
      isAllowed: (specifier, module) =>
        module === 'worker/agent-skills.ts' && WORKER_TEXT_RESOURCES.has(specifier),
    })).toEqual([]);
  });

  it('keeps intrinsic browser and Vite capabilities out of every neutral-owned module', () => {
    const offenders: string[] = [];
    for (const module of runtimeCapabilityModules) {
      const source = readFileSync(resolve(SRC_ROOT, module), 'utf8');
      for (const reference of [
        ...findBrowserGlobalReferences(source, module),
        ...findImportMetaReferences(source, module),
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

  it('carries package capabilities through modules reached from serializable state', () => {
    const mutatedGraph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/pattern-operations.ts', "import 'tone'; export const marker = true;"],
      ]),
    });
    const mutatedStateModules = new Set(
      stateRoots.flatMap(root =>
        reachableModules(root, mutatedGraph.edges, { runtimeOnly: true })),
    );

    expect(findExternalImportViolations({
      policyName: 'State packages',
      imports: mutatedGraph.externalImports,
      appliesTo: module => mutatedStateModules.has(module),
      isAllowed: specifier => packageIsAllowed(STATE_PACKAGES, specifier),
    })).toContain('State packages: shared/pattern-operations.ts -> package:tone');
  });

  it('rejects an indirect music bridge into a client runtime', () => {
    const mutatedGraph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['music/session-analysis.ts', "export * from '../shared/pattern-operations';"],
        ['shared/pattern-operations.ts', "export * from '../audio/engine';"],
      ]),
    });

    expect(findReachabilityViolations({
      policyName: 'Music',
      roots: musicRoots,
      edges: mutatedGraph.edges,
      isAllowed: module => /^(?:music|shared)\//.test(module),
    })).toContain(
      'Music: music/session-analysis.ts -> shared/pattern-operations.ts -> audio/engine.ts',
    );
  });
});
