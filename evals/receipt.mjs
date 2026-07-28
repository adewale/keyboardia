import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

export const RECEIPT_SCHEMA_VERSION = 2;
export const REDACTED_CAPABILITY = '<redacted-session-id>';

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

export function gitBlobSha1(value) {
  return gitObjectSha1('blob', value);
}

export function gitObjectSha1(type, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`${type} ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

export function sanitizeReceiptText(value) {
  return String(value)
    .replace(/\/(?:private\/)?var\/folders\/[^\s"'`]+/g, '<temp-path>')
    .replace(/\/private\/tmp\/[^\s"'`]+/g, '<temp-path>')
    .replace(/\/tmp\/[^\s"'`]+/g, '<temp-path>')
    .replace(/\/Users\/[^/\s"'`]+\/[^\s"'`]+/g, '<workspace-path>');
}

function sanitizeReceiptValue(value) {
  if (typeof value === 'string') return sanitizeReceiptText(value);
  if (Array.isArray(value)) return value.map(sanitizeReceiptValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      sanitizeReceiptText(key),
      sanitizeReceiptValue(entry),
    ]));
  }
  return value;
}

const HOST_PATHS = [
  /\/(?:private\/)?var\/folders\//i,
  /\/Users\/[^/\s"'`]+\//,
  /\/home\/[^/\s"'`]+\//,
  /\/(?:private\/)?tmp\/[^\s"'`]+/,
  /[A-Za-z]:\\Users\\[^\\\s"'`]+\\/,
];

function hostPathPresent(value) {
  if (typeof value === 'string') return HOST_PATHS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(hostPathPresent);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) =>
      hostPathPresent(key) || hostPathPresent(entry));
  }
  return false;
}

export function receiptContainsHostPath(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  const copy = structuredClone(receipt);
  for (const file of copy.source?.files ?? []) delete file.content;
  return hostPathPresent(copy);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function lengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function resolveAvailableModule(base, spec, available) {
  const clean = String(spec).split(/[?#]/, 1)[0];
  const candidate = posix.normalize(posix.join(base, clean));
  const suffixes = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json', '.py'];
  const choices = [candidate];
  if (!posix.extname(candidate)) choices.push(...suffixes.map((suffix) => `${candidate}${suffix}`));
  if (/\.(?:js|mjs|cjs)$/.test(candidate)) {
    choices.push(...['.ts', '.mts', '.cts', '.tsx', '.jsx']
      .map((suffix) => candidate.replace(/\.(?:js|mjs|cjs)$/, suffix)));
  }
  choices.push(...suffixes.map((suffix) => `${candidate}/index${suffix}`));
  choices.push(`${candidate}/__init__.py`);
  const packagePath = `${candidate}/package.json`;
  if (available.has(packagePath)) {
    try {
      const packageJson = JSON.parse(available.get(packagePath));
      for (const field of ['module', 'main']) {
        if (typeof packageJson[field] === 'string') {
          choices.splice(1, 0, posix.normalize(posix.join(candidate, packageJson[field])));
        }
      }
    } catch {
      // A malformed package cannot contribute a resolvable local dependency.
    }
  }
  return choices.find((choice) => available.has(choice)) ?? null;
}

function localSourceImports(path, content, available, manifestDir) {
  const resolved = new Set();
  const suffix = posix.extname(path).toLowerCase();
  const firstLine = content.split('\n', 1)[0];
  const addModule = (base, spec) => {
    const dependency = resolveAvailableModule(base, spec, available);
    if (!dependency) throw new Error(`cannot resolve local oracle dependency ${spec} imported by ${path}`);
    resolved.add(dependency);
  };
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'].includes(suffix)
      || (!suffix && /(?:node|deno|bun)/.test(firstLine))) {
    const pattern = /(?:\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?|\brequire\s*\(|\bimport\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
    for (const match of content.matchAll(pattern)) addModule(posix.dirname(path), match[1]);
  } else if (suffix === '.py' || (!suffix && /python/.test(firstLine))) {
    for (const match of content.matchAll(/^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gm)) {
      const spec = match[1].replaceAll('.', '/');
      for (const base of [posix.dirname(path), manifestDir, '.']) {
        const dependency = resolveAvailableModule(base, spec, available);
        if (dependency) {
          resolved.add(dependency);
          break;
        }
      }
    }
    for (const match of content.matchAll(/^\s*from\s+(\.*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?\s+import\s+([^\n#]+)/gm)) {
      const dots = match[1].length;
      let base = posix.dirname(path);
      for (let index = 1; index < dots; index += 1) base = posix.dirname(base);
      const moduleSpec = (match[2] ?? '').replaceAll('.', '/');
      const roots = dots > 0 ? [base] : [posix.dirname(path), manifestDir, '.'];
      let parentResolved = false;
      for (const root of roots) {
        const dependency = resolveAvailableModule(root, moduleSpec, available);
        if (dependency) {
          resolved.add(dependency);
          parentResolved = true;
          break;
        }
      }
      for (const imported of match[3].split(',').map((name) => name.trim().split(/\s+as\s+/)[0])) {
        if (!imported || imported === '*') continue;
        const childSpec = [moduleSpec, imported].filter(Boolean).join('/');
        for (const root of roots) {
          const dependency = resolveAvailableModule(root, childSpec, available);
          if (dependency) {
            resolved.add(dependency);
            break;
          }
        }
      }
      if (dots > 0 && moduleSpec && !parentResolved) {
        throw new Error(`cannot resolve local oracle dependency ${match[1]}${match[2] ?? ''} imported by ${path}`);
      }
    }
  } else if (['.sh', '.bash', '.zsh'].includes(suffix) || (!suffix && /sh/.test(firstLine))) {
    for (const match of content.matchAll(/^\s*(?:source|\.)\s+([^\s;&|]+)/gm)) {
      const spec = match[1].replace(/^['"]|['"]$/g, '');
      if (!/[\$`]/.test(spec)) addModule(posix.dirname(path), spec);
    }
  }
  return [...resolved];
}

export function skillEvalInputBundleHash({ manifestPath, manifestContent, caseId, sourceFiles }) {
  const manifest = JSON.parse(manifestContent);
  const evalCase = (manifest.cases ?? []).find((candidate) => candidate.id === caseId);
  if (!evalCase || typeof evalCase.prompt !== 'string') {
    throw new Error(`cannot build input bundle for case ${caseId}`);
  }
  const source = new Map(sourceFiles.map((file) => [file.path, file.content]));
  const manifestDir = posix.dirname(manifestPath);
  const entries = [{ role: 'manifest', logical: manifestPath, payload: manifestContent }, {
    role: 'prompt',
    logical: `case/${caseId}/prompt`,
    payload: evalCase.prompt,
  }];
  for (const relativePath of evalCase.files ?? []) {
    const logical = posix.normalize(posix.join(manifestDir, relativePath));
    if (!source.has(logical)) throw new Error(`input bundle is missing fixture ${logical}`);
    entries.push({ role: 'fixture', logical, payload: source.get(logical) });
  }
  const roots = [];
  for (const assertion of evalCase.assertions ?? []) {
    if (assertion.type !== 'script' || !Array.isArray(assertion.command)) continue;
    const logical = assertion.command.map((part) =>
      posix.normalize(posix.join(manifestDir, String(part))))
      .find((candidate) => source.has(candidate));
    if (!logical) throw new Error(`input bundle cannot resolve script oracle for ${caseId}`);
    roots.push(logical);
  }
  const available = new Set(source.keys());
  const visited = new Set();
  const visit = (logical) => {
    if (visited.has(logical)) return;
    visited.add(logical);
    const content = source.get(logical);
    if (typeof content !== 'string') throw new Error(`input bundle is missing oracle ${logical}`);
    entries.push({ role: 'oracle', logical, payload: content });
    for (const dependency of localSourceImports(logical, content, source, manifestDir)) visit(dependency);
  };
  for (const root of roots) visit(root);
  entries.sort((left, right) => left.role.localeCompare(right.role)
    || left.logical.localeCompare(right.logical));
  const hash = createHash('sha256').update('skill-eval-input-bundle-v1\0', 'utf8');
  for (const entry of entries) {
    lengthPrefixed(hash, entry.role);
    lengthPrefixed(hash, entry.logical);
    lengthPrefixed(hash, entry.payload);
  }
  return hash.digest('hex');
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function encodedCapabilityPattern(sessionId) {
  const source = [...sessionId].map((character) => {
    const codePoint = character.codePointAt(0);
    const unicode = `\\\\u${codePoint.toString(16).padStart(4, '0')}`;
    const percent = `%${codePoint.toString(16).padStart(2, '0')}`;
    return `(?:${regexEscape(character)}|${unicode}|${percent})`;
  }).join('');
  return new RegExp(source, 'gi');
}

function decodePercentRuns(value) {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

function decodedPercentValue(value) {
  let decoded = value;
  while (true) {
    const next = decodePercentRuns(decoded);
    if (next === decoded) return decoded;
    decoded = next;
  }
}

function stringContainsCapability(value, sessionId) {
  if (encodedCapabilityPattern(sessionId).test(value)) return true;
  return encodedCapabilityPattern(sessionId).test(decodedPercentValue(value));
}

export function capabilityPresent(value, sessionId) {
  if (typeof value === 'string') return stringContainsCapability(value, sessionId);
  if (Array.isArray(value)) return value.some((entry) => capabilityPresent(entry, sessionId));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) =>
      capabilityPresent(key, sessionId) || capabilityPresent(entry, sessionId));
  }
  return false;
}

export function redactCapability(value, sessionId) {
  if (typeof value === 'string') {
    const direct = value.replace(encodedCapabilityPattern(sessionId), REDACTED_CAPABILITY);
    if (direct !== value) return direct;
    const decoded = decodedPercentValue(value);
    return encodedCapabilityPattern(sessionId).test(decoded)
      ? decoded.replace(encodedCapabilityPattern(sessionId), REDACTED_CAPABILITY)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCapability(entry, sessionId));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactCapability(key, sessionId),
        redactCapability(entry, sessionId),
      ])
    );
  }
  return value;
}

export function redactCapabilities(value, sessionIds) {
  let redacted = value;
  for (const sessionId of sessionIds) {
    redacted = redactCapability(redacted, sessionId);
  }
  return redacted;
}

export function assertCapabilitiesAbsent(value, sessionIds) {
  for (const sessionId of sessionIds) {
    if (capabilityPresent(value, sessionId)) {
      throw new Error('receipt still contains a registered Keyboardia edit capability');
    }
  }
}

function git(repoRoot, args, { bytes = false, optional = false, input = undefined } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: bytes ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    input,
  });
  if (result.status !== 0) {
    if (optional) return null;
    const message = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr ?? '').trim();
    throw new Error(`git ${args.join(' ')} failed${message ? `: ${message}` : ''}`);
  }
  return bytes ? result.stdout : result.stdout.trim();
}

function decodeGitTree(raw) {
  const entries = [];
  for (const row of raw.toString('utf8').split('\0')) {
    if (!row) continue;
    const tab = row.indexOf('\t');
    if (tab < 0) throw new Error('git ls-tree returned a malformed row');
    const [mode, type, object] = row.slice(0, tab).split(' ');
    const path = row.slice(tab + 1);
    if (!['100644', '100755', '120000'].includes(mode) || type !== 'blob'
        || !/^[0-9a-f]{40}$/.test(object)) {
      throw new Error(`unsupported Git tree entry at ${path}`);
    }
    if (!path || isAbsolute(path) || path.split('/').includes('..') || path.includes('\0')) {
      throw new Error(`invalid Git tree path: ${path}`);
    }
    entries.push({ mode, object, path });
  }
  return entries;
}

function gitTreeSnapshot(repoRoot, treeish) {
  const entries = decodeGitTree(git(repoRoot, ['ls-tree', '-r', '-z', treeish], { bytes: true }));
  return {
    version: 1,
    entries: entries.map((entry) => {
      const bytes = git(repoRoot, ['cat-file', 'blob', entry.object], { bytes: true });
      if (gitBlobSha1(bytes) !== entry.object) {
        throw new Error(`Git blob ${entry.object} failed self-verification`);
      }
      return { ...entry, content_base64: bytes.toString('base64') };
    }),
  };
}

export function createPatchedGitBinding(repoRoot) {
  const root = realpathSync(resolve(repoRoot));
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all']);
  if (dirty) throw new Error('patched Git checkout must have no tracked or untracked changes');
  const history = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
  if (history.length !== 2) throw new Error('patched Git checkout must have exactly one parent');
  const [gitCommit, parentGitCommit] = history;
  const gitTree = git(root, ['show', '-s', '--format=%T', gitCommit]);
  const parentGitTree = git(root, ['show', '-s', '--format=%T', parentGitCommit]);
  const commit = git(root, ['cat-file', 'commit', gitCommit], { bytes: true });
  const parentCommit = git(root, ['cat-file', 'commit', parentGitCommit], { bytes: true });
  const patch = git(root, ['diff', '--binary', parentGitCommit, gitCommit], { bytes: true });
  if (gitTree === parentGitTree || patch.length === 0) {
    throw new Error('patched Git checkout HEAD must change its parent tree');
  }
  return {
    gitCommit,
    gitTree,
    parentGitCommit,
    parentGitTree,
    commit,
    parentCommit,
    parentTreeSnapshot: gitTreeSnapshot(root, parentGitCommit),
    patch,
  };
}

function checkedRelativePath(repoRoot, path) {
  const root = resolve(repoRoot);
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`bound input must be a file below the repository root: ${path}`);
  }
  return rel.split(sep).join('/');
}

export function createSourceBinding(repoRoot, inputs) {
  const root = realpathSync(resolve(repoRoot));
  const gitRoot = realpathSync(resolve(git(root, ['rev-parse', '--show-toplevel'])));
  if (gitRoot !== root) {
    throw new Error(`receipt repository root must be ${gitRoot}`);
  }
  const gitCommit = git(root, ['rev-parse', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all']);
  if (dirty) {
    throw new Error('cannot create a durable receipt from a dirty or untracked worktree');
  }
  const gitTree = git(root, ['show', '-s', '--format=%T', gitCommit]);
  const repository = git(root, ['config', '--get', 'remote.origin.url'], { optional: true }) ?? 'local';
  const files = inputs.map((input) => {
    const path = checkedRelativePath(root, input.path);
    const bytes = input.bytes ?? readFileSync(resolve(root, path));
    const committed = git(root, ['show', `${gitCommit}:${path}`], { bytes: true });
    const currentSha256 = sha256(bytes);
    const committedSha256 = sha256(committed);
    if (currentSha256 !== committedSha256) {
      throw new Error(
        `cannot create a durable receipt: ${path} does not match ${gitCommit}`
      );
    }
    return {
      role: input.role,
      path,
      sha256: currentSha256,
      git_blob: git(root, ['rev-parse', `${gitCommit}:${path}`]),
      encoding: 'utf-8',
      content: (() => {
        const content = bytes.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(bytes)) {
          throw new Error(`bound source file is not UTF-8 text: ${path}`);
        }
        return content;
      })(),
    };
  });
  return {
    repository,
    git_commit: gitCommit,
    git_tree: gitTree,
    files,
  };
}

export function addArtifact(
  artifacts,
  content,
  mediaType = 'text/plain',
  { sanitize = true } = {},
) {
  const text = sanitize ? sanitizeReceiptText(content) : String(content);
  const ref = `sha256:${sha256(text)}`;
  const existing = artifacts[ref];
  if (existing && existing.content !== text) {
    throw new Error(`artifact hash collision at ${ref}`);
  }
  artifacts[ref] = {
    media_type: mediaType,
    encoding: 'utf-8',
    content: text,
  };
  return ref;
}

function cloneJson(value) {
  return value === undefined ? undefined : sanitizeReceiptValue(JSON.parse(JSON.stringify(value)));
}

function artifactRef(artifacts, value, mediaType) {
  return value === undefined || value === null
    ? null
    : addArtifact(artifacts, mediaType === 'application/json' ? canonicalJson(value) : value, mediaType);
}

function receiptRun(run, artifacts) {
  const copy = cloneJson(run);
  const prompt = copy.prompt;
  const response = copy.response;
  const trace = copy.execution?.trace ?? copy.trace;
  const attempts = copy.attempts;
  const executionState = copy.execution
    ? { baseline: copy.execution.baseline, final: copy.execution.final }
    : null;
  delete copy.prompt;
  delete copy.response;
  delete copy.trace;
  delete copy.execution;
  delete copy.attempts;

  copy.prompt_ref = artifactRef(artifacts, prompt, 'text/plain');
  copy.output_ref = artifactRef(artifacts, response, 'text/plain');
  copy.trace_ref = artifactRef(artifacts, trace, 'application/json');
  copy.execution_ref = artifactRef(artifacts, executionState, 'application/json');
  copy.attempts = (attempts ?? []).map((attempt) => ({
    ok: attempt.ok,
    error: attempt.error,
    usage: attempt.usage ?? null,
    prompt_ref: artifactRef(artifacts, attempt.prompt, 'text/plain'),
    output_ref: artifactRef(artifacts, attempt.text, 'text/plain'),
    trace_ref: artifactRef(artifacts, attempt.trace, 'application/json'),
  }));

  copy.assertions = (copy.assertions ?? []).map((assertion) => {
    if (!assertion.judge) return assertion;
    const judge = assertion.judge;
    const recorded = { ...assertion };
    delete recorded.judge;
    recorded.judge = {
      model: judge.model ?? null,
      adapter: judge.adapter,
      prompt_ref: artifactRef(artifacts, judge.prompt, 'text/plain'),
      output_ref: artifactRef(artifacts, judge.response, 'text/plain'),
      usage: judge.usage ?? null,
    };
    return recorded;
  });
  return copy;
}

export function buildReceipt({ source, harness, invocation, runs, summary, capabilities = [] }) {
  const capabilityCount = [...capabilities].length;
  const artifacts = {};
  const receipt = {
    $schema: '../receipt.schema.json',
    schema_version: RECEIPT_SCHEMA_VERSION,
    receipt_id: `${invocation.suite}-${source.git_commit.slice(0, 12)}-${Date.now()}`,
    generated_at: new Date().toISOString(),
    source,
    harness,
    invocation,
    redaction: capabilityCount > 0 ? {
      policy: 'keyboardia-capability-v1',
      replacement: REDACTED_CAPABILITY,
      verified_in_process: true,
      registered_capabilities: capabilityCount,
    } : {
      policy: 'offline-eval-no-live-capability-registry-v1',
      replacement: REDACTED_CAPABILITY,
      verified_in_process: false,
      registered_capabilities: 0,
    },
    artifacts,
    runs: runs.map((run) => receiptRun(run, artifacts)),
    summary: cloneJson(summary),
  };
  assertCapabilitiesAbsent(receipt, capabilities);
  return receipt;
}

function requireValue(condition, message, errors) {
  if (!condition) errors.push(message);
}

function isHex(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function commitIdentity(payload) {
  const text = String(payload);
  const header = text.slice(0, text.indexOf('\n\n') < 0 ? text.length : text.indexOf('\n\n'));
  const tree = header.match(/^tree ([0-9a-f]{40})$/m)?.[1] ?? null;
  const parents = [...header.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((match) => match[1]);
  return { tree, parents };
}

function reconstructPatchedTree(
  snapshot,
  patch,
  expectedParentTree,
  parentCommit,
  expectedParentCommit,
) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    throw new Error('harness parent tree snapshot is invalid or empty');
  }
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'keyboardia-harness-receipt-'));
  try {
    git(tempRoot, ['init', '-q']);
    const seen = new Set();
    for (const entry of snapshot.entries) {
      if (!entry || !['100644', '100755', '120000'].includes(entry.mode)
          || !isHex(entry.object, 40) || typeof entry.path !== 'string'
          || !entry.path || isAbsolute(entry.path) || entry.path.split('/').includes('..')
          || typeof entry.content_base64 !== 'string' || seen.has(entry.path)) {
        throw new Error(`invalid harness parent tree entry: ${entry?.path ?? '<missing>'}`);
      }
      seen.add(entry.path);
      const bytes = Buffer.from(entry.content_base64, 'base64');
      if (bytes.toString('base64') !== entry.content_base64) {
        throw new Error(`invalid base64 in harness parent tree entry: ${entry.path}`);
      }
      const object = git(tempRoot, ['hash-object', '-w', '--stdin'], { input: bytes });
      if (object !== entry.object || gitBlobSha1(bytes) !== entry.object) {
        throw new Error(`harness parent blob mismatch: ${entry.path}`);
      }
      git(tempRoot, ['update-index', '--add', '--cacheinfo', entry.mode, entry.object, entry.path]);
    }
    const parentTree = git(tempRoot, ['write-tree']);
    if (parentTree !== expectedParentTree) {
      throw new Error('harness parent snapshot does not match parent_git_tree');
    }
    const parentObject = git(tempRoot, ['hash-object', '-t', 'commit', '-w', '--stdin'], {
      input: Buffer.from(parentCommit, 'utf8'),
    });
    if (parentObject !== expectedParentCommit) {
      throw new Error('harness parent commit cannot be reconstructed');
    }
    git(tempRoot, ['update-ref', 'refs/heads/receipt-parent', parentObject]);
    git(tempRoot, ['symbolic-ref', 'HEAD', 'refs/heads/receipt-parent']);
    git(tempRoot, ['reset', '--hard', parentObject]);
    git(tempRoot, ['apply', '--index', '--binary', '--whitespace=nowarn', '-'], {
      input: Buffer.from(patch, 'utf8'),
    });
    return git(tempRoot, ['write-tree']);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function artifactContent(receipt, ref, label, errors) {
  if (typeof ref !== 'string' || !Object.hasOwn(receipt.artifacts ?? {}, ref)) {
    errors.push(`${label} has a dangling artifact reference`);
    return null;
  }
  return receipt.artifacts[ref]?.content ?? null;
}

function verifyPatchedHarness(receipt, errors) {
  const harness = receipt.harness ?? {};
  const fields = [
    'git_tree',
    'parent_git_commit',
    'parent_git_tree',
    'patch_ref',
    'parent_tree_ref',
    'commit_ref',
    'parent_commit_ref',
  ];
  const patched = fields.some((field) => harness[field] !== undefined && harness[field] !== null);
  if (!patched) return;
  for (const field of ['git_tree', 'parent_git_commit', 'parent_git_tree']) {
    requireValue(isHex(harness[field], 40),
      `harness.${field} must be 40 lowercase hex characters`, errors);
  }
  for (const field of ['patch_ref', 'parent_tree_ref', 'commit_ref', 'parent_commit_ref']) {
    requireValue(typeof harness[field] === 'string', `harness.${field} is required`, errors);
  }
  const patch = artifactContent(receipt, harness.patch_ref, 'harness.patch_ref', errors);
  const snapshotRaw = artifactContent(receipt, harness.parent_tree_ref, 'harness.parent_tree_ref', errors);
  const commit = artifactContent(receipt, harness.commit_ref, 'harness.commit_ref', errors);
  const parentCommit = artifactContent(
    receipt,
    harness.parent_commit_ref,
    'harness.parent_commit_ref',
    errors,
  );
  if ([patch, snapshotRaw, commit, parentCommit].some((value) => value === null)) return;
  requireValue(patch.length > 0 && harness.git_tree !== harness.parent_git_tree,
    'harness patch must change the parent tree', errors);
  requireValue(gitObjectSha1('commit', commit) === harness.git_commit,
    'harness commit artifact does not match harness.git_commit', errors);
  requireValue(gitObjectSha1('commit', parentCommit) === harness.parent_git_commit,
    'harness parent commit artifact does not match harness.parent_git_commit', errors);
  const commitHeader = commitIdentity(commit);
  const parentHeader = commitIdentity(parentCommit);
  requireValue(commitHeader.tree === harness.git_tree,
    'harness commit artifact does not name harness.git_tree', errors);
  requireValue(commitHeader.parents.length === 1
    && commitHeader.parents[0] === harness.parent_git_commit,
  'harness commit artifact does not name the claimed single parent', errors);
  requireValue(parentHeader.tree === harness.parent_git_tree,
    'harness parent commit artifact does not name parent_git_tree', errors);
  let snapshot;
  try {
    snapshot = JSON.parse(snapshotRaw);
  } catch (error) {
    errors.push(`harness parent tree snapshot is not JSON: ${error.message}`);
    return;
  }
  try {
    const reconstructed = reconstructPatchedTree(
      snapshot,
      patch,
      harness.parent_git_tree,
      parentCommit,
      harness.parent_git_commit,
    );
    requireValue(reconstructed === harness.git_tree,
      'harness patch does not reconstruct harness.git_tree', errors);
  } catch (error) {
    errors.push(`harness reconstruction failed: ${error.message}`);
  }
}

export function answerMatrixSummary(benchmark, audit) {
  return {
    results: benchmark.results.length,
    summary: benchmark.summary,
    paired_summary: benchmark.paired_summary,
    by_model: benchmark.by_model,
    case_flags: benchmark.case_flags,
    reliability: benchmark.reliability,
    audit: {
      readiness: audit.readiness,
      counts: audit.counts,
    },
  };
}

/** Rebuild skill-eval-harness's exact model-visible answer prompt from bound inputs. */
export function answerHarnessPrompt(task, evalCase, manifest) {
  let skillNote;
  if (task.variant === 'without_skill') {
    skillNote = 'Do not use any skill. No skill files are present in this workspace.';
  } else if (task.variant === 'with_skill') {
    const skillFiles = (manifest.skill_paths ?? []).map((path, index) =>
      `skills/root-${index}/${basename(path)}`);
    const listed = skillFiles.length > 0 ? skillFiles.map((path) => `- ${path}`).join('\n') : '- none';
    skillNote = [
      'Read and follow the skill file(s) below (including referenced files when relevant), then do the task:',
      listed,
    ].join('\n');
  } else {
    throw new Error(`cannot reconstruct unsupported answer variant ${task.variant}`);
  }
  const inputFiles = (evalCase.files ?? []).map((path) => `inputs/${basename(path)}`);
  if (new Set(inputFiles).size !== inputFiles.length) {
    throw new Error(`case ${evalCase.id} has colliding input file basenames`);
  }
  const fileNote = inputFiles.length > 0
    ? inputFiles.map((path) => `- ${path}`).join('\n')
    : '- none';
  return [
    skillNote,
    '',
    `Task prompt:\n${task.prompt}`,
    '',
    `Input files available to inspect:\n${fileNote}`,
    '',
    'Return the final answer for this eval task. Do not include hidden answer keys or rubrics.',
  ].join('\n');
}

function jsonArtifact(receipt, ref, label, errors) {
  const content = artifactContent(receipt, ref, label, errors);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function taskRows(receipt, errors) {
  const rows = [];
  for (const [fileIndex, ref] of (receipt.invocation?.prepared_tasks_refs ?? []).entries()) {
    const content = artifactContent(
      receipt,
      ref,
      `invocation.prepared_tasks_refs[${fileIndex}]`,
      errors,
    );
    if (content === null) continue;
    for (const [lineIndex, line] of content.split('\n').entries()) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        errors.push(`prepared task ${fileIndex}:${lineIndex + 1} is not JSON: ${error.message}`);
      }
    }
  }
  return rows;
}

function runIdentity(value, task = false) {
  return canonicalJson([
    value[task ? 'case_id' : 'case'],
    value.kind,
    value.split,
    value.variant,
    value[task ? 'run_number' : 'repeat'],
    value.model,
  ]);
}

function benchmarkIdentity(result) {
  return canonicalJson([
    result.case_id,
    result.kind,
    result.split,
    result.variant,
    result.run_number,
    result.model,
  ]);
}

function answerRunProjection(run) {
  return {
    assertions: run.assertions,
    objective_passed: run.objective_passed,
    objective_total: run.objective_total,
    objective_pass_rate: run.objective_pass_rate,
    critical_failures: run.critical_failures ?? [],
    vetoed: run.vetoed === true,
  };
}

function benchmarkRunProjection(result) {
  return {
    assertions: result.assertions ?? [],
    objective_passed: result.objective_passed,
    objective_total: result.objective_total,
    objective_pass_rate: result.objective_pass_rate,
    critical_failures: result.critical_failures ?? [],
    vetoed: result.vetoed === true,
  };
}

function compilePortablePattern(pattern, caseInsensitive = true) {
  const inline = String(pattern).match(/^\(\?([imsx]+)\)/);
  if (!inline) return new RegExp(String(pattern), caseInsensitive ? 'i' : '');
  const flags = new Set([...inline[1]].filter((flag) => 'ims'.includes(flag)));
  if (caseInsensitive) flags.add('i');
  return new RegExp(String(pattern).slice(inline[0].length), [...flags].join(''));
}

function extractFirstJsonObject(text) {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const value = JSON.parse(text.slice(start, index + 1));
          if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('no parsable JSON object');
}

function schemaErrors(value, schema, path = '$') {
  const errors = [];
  if (Object.hasOwn(schema, 'const') && canonicalJson(value) !== canonicalJson(schema.const)) {
    errors.push(`${path}: const mismatch`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => canonicalJson(entry) === canonicalJson(value))) {
    errors.push(`${path}: value is not in enum`);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  const matches = (type) => type === 'object'
    ? Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value)
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : type === 'null' ? value === null
            : typeof value === type;
  if (types.length > 0 && !types.some(matches)) return [...errors, `${path}: type mismatch`];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}: unexpected ${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], childSchema, `${path}.${key}`));
    }
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path}: below minItems`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path}: above maxItems`);
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((entry, index) => errors.push(...schemaErrors(entry, schema.items, `${path}[${index}]`)));
    }
  }
  return errors;
}

function materializeEmbeddedSources(sourceFiles) {
  const root = mkdtempSync(resolve(tmpdir(), 'keyboardia-receipt-oracles-'));
  try {
    for (const file of sourceFiles) {
      if (typeof file.path !== 'string' || isAbsolute(file.path) || file.path.split('/').includes('..')
          || typeof file.content !== 'string') {
        throw new Error(`cannot materialize embedded source ${file?.path ?? '<missing>'}`);
      }
      const destination = resolve(root, ...file.path.split('/'));
      const rel = relative(root, destination);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`embedded source escapes materialization root: ${file.path}`);
      }
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function scoreObjectiveAssertions(evalCase, output, manifestPath, sourceFiles) {
  const assertions = (evalCase.assertions ?? [])
    .filter((assertion) => !['judge', 'rubric'].includes(assertion.type));
  const needsScripts = assertions.some((assertion) => assertion.type === 'script');
  const root = needsScripts ? materializeEmbeddedSources(sourceFiles) : null;
  const outputDir = mkdtempSync(resolve(tmpdir(), 'keyboardia-receipt-output-'));
  const outputPath = resolve(outputDir, 'output.md');
  writeFileSync(outputPath, output);
  try {
    return assertions.map((assertion) => {
      let passed = false;
      if (assertion.type === 'regex' || assertion.type === 'not_regex') {
        const matched = compilePortablePattern(
          assertion.pattern ?? assertion.value ?? '',
          assertion.ci !== false,
        ).test(output);
        passed = assertion.type === 'not_regex' ? !matched : matched;
      } else if (assertion.type === 'structured_output') {
        try {
          passed = schemaErrors(extractFirstJsonObject(output), assertion.schema ?? {}).length === 0;
        } catch {
          passed = false;
        }
      } else if (assertion.type === 'script') {
        if (!root || !Array.isArray(assertion.command) || assertion.command.length === 0
            || !assertion.command.every((part) => typeof part === 'string')) {
          throw new Error(`invalid script assertion ${assertion.name ?? '<unnamed>'}`);
        }
        const command = assertion.command.map((part) => part
          .replaceAll('{output_dir}', outputDir)
          .replaceAll('{output_path}', outputPath));
        const result = spawnSync(command[0], command.slice(1), {
          cwd: resolve(root, posix.dirname(manifestPath)),
          encoding: 'utf8',
          timeout: Number(assertion.timeout_s ?? 30) * 1000,
          maxBuffer: 4 * 1024 * 1024,
        });
        passed = result.status === Number(assertion.pass_exit_code ?? 0);
      } else {
        throw new Error(`unsupported objective assertion type: ${assertion.type}`);
      }
      return {
        name: assertion.name ?? assertion.description ?? assertion.type,
        type: assertion.type,
        severity: assertion.severity ?? 'gate',
        passed,
      };
    });
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function objectiveScoreProjection(assertions) {
  const gates = assertions.filter((assertion) => ['gate', 'critical'].includes(assertion.severity));
  const criticalFailures = assertions
    .filter((assertion) => assertion.severity === 'critical' && !assertion.passed)
    .map((assertion) => assertion.name);
  const vetoed = criticalFailures.length > 0;
  const objectivePassed = gates.filter((assertion) => assertion.passed).length;
  return {
    assertions,
    objective_passed: objectivePassed,
    objective_total: gates.length,
    objective_pass_rate: gates.length === 0 ? (vetoed ? 0 : null)
      : (vetoed ? 0 : objectivePassed / gates.length),
    critical_failures: criticalFailures,
    vetoed,
  };
}

function recordedObjectiveProjection(value) {
  return {
    assertions: (value.assertions ?? []).map((assertion) => ({
      name: assertion.name,
      type: assertion.type,
      severity: assertion.severity,
      passed: assertion.passed,
    })),
    objective_passed: value.objective_passed,
    objective_total: value.objective_total,
    objective_pass_rate: value.objective_pass_rate,
    critical_failures: value.critical_failures ?? [],
    vetoed: value.vetoed === true,
  };
}

function verifyAnswerMatrix(receipt, errors) {
  if (receipt.invocation?.suite !== 'keyboardia-answer-matrix') return;
  requireValue(Array.isArray(receipt.invocation?.prepared_tasks_refs)
    && receipt.invocation.prepared_tasks_refs.length > 0,
  'answer receipt requires prepared_tasks_refs', errors);
  for (const field of ['benchmark_ref', 'audit_ref']) {
    requireValue(typeof receipt.invocation?.[field] === 'string',
      `answer receipt requires invocation.${field}`, errors);
  }
  const tasks = taskRows(receipt, errors);
  const benchmark = jsonArtifact(
    receipt,
    receipt.invocation?.benchmark_ref,
    'invocation.benchmark_ref',
    errors,
  );
  const audit = jsonArtifact(receipt, receipt.invocation?.audit_ref, 'invocation.audit_ref', errors);
  if (!benchmark || !audit) return;
  requireValue(Array.isArray(benchmark.results), 'answer benchmark requires results', errors);
  requireValue(Array.isArray(audit.readiness?.blockers),
    'answer audit requires readiness.blockers', errors);
  requireValue(audit.readiness?.blockers?.length === 0,
    'answer audit contains readiness blockers', errors);
  requireValue(canonicalJson(audit.benchmark?.summary) === canonicalJson(benchmark.summary),
    'answer audit summary does not match benchmark', errors);
  requireValue(canonicalJson(audit.benchmark?.case_flags) === canonicalJson(benchmark.case_flags),
    'answer audit case flags do not match benchmark', errors);
  if (!Array.isArray(benchmark.results)) return;
  requireValue(tasks.length > 0, 'answer receipt has no prepared tasks', errors);
  requireValue(tasks.length === benchmark.results.length && tasks.length === receipt.runs.length,
    'answer task, benchmark, and receipt run counts differ', errors);
  requireValue(canonicalJson(receipt.summary) === canonicalJson(answerMatrixSummary(benchmark, audit)),
    'answer receipt summary does not match benchmark and audit artifacts', errors);

  const sourceManifest = (receipt.source?.files ?? []).find((file) => file.role === 'manifest');
  requireValue(sourceManifest?.sha256 === receipt.invocation?.manifest_revision,
    'answer manifest revision does not match embedded source', errors);
  let manifest = null;
  try {
    manifest = JSON.parse(sourceManifest?.content);
  } catch (error) {
    errors.push(`answer embedded manifest is not valid JSON: ${error.message}`);
  }
  const manifestCases = new Map((manifest?.cases ?? []).map((evalCase) => [evalCase.id, evalCase]));
  const sourceFiles = receipt.source?.files ?? [];
  const benchmarkByIdentity = new Map();
  for (const result of benchmark.results) {
    const identity = benchmarkIdentity(result);
    requireValue(!benchmarkByIdentity.has(identity), `duplicate benchmark run identity ${identity}`, errors);
    benchmarkByIdentity.set(identity, result);
  }
  const seen = new Set();
  for (const [index, task] of tasks.entries()) {
    const identity = runIdentity(task, true);
    requireValue(!seen.has(identity), `duplicate prepared task identity ${identity}`, errors);
    seen.add(identity);
    const run = receipt.runs[index];
    requireValue(runIdentity(run) === identity,
      `runs[${index}] identity does not match its prepared task`, errors);
    requireValue(task.manifest_revision === receipt.invocation?.manifest_revision,
      `prepared task ${index} manifest revision mismatch`, errors);
    requireValue(task.skill_tree_hash === receipt.invocation?.skill_tree_hash,
      `prepared task ${index} skill tree mismatch`, errors);
    const evalCase = manifestCases.get(task.case_id);
    requireValue(Boolean(evalCase), `prepared task ${index} has no embedded manifest case`, errors);
    if (evalCase) {
      requireValue(task.prompt === evalCase.prompt,
        `prepared task ${index} prompt does not match embedded manifest`, errors);
      requireValue(task.kind === (evalCase.kind ?? 'behavior'),
        `prepared task ${index} kind does not match embedded manifest`, errors);
      requireValue(task.split === (evalCase.split ?? 'tune'),
        `prepared task ${index} split does not match embedded manifest`, errors);
    }
    let inputBundleHash = null;
    try {
      inputBundleHash = skillEvalInputBundleHash({
        manifestPath: sourceManifest.path,
        manifestContent: sourceManifest.content,
        caseId: task.case_id,
        sourceFiles,
      });
    } catch (error) {
      errors.push(`prepared task ${index} input bundle cannot be derived: ${error.message}`);
    }
    requireValue(isHex(task.input_bundle_hash, 64)
      && task.input_bundle_hash === inputBundleHash,
    `prepared task ${index} input bundle hash mismatch`, errors);
    requireValue(run.input_bundle_hash === inputBundleHash,
      `runs[${index}] input bundle hash mismatch`, errors);
    const result = benchmarkByIdentity.get(identity);
    requireValue(Boolean(result), `prepared task ${index} has no benchmark result`, errors);
    if (!result) continue;
    requireValue(result.execution_valid === true && result.missing_output !== true,
      `benchmark result ${index} is not complete and scorable`, errors);
    requireValue(result.metadata?.input_bundle_hash === inputBundleHash,
      `benchmark result ${index} input bundle hash mismatch`, errors);
    requireValue(run.ok === true, `runs[${index}] is not successful`, errors);
    requireValue(typeof run.prompt_ref === 'string' && typeof run.output_ref === 'string',
      `runs[${index}] must bind prompt and output artifacts`, errors);
    const prompt = artifactContent(receipt, run.prompt_ref, `runs[${index}].prompt_ref`, errors);
    const output = artifactContent(receipt, run.output_ref, `runs[${index}].output_ref`, errors);
    requireValue(prompt === task.prompt,
      `runs[${index}] prompt artifact does not match its prepared task`, errors);
    requireValue(canonicalJson(answerRunProjection(run))
      === canonicalJson(benchmarkRunProjection(result)),
    `runs[${index}] scoring does not match benchmark`, errors);
    if (evalCase && output !== null) {
      try {
        const regraded = objectiveScoreProjection(scoreObjectiveAssertions(
          evalCase,
          output,
          sourceManifest.path,
          sourceFiles,
        ));
        requireValue(canonicalJson(recordedObjectiveProjection(run)) === canonicalJson(regraded),
          `runs[${index}] scoring does not match independently regraded output`, errors);
        requireValue(canonicalJson(recordedObjectiveProjection(result)) === canonicalJson(regraded),
          `benchmark result ${index} does not match independently regraded output`, errors);
      } catch (error) {
        errors.push(`runs[${index}] cannot be independently regraded: ${error.message}`);
      }
    }
    const trace = jsonArtifact(receipt, run.trace_ref, `runs[${index}].trace_ref`, errors);
    try {
      const metadata = JSON.parse(trace?.artifact_files?.['metadata.json']);
      requireValue(metadata.input_bundle_hash === inputBundleHash,
        `runs[${index}] artifact metadata input bundle hash mismatch`, errors);
    } catch (error) {
      errors.push(`runs[${index}] artifact metadata is invalid: ${error.message}`);
    }
    if (evalCase) {
      try {
        requireValue(trace?.artifact_files?.['prompt.md']
          === answerHarnessPrompt(task, evalCase, manifest),
        `runs[${index}] model-visible prompt does not match embedded inputs`, errors);
      } catch (error) {
        errors.push(`runs[${index}] model-visible prompt cannot be reconstructed: ${error.message}`);
      }
    }
  }
  const models = [...new Set(tasks.map((task) => task.model))].sort();
  requireValue(canonicalJson(models) === canonicalJson([...receipt.invocation.models].sort()),
    'answer invocation models do not match prepared tasks', errors);
}

export function verifyReceipt(receipt, { repoRoot = null } = {}) {
  const errors = [];
  requireValue(receipt && typeof receipt === 'object', 'receipt must be an object', errors);
  if (errors.length > 0) return errors;
  requireValue(receipt.schema_version === RECEIPT_SCHEMA_VERSION, 'unsupported schema_version', errors);
  requireValue(typeof receipt.receipt_id === 'string' && receipt.receipt_id.length > 0, 'missing receipt_id', errors);
  requireValue(!Number.isNaN(Date.parse(receipt.generated_at)), 'generated_at must be an ISO timestamp', errors);
  requireValue(isHex(receipt.source?.git_commit, 40), 'source.git_commit must be 40 lowercase hex characters', errors);
  requireValue(isHex(receipt.source?.git_tree, 40), 'source.git_tree must be 40 lowercase hex characters', errors);
  requireValue(Array.isArray(receipt.source?.files) && receipt.source.files.length > 0, 'source.files must be non-empty', errors);
  requireValue(typeof receipt.harness?.name === 'string', 'harness.name is required', errors);
  requireValue(typeof receipt.harness?.version === 'string', 'harness.version is required', errors);
  requireValue(isHex(receipt.harness?.git_commit, 40), 'harness.git_commit must be 40 lowercase hex characters', errors);
  requireValue(typeof receipt.invocation?.suite === 'string', 'invocation.suite is required', errors);
  requireValue(Array.isArray(receipt.invocation?.models), 'invocation.models must be an array', errors);
  requireValue(Array.isArray(receipt.invocation?.adapters) && receipt.invocation.adapters.length > 0,
    'invocation.adapters must be non-empty', errors);
  const liveRedaction = receipt.redaction?.policy === 'keyboardia-capability-v1';
  const offlineRedaction = receipt.redaction?.policy === 'offline-eval-no-live-capability-registry-v1';
  requireValue(liveRedaction || offlineRedaction, 'unknown redaction policy', errors);
  requireValue(Number.isInteger(receipt.redaction?.registered_capabilities)
    && receipt.redaction.registered_capabilities >= 0,
  'redaction.registered_capabilities must be a non-negative integer', errors);
  if (liveRedaction) {
    requireValue(receipt.redaction?.verified_in_process === true
      && receipt.redaction.registered_capabilities > 0,
    'live capability redaction requires a non-empty verified registry', errors);
  } else {
    requireValue(receipt.redaction?.verified_in_process === false
      && receipt.redaction.registered_capabilities === 0,
    'offline redaction must not claim a live capability scan', errors);
  }

  const roles = new Set();
  for (const file of receipt.source?.files ?? []) {
    roles.add(file.role);
    requireValue(typeof file.role === 'string' && file.role.length > 0, 'source file role is required', errors);
    requireValue(typeof file.path === 'string' && file.path.length > 0 && !isAbsolute(file.path) && !file.path.split('/').includes('..'),
      `invalid source file path: ${file.path}`, errors);
    requireValue(isHex(file.sha256, 64), `invalid SHA-256 for ${file.path}`, errors);
    requireValue(isHex(file.git_blob, 40), `invalid git blob for ${file.path}`, errors);
    requireValue(file.encoding === 'utf-8', `${file.path} source encoding must be utf-8`, errors);
    requireValue(typeof file.content === 'string', `${file.path} must embed its source content`, errors);
    if (typeof file.content === 'string') {
      const bytes = Buffer.from(file.content, 'utf8');
      requireValue(sha256(bytes) === file.sha256, `${file.path} embedded source SHA-256 mismatch`, errors);
      requireValue(gitBlobSha1(bytes) === file.git_blob, `${file.path} embedded source Git blob mismatch`, errors);
    }
  }
  for (const role of ['skill', 'manifest', 'runner', 'receipt_runtime', 'receipt_schema']) {
    requireValue(roles.has(role), `source.files is missing role ${role}`, errors);
  }

  const artifacts = receipt.artifacts ?? {};
  for (const [ref, artifact] of Object.entries(artifacts)) {
    requireValue(/^sha256:[0-9a-f]{64}$/.test(ref), `invalid artifact reference ${ref}`, errors);
    requireValue(artifact?.encoding === 'utf-8', `${ref} must use utf-8`, errors);
    requireValue(typeof artifact?.content === 'string', `${ref} content must be a string`, errors);
    if (typeof artifact?.content === 'string') {
      requireValue(ref === `sha256:${sha256(artifact.content)}`, `${ref} content hash mismatch`, errors);
    }
  }
  const checkRef = (ref, label) => {
    if (ref !== null && ref !== undefined) {
      requireValue(typeof ref === 'string' && Object.hasOwn(artifacts, ref), `${label} has a dangling artifact reference`, errors);
    }
  };
  for (const field of ['patch_ref', 'parent_tree_ref', 'commit_ref', 'parent_commit_ref']) {
    checkRef(receipt.harness?.[field], `harness.${field}`);
  }
  checkRef(receipt.invocation?.benchmark_ref, 'invocation.benchmark_ref');
  checkRef(receipt.invocation?.audit_ref, 'invocation.audit_ref');
  if (receipt.invocation?.prepared_tasks_refs !== undefined) {
    requireValue(Array.isArray(receipt.invocation.prepared_tasks_refs) &&
      receipt.invocation.prepared_tasks_refs.length > 0,
    'invocation.prepared_tasks_refs must be a non-empty array', errors);
    for (const [index, ref] of (receipt.invocation.prepared_tasks_refs ?? []).entries()) {
      checkRef(ref, `invocation.prepared_tasks_refs[${index}]`);
    }
  }
  requireValue(Array.isArray(receipt.invocation?.models) && receipt.invocation.models.length > 0,
    'invocation.models must be non-empty', errors);
  requireValue(Array.isArray(receipt.runs) && receipt.runs.length > 0, 'runs must be non-empty', errors);
  for (const [index, run] of (receipt.runs ?? []).entries()) {
    requireValue(typeof run.model === 'string' && run.model.length > 0,
      `runs[${index}].model is required`, errors);
    requireValue(typeof run.case === 'string' && run.case.length > 0,
      `runs[${index}].case is required`, errors);
    requireValue(typeof run.kind === 'string' && run.kind.length > 0,
      `runs[${index}].kind is required`, errors);
    requireValue(typeof run.variant === 'string' && run.variant.length > 0,
      `runs[${index}].variant is required`, errors);
    requireValue(Number.isInteger(run.repeat) && run.repeat >= 0,
      `runs[${index}].repeat must be a non-negative integer`, errors);
    requireValue(typeof run.ok === 'boolean', `runs[${index}].ok is required`, errors);
    requireValue(Array.isArray(run.assertions), `runs[${index}].assertions must be an array`, errors);
    checkRef(run.prompt_ref, `runs[${index}].prompt_ref`);
    checkRef(run.output_ref, `runs[${index}].output_ref`);
    checkRef(run.trace_ref, `runs[${index}].trace_ref`);
    checkRef(run.execution_ref, `runs[${index}].execution_ref`);
    for (const [attemptIndex, attempt] of (run.attempts ?? []).entries()) {
      checkRef(attempt.prompt_ref, `runs[${index}].attempts[${attemptIndex}].prompt_ref`);
      checkRef(attempt.output_ref, `runs[${index}].attempts[${attemptIndex}].output_ref`);
      checkRef(attempt.trace_ref, `runs[${index}].attempts[${attemptIndex}].trace_ref`);
    }
    for (const [assertionIndex, assertion] of (run.assertions ?? []).entries()) {
      requireValue(typeof assertion.name === 'string' && assertion.name.length > 0,
        `runs[${index}].assertions[${assertionIndex}].name is required`, errors);
      requireValue(typeof assertion.passed === 'boolean',
        `runs[${index}].assertions[${assertionIndex}].passed is required`, errors);
      if (!assertion.judge) continue;
      checkRef(assertion.judge.prompt_ref, `runs[${index}].assertions[${assertionIndex}].judge.prompt_ref`);
      checkRef(assertion.judge.output_ref, `runs[${index}].assertions[${assertionIndex}].judge.output_ref`);
    }
  }

  verifyPatchedHarness(receipt, errors);
  verifyAnswerMatrix(receipt, errors);
  requireValue(!receiptContainsHostPath(receipt), 'receipt contains an unsanitized host path', errors);

  if (repoRoot && isHex(receipt.source?.git_commit, 40)
      && git(repoRoot, ['cat-file', '-e', `${receipt.source.git_commit}^{commit}`], { optional: true }) !== null) {
    try {
      const tree = git(repoRoot, ['show', '-s', '--format=%T', receipt.source.git_commit]);
      requireValue(tree === receipt.source.git_tree, 'source git tree does not match commit', errors);
      for (const file of receipt.source.files ?? []) {
        const bytes = git(repoRoot, ['show', `${receipt.source.git_commit}:${file.path}`], { bytes: true });
        requireValue(sha256(bytes) === file.sha256, `${file.path} does not match its source commit`, errors);
        const blob = git(repoRoot, ['rev-parse', `${receipt.source.git_commit}:${file.path}`]);
        requireValue(blob === file.git_blob, `${file.path} git blob mismatch`, errors);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

export function writeReceipt(path, receipt, { capabilities = [] } = {}) {
  assertCapabilitiesAbsent(receipt, capabilities);
  const errors = verifyReceipt(receipt);
  if (errors.length > 0) {
    throw new Error(`invalid receipt:\n- ${errors.join('\n- ')}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
}
