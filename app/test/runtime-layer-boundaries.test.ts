import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC_ROOT = resolve(APP_ROOT, 'src');
const CANDIDATE_EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

interface ImportEdge {
  importer: string;
  imported: string;
}

function productionModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionModules(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function resolveRelativeImport(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier);
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function relativeModule(path: string): string {
  return relative(SRC_ROOT, path).replaceAll('\\', '/');
}

function collectEdges(): ImportEdge[] {
  return productionModules(SRC_ROOT).flatMap(importer => {
    const source = readFileSync(importer, 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g),
    ].map(([, specifier]) => specifier);

    return specifiers.flatMap(specifier => {
      const imported = resolveRelativeImport(importer, specifier);
      return imported ? [{ importer: relativeModule(importer), imported: relativeModule(imported) }] : [];
    });
  });
}

function boundaryViolations(edges: ImportEdge[]): string[] {
  const violations: string[] = [];

  for (const edge of edges) {
    if (edge.importer.startsWith('worker/')) {
      const forbiddenWorkerTarget = /^(?:components|audio|state|hooks)\//.test(edge.imported)
        || edge.imported === 'types.ts';
      if (forbiddenWorkerTarget) {
        violations.push(`Worker: ${edge.importer} -> ${edge.imported}`);
      }
    }

    if (edge.importer.startsWith('shared/')) {
      const forbiddenSharedTarget = /^(?:components|audio|worker)\//.test(edge.imported)
        || edge.imported === 'types.ts';
      if (forbiddenSharedTarget) {
        violations.push(`Shared: ${edge.importer} -> ${edge.imported}`);
      }
    }

    if (edge.importer.startsWith('state/') && edge.imported.startsWith('audio/')) {
      violations.push(`Serializable state: ${edge.importer} -> ${edge.imported}`);
    }
  }

  return violations.sort();
}

function reachableModules(entry: string, edges: ImportEdge[]): string[] {
  const importsByModule = new Map<string, string[]>();
  for (const { importer, imported } of edges) {
    const imports = importsByModule.get(importer) ?? [];
    imports.push(imported);
    importsByModule.set(importer, imports);
  }

  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const module = queue.pop()!;
    if (seen.has(module)) continue;
    seen.add(module);
    queue.push(...(importsByModule.get(module) ?? []));
  }
  return [...seen].sort();
}

describe('runtime dependency boundaries', () => {
  const modules = productionModules(SRC_ROOT);
  const edges = collectEdges();

  it('scans the real production graph rather than an empty fixture', () => {
    expect(modules.length).toBeGreaterThan(150);
    expect(edges.length).toBeGreaterThan(250);
    expect(edges.some(edge => edge.importer === 'worker/index.ts')).toBe(true);
    expect(edges.some(edge => edge.importer === 'state/grid.tsx')).toBe(true);
  });

  it('keeps Worker, shared domain, and serializable state runtime-neutral', () => {
    expect(boundaryViolations(edges)).toEqual([]);
  });

  it('keeps the complete Worker entry graph out of browser-owned modules', () => {
    const workerGraph = reachableModules('worker/index.ts', edges);
    expect(workerGraph.length).toBeGreaterThan(20);
    expect(workerGraph).toContain('worker/mcp.ts');

    const browserModules = workerGraph.filter(module =>
      /^(?:components|audio|state|hooks)\//.test(module) || module === 'types.ts'
    );
    expect(browserModules).toEqual([]);
  });
});
