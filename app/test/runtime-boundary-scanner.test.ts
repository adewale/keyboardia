import { describe, expect, it } from 'vitest';
import {
  extractModuleImports,
  extractRelativeImports,
  findBrowserGlobalReferences,
  findExternalImportViolations,
  findImportMetaEnvReferences,
  findModuleEvaluationBrowserGlobals,
  findResourceImportViolations,
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
      import { type SharedState } from './inline-import-type';
      import { encodeMidi, type MidiPlan } from './midi-core.js';
      export { validate } from './validation';
      export { type Player } from './player';
      export type { Cursor } from './cursor';
      type Imported = import('./type-expression').Imported;
      await import('./lazy');
      require('./legacy');
    `);

    expect(imports).toEqual([
      { specifier: './state', typeOnly: true },
      { specifier: './inline-import-type', typeOnly: false },
      { specifier: './midi-core.js', typeOnly: false },
      { specifier: './validation', typeOnly: false },
      { specifier: './player', typeOnly: false },
      { specifier: './cursor', typeOnly: true },
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

  it('uses project bundler resolution for dotted basenames and Vite query suffixes', () => {
    const midiImporter = fileURLToPath(new URL('../src/audio/midiExport.ts', import.meta.url));
    const engineImporter = fileURLToPath(new URL('../src/audio/engine.ts', import.meta.url));

    expect(resolveRelativeCodeImport(midiImporter, './midiExport.types'))
      .toBe(fileURLToPath(new URL('../src/audio/midiExport.types.ts', import.meta.url)));
    expect(resolveRelativeCodeImport(engineImporter, './worklets/pitch-shift.worklet.ts?worker&url'))
      .toBe(fileURLToPath(new URL('../src/audio/worklets/pitch-shift.worklet.ts', import.meta.url)));
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

  it('rejects resolved code imports that terminate outside the production graph', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', "import './copy-paste-range.test.ts';"],
      ]),
    });

    expect(graph.excludedInternalImports).toContainEqual({
      importer: 'shared/constants.ts',
      imported: 'shared/copy-paste-range.test.ts',
      specifier: './copy-paste-range.test.ts',
    });
  });

  it('records package and resource capabilities instead of dropping them', () => {
    expect(extractModuleImports(`
      import 'tone';
      import type { ReactNode } from 'react';
      import './presentation.css';
    `)).toEqual([
      { specifier: 'tone', typeOnly: false },
      { specifier: 'react', typeOnly: true },
      { specifier: './presentation.css', typeOnly: false },
    ]);

    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', "import 'tone'; import './presentation.css';"],
      ]),
    });
    expect(findExternalImportViolations({
      policyName: 'Shared packages',
      imports: graph.externalImports,
      appliesTo: module => module === 'shared/constants.ts',
      isAllowed: () => false,
    })).toEqual(['Shared packages: shared/constants.ts -> package:tone']);
    expect(findResourceImportViolations({
      policyName: 'Shared resources',
      imports: graph.resourceImports,
      appliesTo: module => module === 'shared/constants.ts',
    })).toEqual(['Shared resources: shared/constants.ts -> resource:./presentation.css']);
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

  it('detects browser globals evaluated inside an immediately invoked function', () => {
    const offenders = findModuleEvaluationBrowserGlobals(`
      (() => window.location.href)();
      (function initialise() {
        document.title = 'initialised';
      })();

      export function browserOnlyWhenCalled() {
        return navigator.userAgent;
      }
    `);

    expect(offenders.map(({ global }) => global)).toEqual([
      'window',
      'document',
    ]);
  });

  it('conservatively finds browser capabilities in deferred and eager code without shadow false positives', () => {
    const offenders = findBrowserGlobalReferences(`
      const window = { location: 'local' };
      const { navigator } = source;
      [1].map(() => sessionStorage.length);
      new (class { constructor() { document.title = 'ready'; } })();
      ({ get value() { return localStorage.length; } }).value;
      const worker = new Worker('/worker.js');
      const context = new AudioContext();
      requestAnimationFrame(() => {});
      globalThis['webkitAudioContext'];
      void window.location;
      void navigator;
    `);

    expect(offenders.map(({ global }) => global)).toEqual([
      'sessionStorage',
      'document',
      'localStorage',
      'Worker',
      'AudioContext',
      'requestAnimationFrame',
      'webkitAudioContext',
    ]);
  });

  it('parses import.meta.env syntax and ignores comments and strings', () => {
    const offenders = findImportMetaEnvReferences(`
      // import.meta.env.DEV
      const example = 'import.meta["env"]';
      import.meta.env.DEV;
      import.meta['env'].MODE;
      const meta = import.meta;
      const alias = meta;
      alias.env.PROD;
      const { env } = alias;
    `);

    expect(offenders.map(({ global }) => global)).toEqual([
      'import.meta.env',
      'import.meta.env',
      'import.meta.env',
      'import.meta.env',
    ]);
  });
});
