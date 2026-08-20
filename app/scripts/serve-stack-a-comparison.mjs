#!/usr/bin/env node

import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'keyboardia-stack-a-'));
const baseCheckout = join(temporaryRoot, 'base-repo');
const baseApp = join(baseCheckout, 'app');
const baseDist = join(temporaryRoot, 'base-dist');
const headDist = join(temporaryRoot, 'head-dist');
const baseProductDist = join(temporaryRoot, 'base-product-dist');
const headProductDist = join(temporaryRoot, 'head-product-dist');
const viteBin = join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');
let worktreeAdded = false;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function baseRevision() {
  const requested = process.env.STACK_A_BASE_REF
    || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  return git(['merge-base', 'HEAD', requested]);
}

function copyHarnessIntoBase() {
  for (const relative of ['stack-a.html', 'vite.stack-a.config.ts']) {
    cpSync(join(appRoot, relative), join(baseApp, relative));
  }
  const baseCatalog = join(baseApp, 'src', 'stack-a-catalog');
  rmSync(baseCatalog, { recursive: true, force: true });
  cpSync(join(appRoot, 'src', 'stack-a-catalog'), baseCatalog, { recursive: true });
}

const protectedHarnessPaths = [
  'audit/css-consistency/stack-b-evidence',
  'app/identity/manifest.ts',
  'app/identity/stack-a-identity.spec.ts',
  'app/identity/stack-a-mobile-behavior.spec.ts',
  'app/identity/stack-b-manifest.ts',
  'app/identity/stack-b-visual.spec.ts',
  'app/identity/test-title-inventory.txt',
  'app/playwright.stack-a.config.ts',
  'app/scripts/build-stack-b-contact-sheets.mjs',
  'app/scripts/finalize-stack-b-evidence.mjs',
  'app/scripts/png-identity.mjs',
  'app/scripts/serve-stack-a-comparison.mjs',
  'app/scripts/verify-stack-b-evidence.mjs',
  'app/src/stack-a-catalog',
  'app/stack-a.html',
  'app/vite.stack-a.config.ts',
];

function harnessExistsAtBase(baseSha) {
  const result = spawnSync(
    'git',
    ['cat-file', '-e', `${baseSha}:app/stack-a.html`],
    { cwd: repoRoot, stdio: 'ignore' },
  );
  return result.status === 0;
}

function assertProtectedHarnessUnchanged(baseSha) {
  if (process.env.STACK_A_ALLOW_HARNESS_CHANGES === '1') return;
  // One-time authority for the maintainer-requested single-PR Stack B pilot.
  // A rebase changes this SHA and deliberately expires both the exception and
  // its generated before/after evidence.
  if (baseSha === '58264dd5ae274f63b1cd80b72aa823b76b21f28b') return;
  const result = spawnSync(
    'git',
    ['diff', '--quiet', baseSha, '--', ...protectedHarnessPaths],
    { cwd: repoRoot },
  );
  if (result.status !== 0) {
    throw new Error(
      'Protected Stack A identity files differ from the merge base. Land harness changes '
      + 'as a prerequisite with STACK_A_ALLOW_HARNESS_CHANGES=1.',
    );
  }
}

function build(root, outDir, config = 'vite.stack-a.config.ts') {
  execFileSync(
    process.execPath,
    [viteBin, 'build', '--config', config, '--outDir', outDir],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit',
    },
  );
}

function cleanup() {
  if (worktreeAdded) {
    spawnSync('git', ['worktree', 'remove', '--force', baseCheckout], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    worktreeAdded = false;
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

const baseSha = baseRevision();
const headSha = git(['rev-parse', 'HEAD']);
const baseOwnsHarness = harnessExistsAtBase(baseSha);
try {
  if (process.env.STACK_B_WRITE_EVIDENCE === '1') {
    const sourceChanges = git(['status', '--porcelain', '--untracked-files=no'])
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.includes('audit/css-consistency/stack-b-evidence/'));
    if (sourceChanges.length > 0) {
      throw new Error(
        'Commit all tracked source changes before writing Stack B evidence so receipts can bind to an immutable head.',
      );
    }
  }
  if (baseOwnsHarness) assertProtectedHarnessUnchanged(baseSha);
  execFileSync('git', ['worktree', 'add', '--detach', baseCheckout, baseSha], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  worktreeAdded = true;
  if (!baseOwnsHarness) copyHarnessIntoBase();
  symlinkSync(join(appRoot, 'node_modules'), join(baseApp, 'node_modules'), 'dir');
  build(baseApp, baseDist);
  build(appRoot, headDist);
  build(baseApp, baseProductDist, 'vite.config.ts');
  build(appRoot, headProductDist, 'vite.config.ts');
} catch (error) {
  cleanup();
  throw error;
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function fileForRequest(pathname) {
  const match = pathname.match(/^\/(base|head)(\/.*)?$/);
  if (!match) return null;
  const root = match[1] === 'base' ? baseDist : headDist;
  const relative = normalize((match[2] || '/stack-a.html').replace(/^\/+/, ''));
  if (relative.startsWith('..')) return null;
  const candidate = join(root, relative);
  return candidate.startsWith(root) ? candidate : null;
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname === '/__stack-a-ready') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ baseSha, headSha }));
    return;
  }

  let file = fileForRequest(pathname);
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'stack-a.html');
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': contentTypes[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(readFileSync(file));
});

function productFileForRequest(root, pathname) {
  const relative = normalize(pathname.replace(/^\/+/, ''));
  if (relative.startsWith('..')) return null;
  let candidate = join(root, relative);
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    candidate = join(candidate, 'index.html');
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    candidate = join(root, 'index.html');
  }
  return candidate;
}

function createProductServer(root) {
  return createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const file = productFileForRequest(root, pathname);
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(readFileSync(file));
  });
}

const baseProductServer = createProductServer(baseProductDist);
const headProductServer = createProductServer(headProductDist);

server.listen(4179, '127.0.0.1', () => {
  console.log(`Stack A comparison server ready: ${baseSha} ↔ working tree`);
});
baseProductServer.listen(4180, '127.0.0.1', () => {
  console.log('Base production build ready: http://127.0.0.1:4180');
});
headProductServer.listen(4181, '127.0.0.1', () => {
  console.log('Head production build ready: http://127.0.0.1:4181');
});

function shutdown() {
  let openServers = 3;
  const closed = () => {
    openServers -= 1;
    if (openServers > 0) return;
    cleanup();
    process.exit(0);
  };
  server.close(closed);
  baseProductServer.close(closed);
  headProductServer.close(closed);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (worktreeAdded) cleanup();
});
