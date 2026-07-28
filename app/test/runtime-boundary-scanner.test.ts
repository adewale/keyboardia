import { describe, expect, it } from 'vitest';
import {
  extractModuleImports,
  extractRelativeImports,
  findBrowserGlobalReferences,
  findExternalImportViolations,
  findImportMetaReferences,
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

  it('records Vite URL workers and compiler-emitted JSX runtime imports', () => {
    expect(extractModuleImports(`
      const worker = new Worker(new URL('./midi.worker.ts', import.meta.url));
      export const View = () => <div />;
    `, 'view.tsx')).toEqual([
      { specifier: './midi.worker.ts', typeOnly: false },
      { specifier: 'react/jsx-runtime', typeOnly: false },
    ]);

    expect(extractModuleImports(
      'export const View = () => <div />;',
      'view.jsx',
    )).toEqual([{ specifier: 'react/jsx-runtime', typeOnly: false }]);

    expect(extractModuleImports(`
      /** @jsxImportSource tone */
      export const View = () => <div />;
    `, 'worker-view.tsx')).toEqual([
      { specifier: 'tone/jsx-runtime', typeOnly: false },
    ]);

    expect(extractModuleImports(`
      /** @jsxRuntime classic */
      export const View = () => <div />;
    `, 'classic-view.tsx')).toEqual([]);
  });

  it('classifies package asset subpaths as both package and resource capabilities', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', `
          import 'midi-writer-js/package.json';
          import 'midi-writer-js/build/index.js?raw';
          import './pattern-operations.ts?worker';
        `],
      ]),
    });

    expect(graph.externalImports).toContainEqual({
      importer: 'shared/constants.ts',
      specifier: 'midi-writer-js/package.json',
      typeOnly: false,
    });
    expect(graph.resourceImports).toContainEqual({
      importer: 'shared/constants.ts',
      specifier: 'midi-writer-js/package.json',
    });
    expect(graph.resourceImports).toContainEqual({
      importer: 'shared/constants.ts',
      specifier: 'midi-writer-js/build/index.js?raw',
    });
    expect(graph.resourceImports).toContainEqual({
      importer: 'shared/constants.ts',
      specifier: './pattern-operations.ts?worker',
    });
    expect(findResourceImportViolations({
      policyName: 'Shared resources',
      imports: graph.resourceImports,
      appliesTo: module => module === 'shared/constants.ts',
    })).toContain(
      'Shared resources: shared/constants.ts -> resource:midi-writer-js/package.json',
    );
  });

  it('rejects a Worker JSX pragma that selects an unapproved runtime package', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['worker/og-image.tsx', `
          /** @jsxImportSource tone */
          export const Image = () => <div />;
        `],
      ]),
    });

    expect(graph.externalImports).toContainEqual({
      importer: 'worker/og-image.tsx',
      specifier: 'tone/jsx-runtime',
      typeOnly: false,
    });
    expect(findExternalImportViolations({
      policyName: 'Worker packages',
      imports: graph.externalImports,
      appliesTo: module => module.startsWith('worker/'),
      isAllowed: specifier => specifier === 'react' || specifier.startsWith('react/'),
    })).toContain(
      'Worker packages: worker/og-image.tsx -> package:tone/jsx-runtime',
    );
  });

  it('makes Vite module references loud when their target cannot be statically resolved', () => {
    const graph = scanProductionGraph(SRC_ROOT, {
      sourceOverrides: new Map([
        ['shared/constants.ts', `
          const modules = import.meta.glob('../audio/*.ts');
          const url = new URL(getWorkerPath(), import.meta.url);
          void modules;
          void url;
        `],
      ]),
    });

    expect(graph.unanalyzableModuleReferences).toEqual(expect.arrayContaining([
      {
        importer: 'shared/constants.ts',
        expression: "import.meta.glob('../audio/*.ts')",
      },
      {
        importer: 'shared/constants.ts',
        expression: 'new URL(getWorkerPath(), import.meta.url)',
      },
    ]));
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

  it('finds destructured, ambient-shadowed, storage, worker, and audio browser capabilities', () => {
    const offenders = findBrowserGlobalReferences(`
      declare const window: { location: string };
      void window.location;
      const { Worker: BrowserWorker } = globalThis;
      new BrowserWorker('/worker.js');
      const { Worker: SelfWorker } = self;
      new SelfWorker('/self-worker.js');
      const root = globalThis;
      root.document.title = 'ready';
      (globalThis as unknown as { window: Window }).window.location;
      let AssignedWorker;
      ({ Worker: AssignedWorker } = globalThis);
      function createWorker({ Worker: DefaultWorker } = globalThis) {
        return new DefaultWorker('/default-worker.js');
      }
      new OfflineAudioContext(2, 128, 44100);
      new SharedWorker('/shared-worker.js');
      new Audio('/sample.mp3');
      new XMLHttpRequest();
      new DOMParser();
      indexedDB.open('session');
      void location.href;
      const { navigator: nav } = source;
      void nav;
    `);

    expect(offenders.map(({ global }) => global)).toEqual([
      'window',
      'Worker',
      'self',
      'globalThis',
      'globalThis',
      'globalThis',
      'globalThis',
      'OfflineAudioContext',
      'SharedWorker',
      'Audio',
      'XMLHttpRequest',
      'DOMParser',
      'indexedDB',
      'location',
    ]);
  });

  it('derives DOM namespaces and treats source ambient values as runtime capabilities', () => {
    const offenders = findBrowserGlobalReferences(`
      declare const chrome: { runtime: unknown };
      void CSS.supports('display', 'grid');
      void chrome.runtime;
    `);

    expect(offenders.map(({ global }) => global)).toEqual(['CSS', 'chrome']);
  });

  it('does not confuse ECMAScript globals, labels, or local globalThis bindings with browser APIs', () => {
    const offenders = findBrowserGlobalReferences(`
      toString();
      open: for (;;) {
        break open;
      }
      const globalThis = { document: 1 };
      void globalThis.document;
    `);

    expect(offenders).toEqual([]);
    expect(findBrowserGlobalReferences(`
      const { globalThis } = source;
      void globalThis.document;
    `)).toEqual([]);
  });

  it('rejects every import.meta capability without alias or shadowing blind spots', () => {
    const offenders = findImportMetaReferences(`
      // import.meta.env.DEV
      const example = 'import.meta["env"]';
      import.meta.env.DEV;
      let assigned;
      assigned = import.meta;
      const { ['env']: viteEnv } = import.meta;
      const holder = { meta: import.meta };
      ((meta) => meta.env.DEV)(import.meta);
      const modules = import.meta.glob('../audio/*.ts');
      {
        const meta = { env: { DEV: false } };
        void meta.env.DEV;
      }
      void assigned;
      void viteEnv;
      void holder;
      void modules;
    `);

    expect(offenders.map(({ global }) => global)).toEqual(
      Array(6).fill('import.meta'),
    );
  });
});
