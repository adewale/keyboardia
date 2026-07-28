import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
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
  unresolvedRelativeImports: UnresolvedRelativeImport[];
  unanalyzableModuleReferences: UnanalyzableModuleReference[];
  parseFailures: ParseFailure[];
}

export interface ScanOptions {
  /** Test-only source replacement, keyed by path relative to the source root. */
  sourceOverrides?: ReadonlyMap<string, string>;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
};

const CODE_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
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
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every(element => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return true;
  if (!declaration.exportClause || !ts.isNamedExports(declaration.exportClause)) return false;
  return declaration.exportClause.elements.length > 0
    && declaration.exportClause.elements.every(element => element.isTypeOnly);
}

/** Extracts real relative module references from the TypeScript syntax tree. */
export function extractRelativeImports(
  source: string,
  fileName = 'module.ts',
): RelativeImport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: RelativeImport[] = [];

  const add = (specifier: string | null, typeOnly: boolean): void => {
    if (specifier?.startsWith('.')) imports.push({ specifier, typeOnly });
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
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function findUnanalyzableModuleReferences(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function isRelativeCodeSpecifier(specifier: string): boolean {
  const withoutQuery = specifier.split(/[?#]/, 1)[0];
  return CODE_EXTENSIONS.has(extname(withoutQuery));
}

/** Resolves exactly as the application's TypeScript bundler configuration does. */
export function resolveRelativeCodeImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.') || !isRelativeCodeSpecifier(specifier)) return null;
  // Vite query suffixes select a loader; TypeScript resolution still applies
  // to the source path before the query (for example `?worker&url`).
  const sourceSpecifier = specifier.split(/[?#]/, 1)[0];
  const result = ts.resolveModuleName(sourceSpecifier, importer, COMPILER_OPTIONS, ts.sys);
  return result.resolvedModule ? resolve(result.resolvedModule.resolvedFileName) : null;
}

export function productionModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionModules(path);
    if (!/\.tsx?$/.test(entry.name)
      || /(?:\.test|\.stories|\.bench)\.tsx?$/.test(entry.name)
      || entry.name.endsWith('.d.ts')) {
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
  const edges: ImportEdge[] = [];
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
      importerPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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

    for (const importedReference of extractRelativeImports(source, importerPath)) {
      if (!isRelativeCodeSpecifier(importedReference.specifier)) continue;
      const resolved = resolveRelativeCodeImport(importerPath, importedReference.specifier);
      if (!resolved) {
        unresolvedRelativeImports.push({
          importer,
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

const BROWSER_GLOBALS = new Set(['window', 'document', 'localStorage', 'navigator']);

export interface BrowserGlobalReference {
  global: string;
  line: number;
  column: number;
}

function isDeclarationOrPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if ((ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  return false;
}

/** Finds browser-only globals that are read while a module is being evaluated. */
export function findModuleEvaluationBrowserGlobals(
  source: string,
  fileName = 'module.ts',
): BrowserGlobalReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: BrowserGlobalReference[] = [];

  const add = (global: string, node: ts.Node): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({ global, line: location.line + 1, column: location.character + 1 });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isTypeNode(node)
      || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'globalThis'
      && BROWSER_GLOBALS.has(node.name.text)) {
      add(node.name.text, node);
      return;
    }
    if (ts.isIdentifier(node)
      && BROWSER_GLOBALS.has(node.text)
      && !isDeclarationOrPropertyName(node)) {
      add(node.text, node);
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return references;
}
