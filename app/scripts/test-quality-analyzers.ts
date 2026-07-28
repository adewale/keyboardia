/**
 * Pure analyzers used by the test-quality command-line checks.
 *
 * These deliberately parse TypeScript instead of applying regular expressions
 * to source text. That keeps comments and test names out of the result, makes
 * one-line and parameterised tests visible, and lets import reachability be
 * resolved against the module that was actually imported.
 */
import path from 'node:path';
import ts from 'typescript';

export interface TestFinding {
  rule: string;
  file: string;
  line: number;
  text: string;
}

export interface SourceUnit {
  file: string;
  source: string;
  isTest: boolean;
  role?: 'runtime' | 'build' | 'test';
  isEntry?: boolean;
}

export interface DeadExportFinding {
  file: string;
  name: string;
  kind: 'function' | 'const' | 'class';
  testFiles: number;
}

export interface ExportReachability extends DeadExportFinding {
  status: 'runtime' | 'build-only' | 'test-only' | 'unreferenced';
}

function parse(file: string, source: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function visit(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
  if (predicate(node)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && visit(child, predicate)) found = true;
  });
  return found;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
}

function propertyName(expression: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
}

function containsExpect(node: ts.Node): boolean {
  return visit(node, (candidate) =>
    ts.isCallExpression(candidate)
    && ts.isIdentifier(candidate.expression)
    && candidate.expression.text === 'expect'
  );
}

function isEmptyCallback(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  return ts.isBlock(node.body) && node.body.statements.length === 0;
}

function isAssertionShaped(node: ts.Node): boolean {
  return visit(node, (candidate) => {
    if (ts.isThrowStatement(candidate)) return true;
    if (!ts.isCallExpression(candidate)) return false;

    const callee = candidate.expression;
    if (ts.isIdentifier(callee)) {
      return callee.text === 'expect'
        || /^assert\w*$/.test(callee.text)
        || /^(?:expect|assert|verify|check|poll|await)[A-Z]\w*$/.test(callee.text)
        || /^waitFor\w*$/.test(callee.text);
    }
    if (!ts.isPropertyAccessExpression(callee)) return false;
    return callee.name.text === 'toPass'
      || /^waitFor\w*$/.test(callee.name.text)
      || /^(?:expect|assert|verify|check|poll|await)[A-Z]\w*$/.test(callee.name.text)
      || (callee.name.text === 'assert'
        && ts.isIdentifier(callee.expression)
        && callee.expression.text === 'fc');
  });
}

interface TestCall {
  callback?: ts.ArrowFunction | ts.FunctionExpression;
  skipped: boolean;
}

function testCallee(expression: ts.Expression): { test: boolean; skipped: boolean } {
  if (ts.isIdentifier(expression)) {
    return { test: expression.text === 'test' || expression.text === 'it', skipped: false };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const modifier = expression.name.text;
    if (!['only', 'skip', 'todo', 'concurrent', 'each', 'fails', 'fixme', 'slow'].includes(modifier)) {
      return { test: false, skipped: false };
    }
    const base = testCallee(expression.expression);
    return {
      test: base.test,
      skipped: base.skipped || modifier === 'skip' || modifier === 'todo' || modifier === 'fixme',
    };
  }
  if (ts.isCallExpression(expression)) return testCallee(expression.expression);
  if (ts.isTaggedTemplateExpression(expression)) return testCallee(expression.tag);
  return { test: false, skipped: false };
}

function asTestCall(node: ts.CallExpression): TestCall | undefined {
  const callee = testCallee(node.expression);
  if (!callee.test) return undefined;
  const callback = [...node.arguments]
    .reverse()
    .find((argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
  return { callback, skipped: callee.skipped };
}

function expectMatcher(node: ts.CallExpression): {
  actual: ts.Expression;
  matcher: string;
  expected?: ts.Expression;
} | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  let receiver: ts.Expression = node.expression.expression;
  if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not') {
    receiver = receiver.expression;
  }
  if (!ts.isCallExpression(receiver)
    || !ts.isIdentifier(receiver.expression)
    || receiver.expression.text !== 'expect'
    || receiver.arguments.length !== 1) return undefined;
  return {
    actual: receiver.arguments[0],
    matcher: node.expression.name.text,
    expected: node.arguments[0],
  };
}

function isStableExpression(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(node)) return isStableExpression(node.expression);
  if (ts.isElementAccessExpression(node)) {
    return isStableExpression(node.expression)
      && node.argumentExpression !== undefined
      && (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression));
  }
  return false;
}

function sameText(sourceFile: ts.SourceFile, left: ts.Node, right: ts.Node): boolean {
  return left.getText(sourceFile).replace(/\s+/g, '') === right.getText(sourceFile).replace(/\s+/g, '');
}

function isLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node)
    || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword;
}

function isVacuousPropertyReturn(node: ts.ReturnStatement): boolean {
  if (node.expression?.kind !== ts.SyntaxKind.TrueKeyword) return false;
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const call = current.parent;
      if (!ts.isCallExpression(call) || !call.arguments.includes(current)) return false;
      return ts.isPropertyAccessExpression(call.expression)
        && ts.isIdentifier(call.expression.expression)
        && call.expression.expression.text === 'fc'
        && (call.expression.name.text === 'property'
          || call.expression.name.text === 'asyncProperty');
    }
    current = current.parent;
  }
  return false;
}

/** Find always-green and zero-oracle patterns in one test source file. */
export function scanTestSource(file: string, source: string): TestFinding[] {
  const sourceFile = parse(file, source);
  const findings: TestFinding[] = [];
  const add = (rule: string, node: ts.Node) => findings.push({
    rule,
    file,
    line: lineOf(sourceFile, node),
    text: nodeText(sourceFile, node),
  });

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const matcher = expectMatcher(node);
      if (matcher) {
        const equalityMatcher = /^(?:toBe|toEqual|toStrictEqual)$/;
        if (equalityMatcher.test(matcher.matcher) && matcher.expected) {
          const sameLiteral = isLiteral(matcher.actual)
            && isLiteral(matcher.expected)
            && sameText(sourceFile, matcher.actual, matcher.expected);
          const sameStableValue = isStableExpression(matcher.actual)
            && sameText(sourceFile, matcher.actual, matcher.expected);
          if (sameLiteral) add('tautological-assertion', node);
          else if (sameStableValue) add('self-comparison', node);

          if (matcher.expected.kind === ts.SyntaxKind.TrueKeyword
            && ts.isBinaryExpression(matcher.actual)
            && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken]
              .includes(matcher.actual.operatorToken.kind)
            && sameText(sourceFile, matcher.actual.left, matcher.actual.right)) {
            add('self-comparison', node);
          }
        }
        if (matcher.matcher === 'toBeDefined'
          && ts.isCallExpression(matcher.actual)
          && ts.isIdentifier(matcher.actual.expression)
          && matcher.actual.expression.text === 'String') {
          add('always-defined-coercion', node);
        }
      }

      if (propertyName(node.expression) === 'catch'
        && ts.isPropertyAccessExpression(node.expression)
        && containsExpect(node.expression.expression)
        && node.arguments.some(isEmptyCallback)) {
        add('nullified-assertion', node);
      }

      if (ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'skip'
        && testCallee(node.expression.expression).test
        && node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword) {
        add('runtime-self-skip', node);
      }

      const testCall = asTestCall(node);
      if (testCall?.callback && !testCall.skipped && !isAssertionShaped(testCall.callback.body)) {
        add('zero-assertion-test', node);
      }
    }

    if (ts.isTryStatement(node) && node.catchClause?.variableDeclaration
      && ts.isIdentifier(node.catchClause.variableDeclaration.name)
      && containsExpect(node.tryBlock)) {
      const caught = node.catchClause.variableDeclaration.name.text;
      const swallowed = node.catchClause.block.statements.find((statement) =>
        visit(statement, (candidate) => {
          if (!ts.isCallExpression(candidate)) return false;
          const matcher = expectMatcher(candidate);
          return matcher !== undefined
            && isStableExpression(matcher.actual)
            && matcher.actual.getText(sourceFile) === caught
            && /^(?:toBeDefined|toBeTruthy|toBeNull|toBeInstanceOf)$/.test(matcher.matcher);
        }));
      if (swallowed) add('assertion-swallowed-by-own-catch', swallowed);
    }

    if (ts.isReturnStatement(node) && isVacuousPropertyReturn(node)) {
      add('vacuous-property-guard', node);
    }

    node.forEachChild(walk);
  };
  walk(sourceFile);

  return findings.filter((finding, index) =>
    findings.findIndex((candidate) =>
      candidate.rule === finding.rule && candidate.line === finding.line && candidate.text === finding.text) === index);
}

/** Static and dynamic module specifiers, independent of quote style. */
export function collectModuleSpecifiers(source: string, file = 'source.ts'): string[] {
  const sourceFile = parse(file, source);
  const specifiers = new Set<string>();
  const walk = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.add(node.arguments[0].text);
    }
    node.forEachChild(walk);
  };
  walk(sourceFile);
  return [...specifiers];
}

export function collectTopLevelFunctionNames(source: string, file = 'source.ts'): string[] {
  const sourceFile = parse(file, source);
  return sourceFile.statements
    .filter(ts.isFunctionDeclaration)
    .map((statement) => statement.name?.text)
    .filter((name): name is string => name !== undefined);
}

function canonical(file: string): string {
  return path.posix.normalize(file.replaceAll('\\', '/').replace(/^\.\//, ''));
}

function resolveModule(importer: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const cleanSpecifier = specifier.replace(/[?#].*$/, '');
  const raw = canonical(path.posix.join(path.posix.dirname(importer), cleanSpecifier));
  const withoutJs = raw.replace(/\.(?:m?js)$/, '');
  const candidates = [raw, withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`,
    `${withoutJs}/index.ts`, `${withoutJs}/index.tsx`];
  return candidates.find((candidate) => files.has(candidate));
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

interface DeclarationNode {
  name: string;
  node: ts.Node;
  exported: boolean;
  kind: DeadExportFinding['kind'];
  defaulted: boolean;
}

interface ImportBinding {
  target: string;
  imported: string | '*';
}

const moduleNode = (file: string) => `module\0${file}`;
const declarationNode = (file: string, name: string) => `declaration\0${file}\0${name}`;

function addEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  const edges = graph.get(from) ?? new Set<string>();
  edges.add(to);
  graph.set(from, edges);
}

function topLevelDeclarations(sourceFile: ts.SourceFile): Map<string, DeclarationNode> {
  const declarations = new Map<string, DeclarationNode>();
  for (const statement of sourceFile.statements) {
    const exported = hasExportModifier(statement);
    const defaulted = ts.canHaveModifiers(statement)
      && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, {
        name: statement.name.text, node: statement, exported, kind: 'function', defaulted,
      });
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, {
        name: statement.name.text, node: statement, exported, kind: 'class', defaulted,
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, {
          name: declaration.name.text, node: declaration, exported, kind: 'const', defaulted: false,
        });
      }
    }
  }
  return declarations;
}

function isImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && !!node.arguments[0]
    && ts.isStringLiteralLike(node.arguments[0]);
}

function importCallWithin(node: ts.Expression): ts.CallExpression | undefined {
  let current: ts.Expression = node;
  while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return isImportCall(current) ? current : undefined;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)
    || ts.isVariableDeclaration(parent) || ts.isParameter(parent)
    || ts.isImportClause(parent) || ts.isImportSpecifier(parent)
    || ts.isNamespaceImport(parent) || ts.isBindingElement(parent))
    && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
    || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent))
    && parent.name === node) return false;
  if (ts.isExportSpecifier(parent)) return false;
  return true;
}

function referencedEdges(
  node: ts.Node,
  from: string,
  file: string,
  files: Set<string>,
  localDeclarations: Map<string, DeclarationNode>,
  importBindings: Map<string, ImportBinding>,
  exportsByFile: Map<string, DeclarationNode[]>,
  graph: Map<string, Set<string>>,
): void {
  const addImported = (binding: ImportBinding, imported = binding.imported) => {
    if (imported === '*') {
      for (const declaration of exportsByFile.get(binding.target) ?? []) {
        addEdge(graph, from, declarationNode(binding.target, declaration.name));
      }
    } else {
      addEdge(graph, from, declarationNode(binding.target, imported));
    }
  };

  const walk = (candidate: ts.Node): void => {
    if (isImportCall(candidate)) {
      const target = resolveModule(file, (candidate.arguments[0] as ts.StringLiteral).text, files);
      if (target) addEdge(graph, from, moduleNode(target));
    }
    if (ts.isNewExpression(candidate)
      && ts.isIdentifier(candidate.expression) && candidate.expression.text === 'URL'
      && candidate.arguments?.[0] && ts.isStringLiteralLike(candidate.arguments[0])) {
      const target = resolveModule(file, candidate.arguments[0].text, files);
      if (target) addEdge(graph, from, moduleNode(target));
    }
    if (ts.isPropertyAccessExpression(candidate)) {
      const directImport = importCallWithin(candidate.expression);
      if (directImport) {
        const target = resolveModule(file, (directImport.arguments[0] as ts.StringLiteral).text, files);
        if (target) addEdge(graph, from, declarationNode(target, candidate.name.text));
      } else if (ts.isIdentifier(candidate.expression)) {
        const binding = importBindings.get(candidate.expression.text);
        if (binding?.imported === '*') addImported(binding, candidate.name.text);
      }
    }
    if (ts.isCallExpression(candidate)
      && ts.isPropertyAccessExpression(candidate.expression)
      && candidate.expression.name.text === 'then') {
      const call = importCallWithin(candidate.expression.expression);
      const callback = candidate.arguments[0];
      if (call && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const target = resolveModule(file, (call.arguments[0] as ts.StringLiteral).text, files);
        const parameter = callback.parameters[0]?.name;
        if (target && parameter && ts.isIdentifier(parameter)) {
          const findMembers = (member: ts.Node): void => {
            if (ts.isPropertyAccessExpression(member)
              && ts.isIdentifier(member.expression)
              && member.expression.text === parameter.text) {
              addEdge(graph, from, declarationNode(target, member.name.text));
            }
            member.forEachChild(findMembers);
          };
          findMembers(callback.body);
        } else if (target && parameter && ts.isObjectBindingPattern(parameter)) {
          for (const element of parameter.elements) {
            const imported = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name) ? element.name.text : undefined;
            if (imported) addEdge(graph, from, declarationNode(target, imported));
          }
        }
      }
    }
    if (ts.isIdentifier(candidate) && isReferenceIdentifier(candidate)) {
      const parent = candidate.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === candidate
        && importBindings.get(candidate.text)?.imported === '*') {
        // The property-access case above records the exact member.
      } else {
        const binding = importBindings.get(candidate.text);
        if (binding) addImported(binding);
        else if (localDeclarations.has(candidate.text)) {
          addEdge(graph, from, declarationNode(file, candidate.text));
        }
      }
    }
    candidate.forEachChild(walk);
  };
  walk(node);
}

function reachable(graph: Map<string, Set<string>>, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const target of graph.get(node) ?? []) pending.push(target);
  }
  return seen;
}

/** Classify named runtime exports by graph reachability from explicit roots. */
export function analyzeExportReachability(
  units: SourceUnit[],
  excluded: (file: string) => boolean = () => false,
): ExportReachability[] {
  const normalized = units.map((unit) => ({
    ...unit,
    file: canonical(unit.file),
    role: unit.role ?? (unit.isTest ? 'test' as const : 'runtime' as const),
  }));
  const files = new Set(normalized.map((unit) => unit.file));
  const parsed = new Map(normalized.map((unit) => [unit.file, parse(unit.file, unit.source)]));
  const declarationsByFile = new Map<string, Map<string, DeclarationNode>>();
  const exportsByFile = new Map<string, DeclarationNode[]>();
  for (const unit of normalized) {
    const declarations = topLevelDeclarations(parsed.get(unit.file)!);
    declarationsByFile.set(unit.file, declarations);
    exportsByFile.set(unit.file, [...declarations.values()].filter((item) => item.exported));
  }

  const graph = new Map<string, Set<string>>();
  for (const unit of normalized) {
    const sourceFile = parsed.get(unit.file)!;
    const declarations = declarationsByFile.get(unit.file)!;
    const bindings = new Map<string, ImportBinding>();

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const target = resolveModule(unit.file, statement.moduleSpecifier.text, files);
        if (!target) continue;
        addEdge(graph, moduleNode(unit.file), moduleNode(target));
        const clause = statement.importClause;
        if (clause?.name) bindings.set(clause.name.text, { target, imported: 'default' });
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          bindings.set(clause.namedBindings.name.text, { target, imported: '*' });
        } else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            bindings.set(element.name.text, {
              target,
              imported: element.propertyName?.text ?? element.name.text,
            });
          }
        }
      } else if (ts.isExportDeclaration(statement)
        && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const target = resolveModule(unit.file, statement.moduleSpecifier.text, files);
        if (!target) continue;
        addEdge(graph, moduleNode(unit.file), moduleNode(target));
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const exportedName = element.name.text;
            const importedName = element.propertyName?.text ?? exportedName;
            addEdge(graph, declarationNode(unit.file, exportedName), declarationNode(target, importedName));
            if (unit.isEntry) {
              addEdge(graph, moduleNode(unit.file), declarationNode(unit.file, exportedName));
            }
          }
        }
      }
    }

    for (const declaration of declarations.values()) {
      if (declaration.defaulted) {
        addEdge(graph, declarationNode(unit.file, 'default'), declarationNode(unit.file, declaration.name));
      }
    }
    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement)) {
        referencedEdges(statement.expression, declarationNode(unit.file, 'default'), unit.file, files,
          declarations, bindings, exportsByFile, graph);
      }
    }

    // Track `const ns = await import('./module')` and destructured dynamic imports.
    const dynamicBindings = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const call = importCallWithin(node.initializer);
        if (call) {
          const target = resolveModule(unit.file, (call.arguments[0] as ts.StringLiteral).text, files);
          if (target && ts.isIdentifier(node.name)) {
            bindings.set(node.name.text, { target, imported: '*' });
          } else if (target && ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (ts.isIdentifier(element.name)) {
                bindings.set(element.name.text, {
                  target,
                  imported: element.propertyName && ts.isIdentifier(element.propertyName)
                    ? element.propertyName.text : element.name.text,
                });
              }
            }
          }
        }
      }
      node.forEachChild(dynamicBindings);
    };
    dynamicBindings(sourceFile);

    for (const declaration of declarations.values()) {
      referencedEdges(
        declaration.node,
        declarationNode(unit.file, declaration.name),
        unit.file,
        files,
        declarations,
        bindings,
        exportsByFile,
        graph,
      );
    }

    // Module evaluation executes initializers and top-level statements, but it
    // does not by itself consume the binding exported by a variable.
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) || ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)) continue;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.initializer) {
            referencedEdges(declaration.initializer, moduleNode(unit.file), unit.file, files,
              declarations, bindings, exportsByFile, graph);
          }
        }
      } else {
        referencedEdges(statement, moduleNode(unit.file), unit.file, files,
          declarations, bindings, exportsByFile, graph);
      }
    }
  }

  const hasExplicitEntries = normalized.some((unit) => unit.isEntry);
  const rootsFor = (role: 'runtime' | 'build' | 'test') => normalized
    .filter((unit) => unit.role === role && (unit.isEntry || (!hasExplicitEntries && role !== 'test')))
    .concat(role === 'test' ? normalized.filter((unit) => unit.isTest) : [])
    .map((unit) => moduleNode(unit.file));
  const runtime = reachable(graph, rootsFor('runtime'));
  const build = reachable(graph, rootsFor('build'));
  const test = reachable(graph, rootsFor('test'));
  const testFileCounts = new Map<string, number>();
  for (const unit of normalized.filter((candidate) => candidate.isTest)) {
    for (const reached of reachable(graph, [moduleNode(unit.file)])) {
      if (!reached.startsWith('declaration\0')) continue;
      testFileCounts.set(reached, (testFileCounts.get(reached) ?? 0) + 1);
    }
  }

  const results: ExportReachability[] = [];
  for (const unit of normalized.filter((candidate) => !candidate.isTest && !excluded(candidate.file))) {
    for (const declaration of exportsByFile.get(unit.file) ?? []) {
      const key = declarationNode(unit.file, declaration.name);
      const status = runtime.has(key) ? 'runtime'
        : build.has(key) ? 'build-only'
          : test.has(key) ? 'test-only' : 'unreferenced';
      const testFiles = status === 'test-only' ? (testFileCounts.get(key) ?? 0) : 0;
      results.push({
        file: unit.file,
        name: declaration.name,
        kind: declaration.kind,
        testFiles,
        status,
      });
    }
  }
  return results;
}

/**
 * Which test files does no lane execute?
 *
 * A test file that no runner collects is worse than a deleted one: it still
 * greps as coverage, still reads as a promise in review, and its assertions rot
 * unobserved. `test/staging/failure-modes.test.ts` carried an always-green
 * try/catch for months for exactly this reason — nothing ever ran it, so
 * nothing ever noticed.
 *
 * The caller supplies what the runners themselves report collecting, so this
 * never re-derives include/exclude globs — reimplementing lane resolution here
 * would be the same drift this repo already paid for elsewhere. `allowed` is
 * the committed set of files deliberately left unrun; anything outside it is a
 * finding, and an allowlist entry that is no longer unrun is also a finding, so
 * the list cannot quietly outlive its reason.
 */
export interface UnrunFindings {
  unlisted: string[];
  staleAllowances: string[];
}

export function findUnrunTestFiles(
  onDisk: readonly string[],
  collected: readonly string[],
  allowed: readonly string[],
): UnrunFindings {
  const collectedSet = new Set(collected);
  const allowedSet = new Set(allowed);
  const unrun = onDisk.filter((file) => !collectedSet.has(file));
  const unrunSet = new Set(unrun);
  return {
    unlisted: unrun.filter((file) => !allowedSet.has(file)).sort(),
    staleAllowances: [...allowedSet].filter((file) => !unrunSet.has(file)).sort(),
  };
}
