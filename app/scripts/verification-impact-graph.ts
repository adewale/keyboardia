import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  selectVerificationScope,
  type VerificationImpactInventory,
} from './select-verification-scope.mjs';
import {
  validatorDeclaredInputs,
  validatorEntrypoints,
  type ValidatorProfile,
} from './validate-all';

export type { VerificationImpactInventory } from './select-verification-scope.mjs';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPOSITORY_ROOT = resolve(APP_ROOT, '..');
const CODE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const RESOURCE_EXTENSIONS = new Set([
  '.avif', '.css', '.flac', '.gif', '.ico', '.jpeg', '.jpg', '.json', '.less',
  '.md', '.mp3', '.ogg', '.otf', '.png', '.sass', '.scss', '.svg', '.ttf', '.wasm',
  '.wav', '.webp', '.woff', '.woff2',
]);
const TYPESCRIPT_CONFIG_PATH = resolve(APP_ROOT, 'tsconfig.scripts.json');
let trackedPaths: Set<string> | undefined;

function repositoryTrackedPaths(): Set<string> {
  trackedPaths ??= new Set(execFileSync('git', ['ls-files', '-z'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).split('\0').filter(Boolean));
  return trackedPaths;
}

/** Return whether a validator input is present in a clean repository checkout. */
export function isTrackedValidatorInput(path: string, directory = path.endsWith('/')): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  const tracked = repositoryTrackedPaths();
  if (!directory) return tracked.has(normalized);
  for (const candidate of tracked) {
    if (candidate.startsWith(`${normalized}/`)) return true;
  }
  return false;
}

function compilerOptions(): ts.CompilerOptions {
  const config = ts.readConfigFile(TYPESCRIPT_CONFIG_PATH, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    APP_ROOT,
    undefined,
    TYPESCRIPT_CONFIG_PATH,
  );
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors
      .map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('\n'));
  }
  return parsed.options;
}

const COMPILER_OPTIONS = compilerOptions();

export interface ValidatorImportEdge {
  importer: string;
  imported: string;
}

export interface ValidatorImportGraph {
  profile: ValidatorProfile;
  entrypoints: string[];
  modules: string[];
  inputs: string[];
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

function isRepositoryDependency(absolutePath: string): boolean {
  const path = relative(REPOSITORY_ROOT, absolutePath).replaceAll('\\', '/');
  return path !== '..'
    && !path.startsWith('../')
    && !isAbsolute(path)
    && !path.split('/').includes('node_modules');
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
  options = COMPILER_OPTIONS,
): ResolvedRuntimeImport | null {
  if (reference.expression) {
    throw new Error(
      `Unable to statically analyze validator import in ${repositoryPath(importerPath)}: `
        + reference.expression,
    );
  }
  const sourceSpecifier = reference.specifier.split(/[?#]/, 1)[0];
  const isRelativeSpecifier = sourceSpecifier.startsWith('.');
  if (isRelativeSpecifier && RESOURCE_EXTENSIONS.has(extname(sourceSpecifier).toLowerCase())) {
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
    options,
    ts.sys,
  );
  const importedPath = result.resolvedModule?.resolvedFileName;
  if (!importedPath) {
    if (!isRelativeSpecifier) return null;
    throw new Error(
      `Unable to resolve validator import ${reference.specifier} from ${repositoryPath(importerPath)}`,
    );
  }
  const absoluteImportedPath = resolve(importedPath);
  if (!isRepositoryDependency(absoluteImportedPath)) return null;
  const importedExtension = extname(absoluteImportedPath).toLowerCase();
  if (RESOURCE_EXTENSIONS.has(importedExtension)) {
    return { path: absoluteImportedPath, traverse: false };
  }
  if (!CODE_EXTENSIONS.has(importedExtension)) {
    throw new Error(
      `Unsupported local validator dependency ${reference.specifier} from ${repositoryPath(importerPath)}`,
    );
  }
  return { path: absoluteImportedPath, traverse: true };
}

/** Resolve one runtime specifier for focused alias and boundary regression tests. */
export function resolveValidatorRuntimeSpecifier(
  importerPath: string,
  specifier: string,
  options: ts.CompilerOptions = COMPILER_OPTIONS,
): string | null {
  const imported = resolveRuntimeImport(importerPath, { specifier }, options);
  return imported ? repositoryPath(imported.path) : null;
}

/**
 * Walk every local runtime import reachable from the exact commands run by
 * a CI validator profile. Local aliases are resolved with the scripts project's
 * TypeScript configuration. Any unresolved relative import or missing declared
 * filesystem input fails closed rather than making ownership silently incomplete.
 */
export function collectValidatorImportGraph(profile: ValidatorProfile): ValidatorImportGraph {
  const entrypoints = validatorEntrypoints(profile)
    .map(entrypoint => repositoryPath(resolve(APP_ROOT, entrypoint)));
  const queue = entrypoints.map(entrypoint => resolve(REPOSITORY_ROOT, entrypoint));
  const discovered = new Set(queue);
  const inputs = new Set<string>();
  const visitedCode = new Set<string>();
  const edges: ValidatorImportEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: ValidatorImportEdge): void => {
    const key = `${edge.importer}\0${edge.imported}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const declared of validatorDeclaredInputs(profile)) {
    const absoluteInput = resolve(APP_ROOT, declared.input);
    if (!existsSync(absoluteInput)) {
      throw new Error(
        `${declared.entrypoint} declares missing runtime input: ${declared.input}`,
      );
    }
    const inputPath = repositoryPath(absoluteInput);
    const isDirectory = statSync(absoluteInput).isDirectory();
    if (!isTrackedValidatorInput(inputPath, isDirectory)) {
      throw new Error(
        `${declared.entrypoint} declares runtime input absent from a clean checkout: ${declared.input}`,
      );
    }
    const input = `${inputPath}${isDirectory ? '/' : ''}`;
    inputs.add(input);
    addEdge({
      importer: repositoryPath(resolve(APP_ROOT, declared.entrypoint)),
      imported: input,
    });
  }

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
      addEdge(edge);
      if (imported.traverse) queue.push(imported.path);
    }
  }

  return {
    profile,
    entrypoints: entrypoints.sort(),
    modules: [...discovered].map(repositoryPath).sort(),
    inputs: [...inputs].sort(),
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
  profile: ValidatorProfile,
  graph = collectValidatorImportGraph(profile),
): ValidatorOwnershipGap[] {
  return [...graph.modules, ...graph.inputs]
    .filter(dependency => !selectVerificationScope([dependency], inventory).selected[profile])
    .map(dependency => ({ dependency, importPath: importPathTo(dependency, graph) }));
}
