import { describe, expect, it } from 'vitest';
import {
  extractRelativeImports,
  findModuleEvaluationBrowserGlobals,
  findReachabilityViolations,
  resolveRelativeCodeImport,
  scanProductionGraph,
  type ImportEdge,
} from './runtime-boundary-scanner';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));

describe('runtime boundary scanner', () => {
  it('parses imports as syntax rather than matching comments and strings', () => {
    const imports = extractRelativeImports(`
      // import './commented-out';
      const example = "import './inside-a-string'";
      import type { Session } from './state';
      import { encodeMidi, type MidiPlan } from './midi-core.js';
      export { validate } from './validation';
      export { type Player } from './player';
      type Imported = import('./type-expression').Imported;
      await import('./lazy');
      require('./legacy');
    `);

    expect(imports).toEqual([
      { specifier: './state', typeOnly: true },
      { specifier: './midi-core.js', typeOnly: false },
      { specifier: './validation', typeOnly: false },
      { specifier: './player', typeOnly: true },
      { specifier: './type-expression', typeOnly: true },
      { specifier: './lazy', typeOnly: false },
      { specifier: './legacy', typeOnly: false },
    ]);
  });

  it('uses bundler resolution so a .js specifier resolves to its .ts source', () => {
    const importer = fileURLToPath(new URL('../src/worker/index.ts', import.meta.url));
    const resolved = resolveRelativeCodeImport(importer, '../shared/midi-core.js');

    expect(resolved).toBe(fileURLToPath(new URL('../src/shared/midi-core.ts', import.meta.url)));
  });

  it('reports unresolved relative code imports instead of silently dropping them', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', "import './definitely-missing.js';"],
      ]),
    });

    expect(graph.unresolvedRelativeImports).toContainEqual({
      importer: 'shared/constants.ts',
      specifier: './definitely-missing.js',
    });
  });

  it('reports non-literal module loading that a static graph cannot resolve', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', 'const target = getTarget(); void import(target);'],
      ]),
    });

    expect(graph.unanalyzableModuleReferences).toContainEqual({
      importer: 'shared/constants.ts',
      expression: 'import(target)',
    });
  });

  it('reports a forbidden dependency path even when an allowed-looking bridge hides it', () => {
    const edges: ImportEdge[] = [
      { importer: 'shared/core.ts', imported: 'utils/bridge.ts', typeOnly: false },
      { importer: 'utils/bridge.ts', imported: 'audio/engine.ts', typeOnly: false },
    ];

    expect(findReachabilityViolations({
      policyName: 'Shared',
      roots: ['shared/core.ts'],
      edges,
      isAllowed: module => module.startsWith('shared/'),
    })).toEqual([
      'Shared: shared/core.ts -> utils/bridge.ts',
    ]);
  });

  it('detects browser globals evaluated at module scope, including API calls', () => {
    const offenders = findModuleEvaluationBrowserGlobals(`
      window.addEventListener('load', () => {});
      export const title = document.title;
      const storage = globalThis.localStorage;
      export function browserOnlyWhenCalled() {
        return navigator.userAgent;
      }
    `);

    expect(offenders.map(({ global }) => global)).toEqual([
      'window',
      'document',
      'localStorage',
    ]);
  });
});
