import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const RECEIPT_SCHEMA_VERSION = 1;
export const REDACTED_CAPABILITY = '<redacted-session-id>';

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
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

function git(repoRoot, args, { bytes = false, optional = false } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: bytes ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
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
    };
  });
  return {
    repository,
    git_commit: gitCommit,
    git_tree: gitTree,
    files,
  };
}

export function addArtifact(artifacts, content, mediaType = 'text/plain') {
  const text = String(content);
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
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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
  const artifacts = {};
  const receipt = {
    $schema: '../receipt.schema.json',
    schema_version: RECEIPT_SCHEMA_VERSION,
    receipt_id: `${invocation.suite}-${source.git_commit.slice(0, 12)}-${Date.now()}`,
    generated_at: new Date().toISOString(),
    source,
    harness,
    invocation,
    redaction: {
      policy: 'keyboardia-capability-v1',
      replacement: REDACTED_CAPABILITY,
      verified_in_process: true,
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
  const harnessPatchBinding = [
    receipt.harness?.git_tree,
    receipt.harness?.parent_git_commit,
    receipt.harness?.patch_ref,
  ];
  if (harnessPatchBinding.some((value) => value !== undefined && value !== null)) {
    requireValue(isHex(receipt.harness?.git_tree, 40),
      'harness.git_tree must be 40 lowercase hex characters', errors);
    requireValue(isHex(receipt.harness?.parent_git_commit, 40),
      'harness.parent_git_commit must be 40 lowercase hex characters', errors);
    requireValue(typeof receipt.harness?.patch_ref === 'string',
      'harness.patch_ref is required for a patched harness', errors);
  }
  requireValue(typeof receipt.invocation?.suite === 'string', 'invocation.suite is required', errors);
  requireValue(Array.isArray(receipt.invocation?.models), 'invocation.models must be an array', errors);
  requireValue(Array.isArray(receipt.invocation?.adapters) && receipt.invocation.adapters.length > 0,
    'invocation.adapters must be non-empty', errors);
  requireValue(receipt.redaction?.policy === 'keyboardia-capability-v1', 'unknown redaction policy', errors);
  requireValue(receipt.redaction?.verified_in_process === true, 'receipt was not redaction-verified', errors);

  const roles = new Set();
  for (const file of receipt.source?.files ?? []) {
    roles.add(file.role);
    requireValue(typeof file.role === 'string' && file.role.length > 0, 'source file role is required', errors);
    requireValue(typeof file.path === 'string' && file.path.length > 0 && !isAbsolute(file.path) && !file.path.split('/').includes('..'),
      `invalid source file path: ${file.path}`, errors);
    requireValue(isHex(file.sha256, 64), `invalid SHA-256 for ${file.path}`, errors);
    requireValue(isHex(file.git_blob, 40), `invalid git blob for ${file.path}`, errors);
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
  checkRef(receipt.harness?.patch_ref, 'harness.patch_ref');
  checkRef(receipt.invocation?.benchmark_ref, 'invocation.benchmark_ref');
  if (receipt.invocation?.prepared_tasks_refs !== undefined) {
    requireValue(Array.isArray(receipt.invocation.prepared_tasks_refs) &&
      receipt.invocation.prepared_tasks_refs.length > 0,
    'invocation.prepared_tasks_refs must be a non-empty array', errors);
    for (const [index, ref] of (receipt.invocation.prepared_tasks_refs ?? []).entries()) {
      checkRef(ref, `invocation.prepared_tasks_refs[${index}]`);
    }
  }
  requireValue(Array.isArray(receipt.runs), 'runs must be an array', errors);
  for (const [index, run] of (receipt.runs ?? []).entries()) {
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
      if (!assertion.judge) continue;
      checkRef(assertion.judge.prompt_ref, `runs[${index}].assertions[${assertionIndex}].judge.prompt_ref`);
      checkRef(assertion.judge.output_ref, `runs[${index}].assertions[${assertionIndex}].judge.output_ref`);
    }
  }

  if (repoRoot && isHex(receipt.source?.git_commit, 40)) {
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
