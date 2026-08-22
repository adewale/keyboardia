import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const appRoot = resolve(new URL('..', import.meta.url).pathname);
const genericNames = [
  'category-header',
  'category-label',
  'category-options',
  'menu-category',
  'option-check',
  'option-label',
  'option-value',
];
const requiredRootTokens = [
  '--color-selection-glow-rgb',
  '--color-fx-active-muted',
  '--color-fx-active-muted-hover',
  '--color-fx-bypassed-muted',
  '--color-fx-bypassed-muted-hover',
  '--font-mono',
  '--color-accent-text',
  '--color-blue-text',
  '--color-purple-text',
  '--color-pink-text',
  '--color-error-text',
  '--color-on-bright',
  '--color-on-purple',
  '--color-on-pink',
];
const nonTextPaletteTokens = new Set([
  '--color-text-dimmed',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-light',
  '--color-brand',
  '--color-blue',
  '--color-info',
  '--color-purple',
  '--color-teal',
  '--color-cyan',
  '--color-pink',
  '--color-green',
  '--color-orange',
  '--color-yellow',
  '--color-red',
  '--color-success',
  '--color-warning',
  '--color-error',
  '--color-danger',
  '--color-secondary',
]);
const featureFillPattern = /var\(--color-(?:accent|blue|info|purple|teal|cyan|pink|green|orange|yellow|red|success|warning|error)\b/;

function filesBelow(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function gitFiles(ref) {
  return execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', ref, '--', 'app/src'],
    { cwd: resolve(appRoot, '..'), encoding: 'utf8' },
  ).trim().split('\n').filter((path) => path.endsWith('.css'));
}

function sourceReader(ref) {
  if (!ref) {
    const paths = filesBelow(join(appRoot, 'src'))
      .filter((path) => extname(path) === '.css')
      .map((path) => relative(resolve(appRoot, '..'), path));
    return {
      paths,
      read: (path) => readFileSync(resolve(appRoot, '..', path), 'utf8'),
    };
  }
  const paths = gitFiles(ref);
  return {
    paths,
    read: (path) => execFileSync(
      'git',
      ['show', `${ref}:${path}`],
      { cwd: resolve(appRoot, '..'), encoding: 'utf8' },
    ),
  };
}

function declarationList(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:--)?[a-zA-Z][\w-]*\s*:/.test(line))
    .map((line) => line.replace(/\s+/g, ' ').replace(/;$/, ''));
}

function multiset(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function overlap(left, right) {
  const a = multiset(left);
  const b = multiset(right);
  let count = 0;
  for (const [value, occurrences] of a) {
    count += Math.min(occurrences, b.get(value) ?? 0);
  }
  return count;
}

function unscopedGenericSelectors(css, path) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const findings = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    for (const name of genericNames) {
      if (new RegExp(`(^|,)\\s*\\.${name}(?=[\\s:{.#,>+~]|$)`).test(selector)) {
        findings.push(`${path}: ${selector}`);
      }
    }
  }
  return findings;
}

function rootDefinitions(indexCss) {
  const rootBlock = indexCss.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  return new Set(
    [...rootBlock.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
}

function unsafeTextTokenUsages(css, path) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutComments.split('\n').flatMap((line, index) => {
    const token = line.match(/^\s*color\s*:\s*var\((--[a-zA-Z0-9-]+)/)?.[1];
    return token && nonTextPaletteTokens.has(token)
      ? [`${path}:${index + 1}: ${line.trim()}`]
      : [];
  });
}

function unsafeFilledControlForegrounds(css, path) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const findings = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const body = match[2];
    const background = body.match(/(?:^|;)\s*(?:background|background-color)\s*:\s*([^;]+)/)?.[1];
    const foreground = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1]?.trim();
    if (
      background
      && featureFillPattern.test(background)
      && foreground
      && /^(?:white|#fff(?:fff)?|var\(--color-text\))$/i.test(foreground)
    ) {
      findings.push(`${path}: ${selector}`);
    }
  }
  return findings;
}

export function collectCssConsistencyMetrics(ref) {
  const source = sourceReader(ref);
  const productPaths = source.paths.filter((path) => !path.includes('/stack-a-catalog/'));
  const cssByPath = new Map(productPaths.map((path) => [path, source.read(path)]));
  const allCss = [...cssByPath.values()].join('\n');
  const indexPath = productPaths.find((path) => path.endsWith('/src/index.css'));
  const indexCss = indexPath ? cssByPath.get(indexPath) : '';
  const rootTokens = rootDefinitions(indexCss ?? '');
  const stepPath = productPaths.find((path) => path.endsWith('/StepCountDropdown.css'));
  const transposePath = productPaths.find((path) => path.endsWith('/TransposeDropdown.css'));
  const sharedPath = productPaths.find((path) => path.endsWith('/Dropdown.css'));
  const stepDeclarations = stepPath ? declarationList(cssByPath.get(stepPath)) : [];
  const transposeDeclarations = transposePath ? declarationList(cssByPath.get(transposePath)) : [];
  const sharedDeclarations = sharedPath ? declarationList(cssByPath.get(sharedPath)) : [];
  const unscoped = productPaths.flatMap((path) => unscopedGenericSelectors(cssByPath.get(path), path));
  const unsafeTextTokens = productPaths.flatMap((path) => unsafeTextTokenUsages(cssByPath.get(path), path));
  const unsafeFilledForegrounds = productPaths.flatMap((path) => (
    unsafeFilledControlForegrounds(cssByPath.get(path), path)
  ));
  const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;
  const rawColorsOutsideIndex = productPaths
    .filter((path) => path !== indexPath)
    .reduce((total, path) => total + (cssByPath.get(path).match(rawColorPattern)?.length ?? 0), 0);
  const undefinedRequiredTokens = requiredRootTokens.filter((token) => !rootTokens.has(token));

  const componentSource = ref
    ? execFileSync(
        'git',
        ['ls-tree', '-r', '--name-only', ref, '--', 'app/src/components'],
        { cwd: resolve(appRoot, '..'), encoding: 'utf8' },
      ).trim().split('\n')
        .filter((path) => path.endsWith('.tsx'))
        .filter((path) => execFileSync(
          'git',
          ['show', `${ref}:${path}`],
          { cwd: resolve(appRoot, '..'), encoding: 'utf8' },
        ).includes('dropdown-menu'))
    : filesBelow(join(appRoot, 'src', 'components'))
        .filter((path) => path.endsWith('.tsx'))
        .filter((path) => {
          const component = readFileSync(path, 'utf8');
          return component.includes("import './Dropdown.css'") && component.includes('dropdown-menu');
        });

  return {
    ref: ref ?? 'working-tree',
    productCssFiles: productPaths.length,
    productCssLines: allCss.split('\n').length - 1,
    productDeclarations: declarationList(allCss).length,
    rawColorsOutsideIndex,
    importantDeclarations: (allCss.match(/!important\b/g) ?? []).length,
    unscopedGenericSelectors: unscoped,
    unsafeTextTokenUsages: unsafeTextTokens,
    unsafeFilledControlForegrounds: unsafeFilledForegrounds,
    undefinedRequiredTokens,
    dropdown: {
      files: [stepPath, transposePath, sharedPath].filter(Boolean),
      declarations: stepDeclarations.length + transposeDeclarations.length + sharedDeclarations.length,
      duplicatedDeclarationsBetweenComponents: overlap(stepDeclarations, transposeDeclarations),
      sharedConsumers: componentSource.length,
    },
  };
}
