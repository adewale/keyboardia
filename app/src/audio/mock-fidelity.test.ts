// @vitest-environment jsdom
/**
 * Mock-fidelity contract tests.
 *
 * Ad-hoc module mocks have no compile-time surface guarantee. This suite parses
 * every audio test that mocks ToneSynthManager, AdvancedSynthEngine, or the
 * audioEngine singleton, discovers the methods supplied by the double, and
 * checks them against the real production prototype. A new mock method is
 * covered automatically, so the contract cannot drift behind a hand-maintained
 * inventory.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ToneSynthManager } from './toneSynths';
import { AdvancedSynthEngine } from './advancedSynth';
import { AudioEngine } from './engine';

interface SourceContext {
  file: string;
  sourceFile: ts.SourceFile;
  bindings: Map<string, ts.Expression>;
  classes: Map<string, ts.ClassDeclaration>;
}

type DiscoveredMethods = Map<string, Set<string>>;

interface DiscoveryResult {
  tone: DiscoveredMethods;
  advanced: DiscoveredMethods;
  audioEngine: DiscoveredMethods;
  diagnostics: string[];
}

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const AUDIO_MODULES = {
  engine: resolve('src/audio/engine'),
  toneSynths: resolve('src/audio/toneSynths'),
  advancedSynth: resolve('src/audio/advancedSynth'),
};

function resolvesToAudioModule(
  specifier: string,
  fromFile: string,
  target: keyof typeof AUDIO_MODULES,
): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolvedSpecifier = resolve(dirname(fromFile), specifier)
    .replace(/\.(?:ts|tsx)$/, '');
  return resolvedSpecifier === AUDIO_MODULES[target];
}

function propertyName(node: ts.Node): string | undefined {
  const name = (node as ts.NamedDeclaration).name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function returnedExpression(expression: ts.Expression): ts.Expression | undefined {
  const resolved = unwrapExpression(expression);
  if (!ts.isArrowFunction(resolved) && !ts.isFunctionExpression(resolved)) return undefined;
  if (!ts.isBlock(resolved.body)) return resolved.body;
  return resolved.body.statements.find(ts.isReturnStatement)?.expression;
}

function sourceContextFromText(file: string, source: string): SourceContext {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = new Map<string, ts.Expression>();
  const classes = new Map<string, ts.ClassDeclaration>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    if (ts.isClassDeclaration(node) && node.name) classes.set(node.name.text, node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { file, sourceFile, bindings, classes };
}

function sourceContext(file: string): SourceContext {
  return sourceContextFromText(file, readFileSync(file, 'utf-8'));
}

function resolveNode(
  expression: ts.Expression,
  context: SourceContext,
  seen = new Set<string>(),
): ts.Node {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const name = current.text;
    if (seen.has(name)) return current;
    const nextSeen = new Set(seen).add(name);
    const classDeclaration = context.classes.get(name);
    if (classDeclaration) return classDeclaration;
    const binding = context.bindings.get(name);
    return binding ? resolveNode(binding, context, nextSeen) : current;
  }
  if (ts.isCallExpression(current) && current.expression.getText(context.sourceFile) === 'vi.hoisted') {
    const factoryResult = current.arguments[0] && returnedExpression(current.arguments[0]);
    return factoryResult ? resolveNode(factoryResult, context, seen) : current;
  }
  return current;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  context: SourceContext,
): ts.Node | undefined {
  const property = object.properties.find((candidate) =>
    propertyName(candidate) === name);
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return resolveNode(property.initializer, context);
  if (ts.isShorthandPropertyAssignment(property)) return resolveNode(property.name, context);
  return property;
}

function isFunctionValue(node: ts.Node, context: SourceContext): boolean {
  if (
    ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
  ) return true;
  if (ts.isCallExpression(node)) {
    return node.expression.getText(context.sourceFile).startsWith('vi.fn');
  }
  if (ts.isIdentifier(node)) {
    const resolved = resolveNode(node, context);
    return resolved !== node && isFunctionValue(resolved, context);
  }
  return false;
}

function record(target: DiscoveredMethods, method: string, file: string): void {
  const files = target.get(method) ?? new Set<string>();
  files.add(file);
  target.set(method, files);
}

function isTestOnlyMockMember(name: string): boolean {
  return name.startsWith('_') || name.endsWith('Spy');
}

function discoverMockedMethods(
  contexts: SourceContext[] = [
    ...testFiles(resolve('src')),
    ...testFiles(resolve('test')),
  ].map(sourceContext),
): DiscoveryResult {
  const tone: DiscoveredMethods = new Map();
  const advanced: DiscoveredMethods = new Map();
  const audioEngine: DiscoveredMethods = new Map();
  const diagnostics: string[] = [];

  for (const context of contexts) {
    const { file } = context;
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node)
        && node.expression.getText(context.sourceFile) === 'vi.mock'
        && node.arguments.length >= 1
        && ts.isStringLiteral(node.arguments[0])
      ) {
        const specifier = node.arguments[0].text;
        const classTarget = resolvesToAudioModule(specifier, file, 'toneSynths')
          ? { exportName: 'ToneSynthManager', methods: tone }
          : resolvesToAudioModule(specifier, file, 'advancedSynth')
            ? { exportName: 'AdvancedSynthEngine', methods: advanced }
            : undefined;
        const targetsAudioEngine = resolvesToAudioModule(specifier, file, 'engine');
        if (!classTarget && !targetsAudioEngine) {
          ts.forEachChild(node, visit);
          return;
        }

        const factory = node.arguments[1];
        const factoryResult = factory && returnedExpression(factory);
        const root = factoryResult && resolveNode(factoryResult, context);
        if (!root || !ts.isObjectLiteralExpression(root)) {
          diagnostics.push(`${file}: cannot enumerate vi.mock('${specifier}') factory`);
          ts.forEachChild(node, visit);
          return;
        }

        if (classTarget) {
          const replacement = objectProperty(root, classTarget.exportName, context);
          if (!replacement) {
            diagnostics.push(`${file}: vi.mock('${specifier}') does not expose ${classTarget.exportName}`);
          } else if (ts.isClassDeclaration(replacement) || ts.isClassExpression(replacement)) {
            for (const member of replacement.members) {
              const isMethod = ts.isMethodDeclaration(member);
              const isFunctionProperty = ts.isPropertyDeclaration(member)
                && member.initializer !== undefined
                && isFunctionValue(resolveNode(member.initializer, context), context);
              if (isMethod || isFunctionProperty) {
                const name = propertyName(member);
                if (!name) {
                  diagnostics.push(`${file}: unsupported computed mock class method`);
                  continue;
                }
                // These naming conventions mark test inspection helpers on a
                // replacement class, not methods supplied to production code.
                if (!isTestOnlyMockMember(name)) record(classTarget.methods, name, file);
              }
            }
          } else {
            diagnostics.push(`${file}: cannot enumerate mocked ${classTarget.exportName}`);
          }
        }

        if (targetsAudioEngine) {
          const replacement = objectProperty(root, 'audioEngine', context);
          if (!replacement) {
            diagnostics.push(`${file}: vi.mock('${specifier}') does not expose audioEngine`);
          } else if (ts.isObjectLiteralExpression(replacement)) {
            for (const member of replacement.properties) {
              if (ts.isSpreadAssignment(member)) {
                diagnostics.push(`${file}: cannot enumerate spread properties in audioEngine mock`);
                continue;
              }
              const name = propertyName(member);
              let value: ts.Node = member;
              if (ts.isPropertyAssignment(member)) value = resolveNode(member.initializer, context);
              if (ts.isShorthandPropertyAssignment(member)) value = resolveNode(member.name, context);
              if (isFunctionValue(value, context)) {
                if (!name) {
                  diagnostics.push(`${file}: unsupported computed audioEngine mock method`);
                } else {
                  record(audioEngine, name, file);
                }
              }
            }
          } else {
            diagnostics.push(`${file}: cannot enumerate audioEngine mock object`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(context.sourceFile);
  }

  return { tone, advanced, audioEngine, diagnostics };
}

function expectMethods(target: object, methods: DiscoveredMethods): void {
  expect(methods.size, 'mock discovery found no methods').toBeGreaterThan(0);
  for (const [method, files] of methods) {
    const value = (target as Record<string, unknown>)[method];
    expect(
      typeof value,
      `${method} is mocked in ${[...files].join(', ')} but is not a real prototype method`,
    ).toBe('function');
  }
}

const mocked = discoverMockedMethods();

describe('mock fidelity discovered from audio test doubles', () => {
  it('fully enumerates every relevant module mock', () => {
    expect(mocked.diagnostics).toEqual([]);
  });

  it('keeps ToneSynthManager doubles on the real prototype', () => {
    expectMethods(ToneSynthManager.prototype, mocked.tone);
  });

  it('keeps AdvancedSynthEngine doubles on the real prototype', () => {
    expectMethods(AdvancedSynthEngine.prototype, mocked.advanced);
  });

  it('keeps audioEngine singleton doubles on the real prototype', () => {
    expectMethods(AudioEngine.prototype, mocked.audioEngine);
  });

  it('discovers function-valued class fields', () => {
    const context = sourceContextFromText(
      resolve('src/audio/mock-field-fixture.test.ts'),
      `
        class MockToneSynthManager { playNote = vi.fn(); }
        vi.mock('./toneSynths', () => ({ ToneSynthManager: MockToneSynthManager }));
      `,
    );
    const result = discoverMockedMethods([context]);

    expect(result.diagnostics).toEqual([]);
    expect([...result.tone.keys()]).toEqual(['playNote']);
  });

  it.each([
    {
      name: 'an opaque factory',
      source: `vi.mock('./engine', () => makeAudioEngineMock());`,
      diagnostic: 'cannot enumerate',
    },
    {
      name: 'spread singleton methods',
      source: `
        const shared = { playSample: vi.fn() };
        vi.mock('./engine', () => ({ audioEngine: { ...shared } }));
      `,
      diagnostic: 'spread properties',
    },
  ])('fails closed for $name', ({ source, diagnostic }) => {
    const context = sourceContextFromText(
      resolve('src/audio/mock-unsupported-fixture.test.ts'),
      source,
    );

    expect(discoverMockedMethods([context]).diagnostics.join('\n')).toContain(diagnostic);
  });
});
