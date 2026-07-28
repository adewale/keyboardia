import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface RelativeImport {
  specifier: string;
  typeOnly: boolean;
}

export interface ImportEdge {
  importer: string;
  imported: string;
  typeOnly: boolean;
}

export interface ExternalImportEdge {
  importer: string;
  specifier: string;
  typeOnly: boolean;
}

export interface ResourceImportEdge {
  importer: string;
  specifier: string;
}

export interface ExcludedInternalImport {
  importer: string;
  imported: string;
  specifier: string;
}

export interface UnresolvedRelativeImport {
  importer: string;
  specifier: string;
}

export interface ParseFailure {
  module: string;
  message: string;
}

export interface UnanalyzableModuleReference {
  importer: string;
  expression: string;
}

export interface ProductionGraph {
  modules: string[];
  edges: ImportEdge[];
  externalImports: ExternalImportEdge[];
  resourceImports: ResourceImportEdge[];
  excludedInternalImports: ExcludedInternalImport[];
  unresolvedRelativeImports: UnresolvedRelativeImport[];
  unanalyzableModuleReferences: UnanalyzableModuleReference[];
  parseFailures: ParseFailure[];
}

export interface ScanOptions {
  /** Test-only source replacement, keyed by path relative to the source root. */
  sourceOverrides?: ReadonlyMap<string, string>;
}

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

function loadCompilerOptions(configName: string): ts.CompilerOptions {
  const configPath = resolve(APP_ROOT, configName);
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, APP_ROOT, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error =>
      ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  }
  return parsed.options;
}

const APP_COMPILER_OPTIONS = loadCompilerOptions('tsconfig.app.json');
const WORKER_COMPILER_OPTIONS = loadCompilerOptions('tsconfig.worker.json');

function compilerOptionsFor(importer: string): ts.CompilerOptions {
  return normalized(importer).includes('/src/worker/')
    ? WORKER_COMPILER_OPTIONS
    : APP_COMPILER_OPTIONS;
}

const CODE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const RESOURCE_EXTENSIONS = new Set([
  '.avif', '.css', '.flac', '.gif', '.ico', '.jpeg', '.jpg', '.json', '.less',
  '.mp3', '.ogg', '.otf', '.png', '.sass', '.scss', '.svg', '.ttf', '.wasm',
  '.wav', '.webp', '.woff', '.woff2',
]);

function normalized(path: string): string {
  return path.replaceAll('\\', '/');
}

function stringLiteralText(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function importTypeLiteralText(node: ts.ImportTypeNode): string | null {
  return ts.isLiteralTypeNode(node.argument)
    ? stringLiteralText(node.argument.literal)
    : stringLiteralText(node.argument);
}

function importClauseIsTypeOnly(clause: ts.ImportClause | undefined): boolean {
  // Under verbatimModuleSyntax, inline `import { type A }` is emitted as
  // `import {} from ...` and still evaluates the imported module. Only a
  // clause-level `import type` is erased from the runtime graph.
  return clause?.isTypeOnly ?? false;
}

function exportDeclarationIsTypeOnly(declaration: ts.ExportDeclaration): boolean {
  // Likewise, inline `export { type A } from ...` retains a runtime module
  // request; only `export type { A } from ...` is erased.
  return declaration.isTypeOnly;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  switch (extname(fileName).toLowerCase()) {
    case '.js':
    case '.cjs':
    case '.mjs':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.tsx':
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function isImportMetaProperty(
  node: ts.Node | undefined,
  property: string,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (!node) return false;
  if (ts.isPropertyAccessExpression(node)) {
    return isImportMeta(node.expression) && node.name.text === property;
  }
  return ts.isElementAccessExpression(node)
    && isImportMeta(node.expression)
    && stringLiteralText(node.argumentExpression) === property;
}

function jsxRuntimeSpecifier(
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
): string | null {
  if (compilerOptions.jsx !== ts.JsxEmit.ReactJSX
    && compilerOptions.jsx !== ts.JsxEmit.ReactJSXDev) {
    return null;
  }

  let containsJsx = false;
  const findJsx = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      containsJsx = true;
      return;
    }
    ts.forEachChild(node, findJsx);
  };
  findJsx(sourceFile);
  if (!containsJsx) return null;

  const source = (compilerOptions.jsxImportSource ?? 'react').replace(/\/$/, '');
  const runtime = compilerOptions.jsx === ts.JsxEmit.ReactJSXDev
    ? 'jsx-dev-runtime'
    : 'jsx-runtime';
  return `${source}/${runtime}`;
}

/** Extracts real module references from the TypeScript syntax tree. */
export function extractModuleImports(
  source: string,
  fileName = 'module.ts',
): RelativeImport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  const imports: RelativeImport[] = [];

  const add = (specifier: string | null, typeOnly: boolean): void => {
    if (specifier !== null) imports.push({ specifier, typeOnly });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(stringLiteralText(node.moduleSpecifier), importClauseIsTypeOnly(node.importClause));
      return;
    }
    if (ts.isExportDeclaration(node)) {
      add(stringLiteralText(node.moduleSpecifier), exportDeclarationIsTypeOnly(node));
      return;
    }
    if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)) {
      add(stringLiteralText(node.moduleReference.expression), node.isTypeOnly);
      return;
    }
    if (ts.isImportTypeNode(node)) {
      add(importTypeLiteralText(node), true);
      return;
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        add(stringLiteralText(node.arguments[0]), false);
        return;
      }
    }
    if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'URL'
      && isImportMetaProperty(node.arguments?.[1], 'url')) {
      const specifier = stringLiteralText(node.arguments?.[0]);
      if (specifier?.startsWith('.')) add(specifier, false);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  add(jsxRuntimeSpecifier(sourceFile, compilerOptionsFor(fileName)), false);
  return imports;
}

/** Compatibility helper for callers interested only in internal references. */
export function extractRelativeImports(
  source: string,
  fileName = 'module.ts',
): RelativeImport[] {
  return extractModuleImports(source, fileName)
    .filter(({ specifier }) => specifier.startsWith('.'));
}

function findUnanalyzableModuleReferences(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  const references: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && stringLiteralText(node.arguments[0]) === null) {
        references.push(node.getText(sourceFile));
        return;
      }
      if ((ts.isPropertyAccessExpression(node.expression)
          || ts.isElementAccessExpression(node.expression))
        && isImportMeta(node.expression.expression)
        && (ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text === 'glob' || node.expression.name.text === 'globEager'
          : ['glob', 'globEager'].includes(
            stringLiteralText(node.expression.argumentExpression) ?? '',
          ))) {
        // Vite globs can expand to many modules. Until the scanner implements
        // that expansion, retaining the expression as unanalyzable is safer
        // than silently pretending the graph is closed.
        references.push(node.getText(sourceFile));
        return;
      }
    }
    if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'URL'
      && isImportMetaProperty(node.arguments?.[1], 'url')
      && stringLiteralText(node.arguments?.[0]) === null) {
      references.push(node.getText(sourceFile));
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function sourceSpecifier(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0];
}

function isResourceSpecifier(specifier: string): boolean {
  return RESOURCE_EXTENSIONS.has(extname(sourceSpecifier(specifier)).toLowerCase());
}

function isCodePath(path: string): boolean {
  return CODE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Resolves exactly as the application's TypeScript bundler configuration does. */
export function resolveRelativeCodeImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  // Vite query suffixes select a loader; TypeScript resolution still applies
  // to the source path before the query (for example `?worker&url`).
  const result = ts.resolveModuleName(
    sourceSpecifier(specifier),
    importer,
    compilerOptionsFor(importer),
    ts.sys,
  );
  const resolved = result.resolvedModule?.resolvedFileName;
  return resolved && isCodePath(resolved) ? resolve(resolved) : null;
}

export function productionModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionModules(path);
    if (!isCodePath(entry.name)
      || /(?:\.test|\.stories|\.bench)\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)
      || /\.d\.(?:[cm]?ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [path];
  }).sort();
}

function relativeModule(sourceRoot: string, path: string): string {
  return normalized(relative(sourceRoot, path));
}

/** Builds the complete internal TypeScript import graph and retains scan failures. */
export function scanProductionGraph(
  sourceRoot: string,
  options: ScanOptions = {},
): ProductionGraph {
  const modulePaths = productionModules(sourceRoot);
  const modulePathSet = new Set(modulePaths.map(path => resolve(path)));
  const edges: ImportEdge[] = [];
  const externalImports: ExternalImportEdge[] = [];
  const resourceImports: ResourceImportEdge[] = [];
  const excludedInternalImports: ExcludedInternalImport[] = [];
  const unresolvedRelativeImports: UnresolvedRelativeImport[] = [];
  const unanalyzableModuleReferences: UnanalyzableModuleReference[] = [];
  const parseFailures: ParseFailure[] = [];

  for (const importerPath of modulePaths) {
    const importer = relativeModule(sourceRoot, importerPath);
    const source = options.sourceOverrides?.get(importer) ?? readFileSync(importerPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      importerPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(importerPath),
    );
    for (const diagnostic of sourceFile.parseDiagnostics) {
      parseFailures.push({
        module: importer,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      });
    }

    for (const expression of findUnanalyzableModuleReferences(source, importerPath)) {
      unanalyzableModuleReferences.push({ importer, expression });
    }

    for (const importedReference of extractModuleImports(source, importerPath)) {
      if (!importedReference.specifier.startsWith('.')) {
        externalImports.push({
          importer,
          specifier: importedReference.specifier,
          typeOnly: importedReference.typeOnly,
        });
        continue;
      }

      const resolved = resolveRelativeCodeImport(importerPath, importedReference.specifier);
      if (!resolved) {
        if (isResourceSpecifier(importedReference.specifier)) {
          if (!importedReference.typeOnly) {
            resourceImports.push({ importer, specifier: importedReference.specifier });
          }
          continue;
        }
        unresolvedRelativeImports.push({
          importer,
          specifier: importedReference.specifier,
        });
        continue;
      }

      if (!modulePathSet.has(resolved)) {
        // Declaration-only targets are compile-time dependencies when imported
        // with a clause-level `import type`; they have no runtime graph node.
        if (importedReference.typeOnly && /\.d\.(?:[cm]?ts|tsx)$/.test(resolved)) continue;
        excludedInternalImports.push({
          importer,
          imported: relativeModule(sourceRoot, resolved),
          specifier: importedReference.specifier,
        });
        continue;
      }
      edges.push({
        importer,
        imported: relativeModule(sourceRoot, resolved),
        typeOnly: importedReference.typeOnly,
      });
    }
  }

  return {
    modules: modulePaths.map(path => relativeModule(sourceRoot, path)),
    edges,
    externalImports: externalImports.sort((a, b) =>
      `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`)),
    resourceImports: resourceImports.sort((a, b) =>
      `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`)),
    excludedInternalImports: excludedInternalImports.sort((a, b) =>
      `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`)),
    unresolvedRelativeImports: unresolvedRelativeImports.sort((a, b) =>
      `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`)),
    unanalyzableModuleReferences: unanalyzableModuleReferences.sort((a, b) =>
      `${a.importer}:${a.expression}`.localeCompare(`${b.importer}:${b.expression}`)),
    parseFailures: parseFailures.sort((a, b) => a.module.localeCompare(b.module)),
  };
}

export function reachableModules(
  entry: string,
  edges: readonly ImportEdge[],
  options: { runtimeOnly?: boolean } = {},
): string[] {
  const importsByModule = new Map<string, string[]>();
  for (const edge of edges) {
    if (options.runtimeOnly && edge.typeOnly) continue;
    const imports = importsByModule.get(edge.importer) ?? [];
    imports.push(edge.imported);
    importsByModule.set(edge.importer, imports);
  }

  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const module = queue.shift()!;
    if (seen.has(module)) continue;
    seen.add(module);
    queue.push(...(importsByModule.get(module) ?? []));
  }
  return [...seen].sort();
}

interface ReachabilityPolicy {
  policyName: string;
  roots: readonly string[];
  edges: readonly ImportEdge[];
  isAllowed: (module: string) => boolean;
  runtimeOnly?: boolean;
}

/** Reports the first forbidden boundary crossing with its complete import path. */
export function findReachabilityViolations(policy: ReachabilityPolicy): string[] {
  const importsByModule = new Map<string, string[]>();
  for (const edge of policy.edges) {
    if (policy.runtimeOnly && edge.typeOnly) continue;
    const imports = importsByModule.get(edge.importer) ?? [];
    imports.push(edge.imported);
    importsByModule.set(edge.importer, imports);
  }

  const violations = new Set<string>();
  for (const root of policy.roots) {
    const queue: string[][] = [[root]];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const path = queue.shift()!;
      const module = path.at(-1)!;
      if (seen.has(module)) continue;
      seen.add(module);
      for (const imported of importsByModule.get(module) ?? []) {
        const importedPath = [...path, imported];
        if (!policy.isAllowed(imported)) {
          violations.add(`${policy.policyName}: ${importedPath.join(' -> ')}`);
          continue;
        }
        queue.push(importedPath);
      }
    }
  }
  return [...violations].sort();
}

interface ExternalImportPolicy {
  policyName: string;
  imports: readonly ExternalImportEdge[];
  appliesTo: (module: string) => boolean;
  isAllowed: (specifier: string, module: string) => boolean;
}

export function findExternalImportViolations(policy: ExternalImportPolicy): string[] {
  return policy.imports
    .filter(edge => policy.appliesTo(edge.importer)
      && !policy.isAllowed(edge.specifier, edge.importer))
    .map(edge => `${policy.policyName}: ${edge.importer} -> package:${edge.specifier}`)
    .sort();
}

interface ResourceImportPolicy {
  policyName: string;
  imports: readonly ResourceImportEdge[];
  appliesTo: (module: string) => boolean;
}

export function findResourceImportViolations(policy: ResourceImportPolicy): string[] {
  return policy.imports
    .filter(edge => policy.appliesTo(edge.importer))
    .map(edge => `${policy.policyName}: ${edge.importer} -> resource:${edge.specifier}`)
    .sort();
}

const BROWSER_GLOBALS = new Set([
  'AudioContext',
  'OfflineAudioContext',
  'AudioWorkletNode',
  'HTMLAnchorElement',
  'HTMLElement',
  'Image',
  'MediaRecorder',
  'MutationObserver',
  'ResizeObserver',
  'SharedWorker',
  'Worker',
  'cancelAnimationFrame',
  'document',
  'indexedDB',
  'localStorage',
  'location',
  'navigator',
  'self',
  'sessionStorage',
  'webkitAudioContext',
  'window',
  'requestAnimationFrame',
]);

export interface BrowserGlobalReference {
  global: string;
  line: number;
  column: number;
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return false;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isFunctionExpression(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isClassExpression(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node);
}

function declarationCreatesRuntimeBinding(declaration: ts.Declaration): boolean {
  if (declaration.getSourceFile().isDeclarationFile) return false;
  return (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient) === 0;
}

function isImmediatelyInvokedFunction(node: ts.FunctionLikeDeclaration): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;

  let expression: ts.Expression = node;
  while (ts.isParenthesizedExpression(expression.parent)
    || ts.isAsExpression(expression.parent)
    || ts.isTypeAssertionExpression(expression.parent)
    || ts.isNonNullExpression(expression.parent)
    || ts.isSatisfiesExpression(expression.parent)) {
    expression = expression.parent;
  }

  if (ts.isCallExpression(expression.parent)
    && expression.parent.expression === expression) {
    return true;
  }

  const propertyAccess = expression.parent;
  return ts.isPropertyAccessExpression(propertyAccess)
    && propertyAccess.expression === expression
    && (propertyAccess.name.text === 'call' || propertyAccess.name.text === 'apply')
    && ts.isCallExpression(propertyAccess.parent)
    && propertyAccess.parent.expression === propertyAccess;
}

function analyzeBrowserGlobals(
  source: string,
  fileName: string,
  includeDeferredFunctions: boolean,
): BrowserGlobalReference[] {
  const absoluteFileName = resolve(APP_ROOT, fileName);
  const sourceFile = ts.createSourceFile(
    absoluteFileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  const analysisOptions: ts.CompilerOptions = {
    ...APP_COMPILER_OPTIONS,
    noLib: true,
    noResolve: true,
    types: [],
  };
  const host = ts.createCompilerHost(analysisOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(requested) === absoluteFileName
      ? sourceFile
      : originalGetSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = requested => resolve(requested) === absoluteFileName;
  host.readFile = requested => resolve(requested) === absoluteFileName ? source : undefined;
  const program = ts.createProgram({
    rootNames: [absoluteFileName],
    options: analysisOptions,
    host,
  });
  const checker = program.getTypeChecker();
  const references: BrowserGlobalReference[] = [];

  const add = (global: string, node: ts.Node): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({ global, line: location.line + 1, column: location.character + 1 });
  };

  const isUnshadowed = (node: ts.Identifier): boolean => {
    const symbol = checker.getSymbolAtLocation(node);
    return !symbol?.declarations?.some(declaration =>
      declaration.getSourceFile() === sourceFile && declarationCreatesRuntimeBinding(declaration));
  };

  const visit = (node: ts.Node): void => {
    if (!includeDeferredFunctions && ts.isFunctionLike(node)) {
      if (isImmediatelyInvokedFunction(node)) ts.forEachChild(node, visit);
      return;
    }
    if (ts.isTypeNode(node)
      || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      return;
    }
    if (ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && ts.isIdentifier(node.initializer)
      && node.initializer.text === 'globalThis'
      && isUnshadowed(node.initializer)) {
      for (const element of node.name.elements) {
        const property = element.propertyName ?? element.name;
        const global = ts.isIdentifier(property) || ts.isStringLiteral(property)
          ? property.text
          : null;
        if (global && BROWSER_GLOBALS.has(global)) add(global, element);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'globalThis'
      && isUnshadowed(node.expression)
      && BROWSER_GLOBALS.has(node.name.text)) {
      add(node.name.text, node);
      return;
    }
    if (ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'globalThis'
      && isUnshadowed(node.expression)) {
      const global = stringLiteralText(node.argumentExpression);
      if (global && BROWSER_GLOBALS.has(global)) {
        add(global, node);
        return;
      }
    }
    if (ts.isIdentifier(node)
      && BROWSER_GLOBALS.has(node.text)
      && !isPropertyName(node)
      && !isDeclarationName(node)
      && isUnshadowed(node)) {
      add(node.text, node);
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return references;
}

/** Finds browser-only globals read anywhere in a runtime-capability module. */
export function findBrowserGlobalReferences(
  source: string,
  fileName = 'module.ts',
): BrowserGlobalReference[] {
  return analyzeBrowserGlobals(source, fileName, true);
}

/** Finds browser-only globals that are read while a module is being evaluated. */
export function findModuleEvaluationBrowserGlobals(
  source: string,
  fileName = 'module.ts',
): BrowserGlobalReference[] {
  return analyzeBrowserGlobals(source, fileName, false);
}

function isImportMeta(node: ts.Node | undefined): node is ts.MetaProperty {
  return !!node && ts.isMetaProperty(node)
    && node.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.name.text === 'meta';
}

/** Finds every import.meta capability in a runtime-neutral module. */
export function findImportMetaReferences(
  source: string,
  fileName = 'module.ts',
): BrowserGlobalReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  const references: BrowserGlobalReference[] = [];
  const add = (node: ts.Node): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({
      global: 'import.meta',
      line: location.line + 1,
      column: location.character + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (isImportMeta(node)) add(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}
