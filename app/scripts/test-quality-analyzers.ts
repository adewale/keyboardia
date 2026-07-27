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
}

export interface DeadExportFinding {
  file: string;
  name: string;
  kind: 'function' | 'const' | 'class';
  testFiles: number;
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

interface ImportedSymbol {
  target: string;
  name: string;
}

function canonical(file: string): string {
  return path.posix.normalize(file.replaceAll('\\', '/').replace(/^\.\//, ''));
}

function resolveModule(importer: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const raw = canonical(path.posix.join(path.posix.dirname(importer), specifier));
  const withoutJs = raw.replace(/\.(?:m?js)$/, '');
  const candidates = [raw, withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`,
    `${withoutJs}/index.ts`, `${withoutJs}/index.tsx`];
  return candidates.find((candidate) => files.has(candidate));
}

function importsFor(unit: SourceUnit, files: Set<string>): ImportedSymbol[] {
  const sourceFile = parse(unit.file, unit.source);
  const imports: ImportedSymbol[] = [];
  const add = (specifier: string, name: string) => {
    const target = resolveModule(canonical(unit.file), specifier, files);
    if (target) imports.push({ target, name });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) add(statement.moduleSpecifier.text, 'default');
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        add(statement.moduleSpecifier.text, '*');
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          add(statement.moduleSpecifier.text, element.propertyName?.text ?? element.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(statement)
      && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      if (!statement.exportClause) add(statement.moduleSpecifier.text, '*');
      else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          add(statement.moduleSpecifier.text, element.propertyName?.text ?? element.name.text);
        }
      }
    }
  }

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      add(node.arguments[0].text, '*');
    }
    node.forEachChild(walk);
  };
  walk(sourceFile);
  return imports;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function exportedDeclarations(sourceFile: ts.SourceFile): Array<{
  name: string;
  kind: DeadExportFinding['kind'];
}> {
  const exports: Array<{ name: string; kind: DeadExportFinding['kind'] }> = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: 'function' });
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: 'class' });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.push({ name: declaration.name.text, kind: 'const' });
      }
    }
  }
  return exports;
}

function identifierCount(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) count++;
    node.forEachChild(walk);
  };
  walk(sourceFile);
  return count;
}

/**
 * Find exports with no production importer. Import names are matched to their
 * resolved module, so an unrelated export with the same name cannot make a
 * dead symbol look live.
 */
export function analyzeDeadExports(
  units: SourceUnit[],
  excluded: (file: string) => boolean = () => false,
): DeadExportFinding[] {
  const normalized = units.map((unit) => ({ ...unit, file: canonical(unit.file) }));
  const files = new Set(normalized.map((unit) => unit.file));
  const imports = normalized.map((unit) => ({ unit, imports: importsFor(unit, files) }));
  const findings: DeadExportFinding[] = [];

  for (const unit of normalized.filter((candidate) => !candidate.isTest && !excluded(candidate.file))) {
    const sourceFile = parse(unit.file, unit.source);
    for (const declaration of exportedDeclarations(sourceFile)) {
      if (identifierCount(sourceFile, declaration.name) > 1) continue;
      const importedByProd = imports.some(({ unit: importer, imports: symbols }) =>
        !importer.isTest && importer.file !== unit.file
        && symbols.some((symbol) => symbol.target === unit.file
          && (symbol.name === declaration.name || symbol.name === '*')));
      if (importedByProd) continue;
      const testFiles = imports.filter(({ unit: importer, imports: symbols }) =>
        importer.isTest && symbols.some((symbol) => symbol.target === unit.file
          && (symbol.name === declaration.name || symbol.name === '*'))).length;
      findings.push({ file: unit.file, ...declaration, testFiles });
    }
  }
  return findings;
}
