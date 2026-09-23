import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  selectVerificationScope,
  type VerificationImpactInventory,
} from './select-verification-scope.mjs';
import { validatorEntrypoints } from './validate-all';

export type { VerificationImpactInventory } from './select-verification-scope.mjs';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPOSITORY_ROOT = resolve(APP_ROOT, '..');
const CODE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const RESOURCE_EXTENSIONS = new Set([
  '.avif', '.css', '.flac', '.gif', '.ico', '.jpeg', '.jpg', '.json', '.less',
  '.md', '.mp3', '.ogg', '.otf', '.png', '.sass', '.scss', '.svg', '.ttf', '.wasm',
  '.wav', '.webp', '.woff', '.woff2',
]);
const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolveJsonModule: true,
  target: ts.ScriptTarget.ESNext,
};

export interface ValidatorImportEdge {
  importer: string;
  imported: string;
}

export interface ValidatorImportGraph {
  entrypoints: string[];
  modules: string[];
  edges: ValidatorImportEdge[];
}

export interface ValidatorOwnershipGap {
  dependency: string;
  importPath: string[];
}

function repositoryPath(absolutePath: string): string {
  const path = relative(REPOSITORY_ROOT, absolutePath).replaceAll('\\', '/');
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new Error(`Validator dependency escapes the repository: ${absolutePath}`);
  }
  return path;
}

interface RuntimeImport {
  specifier: string;
  expression?: string;
}

function stringLiteralText(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function isImportMeta(node: ts.Node | undefined): boolean {
  return !!node
    && ts.isMetaProperty(node)
    && node.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.name.text === 'meta';
}

function runtimeImports(source: string, importerPath: string): RuntimeImport[] {
  const sourceFile = ts.createSourceFile(
    importerPath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: RuntimeImport[] = [];

  const addLiteral = (node: ts.Node | undefined, expression?: string): void => {
    const specifier = stringLiteralText(node);
    if (specifier !== null) imports.push({ specifier });
    else if (expression) imports.push({ specifier: '', expression });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) addLiteral(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) addLiteral(node.moduleSpecifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)
      && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) {
      addLiteral(node.moduleReference.expression);
      return;
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        addLiteral(node.arguments[0], node.getText(sourceFile));
        return;
      }
      if (ts.isPropertyAccessExpression(node.expression)
        && isImportMeta(node.expression.expression)
        && ['glob', 'globEager', 'resolve'].includes(node.expression.name.text)) {
        imports.push({ specifier: '', expression: node.getText(sourceFile) });
        return;
      }
    }
    if (ts.isNewExpression(node)) {
      const urlBase = node.arguments?.[1];
      if (ts.isIdentifier(node.expression)
        && node.expression.text === 'URL'
        && urlBase
        && ts.isPropertyAccessExpression(urlBase)
        && isImportMeta(urlBase.expression)
        && urlBase.name.text === 'url') {
        addLiteral(node.arguments?.[0], node.getText(sourceFile));
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

interface ResolvedRuntimeImport {
  path: string;
  traverse: boolean;
}

function resolveRuntimeImport(
  importerPath: string,
  reference: RuntimeImport,
): ResolvedRuntimeImport | null {
  if (reference.expression) {
    throw new Error(
      `Unable to statically analyze validator import in ${repositoryPath(importerPath)}: `
        + reference.expression,
    );
  }
  if (!reference.specifier.startsWith('.')) return null;
  const sourceSpecifier = reference.specifier.split(/[?#]/, 1)[0];
  if (RESOURCE_EXTENSIONS.has(extname(sourceSpecifier).toLowerCase())) {
    const resourcePath = resolve(dirname(importerPath), sourceSpecifier);
    if (!existsSync(resourcePath)) {
      throw new Error(
        `Unable to resolve validator resource ${reference.specifier} from ${repositoryPath(importerPath)}`,
      );
    }
    return { path: resourcePath, traverse: false };
  }
  const result = ts.resolveModuleName(
    sourceSpecifier,
    importerPath,
    COMPILER_OPTIONS,
    ts.sys,
  );
  const importedPath = result.resolvedModule?.resolvedFileName;
  if (!importedPath || !CODE_EXTENSIONS.has(extname(importedPath).toLowerCase())) {
    throw new Error(
      `Unable to resolve validator import ${reference.specifier} from ${repositoryPath(importerPath)}`,
    );
  }
  return { path: resolve(importedPath), traverse: true };
}

/**
 * Walk every local runtime import reachable from the exact commands run by
 * validate:all. Any unresolved relative import fails closed rather than making
 * the ownership graph silently incomplete.
 */
export function collectValidatorImportGraph(): ValidatorImportGraph {
  const entrypoints = validatorEntrypoints()
    .map(entrypoint => repositoryPath(resolve(APP_ROOT, entrypoint)));
  const queue = entrypoints.map(entrypoint => resolve(REPOSITORY_ROOT, entrypoint));
  const discovered = new Set(queue);
  const visitedCode = new Set<string>();
  const edges: ValidatorImportEdge[] = [];

  while (queue.length > 0) {
    const importerPath = queue.shift()!;
    if (visitedCode.has(importerPath)) continue;
    if (!existsSync(importerPath)) {
      throw new Error(`validate:all references missing entrypoint or dependency: ${repositoryPath(importerPath)}`);
    }
    visitedCode.add(importerPath);

    const source = readFileSync(importerPath, 'utf8');
    for (const importedReference of runtimeImports(source, importerPath)) {
      const imported = resolveRuntimeImport(importerPath, importedReference);
      if (!imported) continue;
      discovered.add(imported.path);
      const edge = {
        importer: repositoryPath(importerPath),
        imported: repositoryPath(imported.path),
      };
      if (!edges.some(existing =>
        existing.importer === edge.importer && existing.imported === edge.imported)) {
        edges.push(edge);
      }
      if (imported.traverse) queue.push(imported.path);
    }
  }

  return {
    entrypoints: entrypoints.sort(),
    modules: [...discovered].map(repositoryPath).sort(),
    edges: edges.sort((a, b) =>
      `${a.importer}:${a.imported}`.localeCompare(`${b.importer}:${b.imported}`)),
  };
}

function importPathTo(dependency: string, graph: ValidatorImportGraph): string[] {
  const paths = new Map(graph.entrypoints.map(entrypoint => [entrypoint, [entrypoint]]));
  const queue = [...graph.entrypoints];
  while (queue.length > 0) {
    const importer = queue.shift()!;
    const parentPath = paths.get(importer)!;
    for (const edge of graph.edges.filter(candidate => candidate.importer === importer)) {
      if (paths.has(edge.imported)) continue;
      const path = [...parentPath, edge.imported];
      paths.set(edge.imported, path);
      if (edge.imported === dependency) return path;
      queue.push(edge.imported);
    }
  }
  return [dependency];
}

/** Return validator dependencies for which T1 would skip Instrument Validation. */
export function findValidatorOwnershipGaps(
  inventory: VerificationImpactInventory,
  graph = collectValidatorImportGraph(),
): ValidatorOwnershipGap[] {
  return graph.modules
    .filter(dependency => !selectVerificationScope([dependency], inventory).selected.samples)
    .map(dependency => ({ dependency, importPath: importPathTo(dependency, graph) }));
}
