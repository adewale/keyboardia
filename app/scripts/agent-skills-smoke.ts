#!/usr/bin/env npx tsx
/** Verify the deployed Cloudflare Agent Skills Discovery v0.2.0 surface. */

import { createHash } from 'node:crypto';

const CATALOG_PATH = '/.well-known/agent-skills/index.json';
const EXPECTED_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const EXPECTED_SKILL = 'collaborate-in-keyboardia';
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

interface SkillEntry {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  url?: unknown;
  digest?: unknown;
}

interface DiscoveryIndex {
  $schema?: unknown;
  skills?: unknown;
}

interface Fetched {
  response: Response;
  finalUrl: URL;
  redirects: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function normalizeOrigin(value: string): URL {
  const url = new URL(value);
  assert(url.protocol === 'https:' || url.hostname === 'localhost',
    `Refusing non-HTTPS deployment origin ${url.origin}.`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchSameOrigin(
  start: URL,
  allowedOrigin: string,
  method: 'GET' | 'HEAD',
): Promise<Fetched> {
  let current = start;
  const seen = new Set<string>();

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    assert(current.origin === allowedOrigin,
      `${method} ${start.pathname} crossed origin to ${current.origin}.`);
    assert(!seen.has(current.href), `Redirect loop detected at ${current.href}.`);
    seen.add(current.href);

    const response = await fetch(current, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current, redirects };
    }

    const location = response.headers.get('location');
    assert(location, `${response.status} from ${current.href} omitted Location.`);
    assert(redirects < MAX_REDIRECTS,
      `More than ${MAX_REDIRECTS} redirects while fetching ${start.href}.`);
    current = new URL(location, current);
  }

  return fail(`Redirect limit exceeded while fetching ${start.href}.`);
}

function contentType(response: Response): string {
  return (response.headers.get('content-type') ?? '').toLowerCase();
}

function expectSharedHeaders(response: Response, label: string): void {
  assert(response.headers.get('access-control-allow-origin') === '*',
    `${label} is missing Access-Control-Allow-Origin: *.`);
  assert((response.headers.get('cache-control') ?? '').toLowerCase().includes('no-cache'),
    `${label} is missing Cache-Control: no-cache.`);
}

async function main(): Promise<void> {
  const origin = normalizeOrigin(process.argv[2] ?? 'http://localhost:8787');
  const catalogUrl = new URL(CATALOG_PATH, origin);

  console.log(`\nKeyboardia Agent Skills discovery smoke`);
  console.log(`Origin: ${origin.origin}`);
  console.log(`Catalog: ${catalogUrl.href}\n`);

  const catalogGet = await fetchSameOrigin(catalogUrl, origin.origin, 'GET');
  assert(catalogGet.response.status === 200,
    `GET ${CATALOG_PATH} returned ${catalogGet.response.status}, expected 200.`);
  assert(contentType(catalogGet.response).startsWith('application/json'),
    `Catalog Content-Type is ${contentType(catalogGet.response) || '(missing)'}.`);
  expectSharedHeaders(catalogGet.response, 'Catalog');

  const index = await catalogGet.response.json() as DiscoveryIndex;
  assert(index.$schema === EXPECTED_SCHEMA,
    `Catalog $schema is ${String(index.$schema)}, expected ${EXPECTED_SCHEMA}.`);
  assert(Array.isArray(index.skills), 'Catalog skills is not an array.');

  const matches = (index.skills as SkillEntry[]).filter((entry) =>
    entry.name === EXPECTED_SKILL && entry.type === 'skill-md');
  assert(matches.length === 1,
    `Expected exactly one ${EXPECTED_SKILL}/skill-md entry, found ${matches.length}.`);
  const entry = matches[0]!;
  assert(typeof entry.url === 'string' && entry.url.length > 0,
    'Selected skill has no URL.');
  assert(typeof entry.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(entry.digest),
    'Selected skill digest is not sha256:<64 lowercase hex>.');

  const skillUrl = new URL(entry.url, catalogGet.finalUrl);
  assert(skillUrl.origin === origin.origin,
    `Selected skill URL is cross-origin: ${skillUrl.href}.`);
  const skillGet = await fetchSameOrigin(skillUrl, origin.origin, 'GET');
  assert(skillGet.response.status === 200,
    `GET ${skillUrl.pathname} returned ${skillGet.response.status}, expected 200.`);
  assert(
    contentType(skillGet.response).startsWith('text/markdown')
      || contentType(skillGet.response).startsWith('text/plain'),
    `Skill Content-Type is ${contentType(skillGet.response) || '(missing)'}.`,
  );
  expectSharedHeaders(skillGet.response, 'Skill');

  const skillBytes = Buffer.from(await skillGet.response.arrayBuffer());
  const actualDigest = `sha256:${createHash('sha256').update(skillBytes).digest('hex')}`;
  assert(actualDigest === entry.digest,
    `Skill digest mismatch: catalog ${entry.digest}, response ${actualDigest}.`);
  const skillText = skillBytes.toString('utf8');
  assert(skillText.startsWith('---\nname: collaborate-in-keyboardia\n'),
    'Skill frontmatter does not identify collaborate-in-keyboardia.');
  assert(skillText.includes('`/mcp`'), 'Verified skill bytes do not publish /mcp.');

  for (const [label, url] of [['catalog', catalogGet.finalUrl], ['skill', skillGet.finalUrl]] as const) {
    const head = await fetchSameOrigin(url, origin.origin, 'HEAD');
    assert(head.response.status === 200,
      `HEAD ${url.pathname} returned ${head.response.status}, expected 200.`);
    assert((await head.response.arrayBuffer()).byteLength === 0,
      `HEAD ${url.pathname} returned a response body.`);
    console.log(`✓ ${label} GET and HEAD`);
  }

  const missing = await fetchSameOrigin(
    new URL('/.well-known/agent-skills/not-a-skill/SKILL.md', origin),
    origin.origin,
    'GET',
  );
  assert(missing.response.status === 404,
    `Unknown skill returned ${missing.response.status}, expected 404.`);

  console.log(`✓ exact v0.2.0 schema identifier`);
  console.log(`✓ unique ${EXPECTED_SKILL}/skill-md selection`);
  console.log(`✓ ${actualDigest} over ${skillBytes.byteLength} exact response bytes`);
  console.log(`✓ same-origin redirects bounded at ${MAX_REDIRECTS}`);
  console.log(`✓ MIME, CORS, cache, and 404 behavior`);
  console.log(`\n✅ Agent Skills discovery is live at ${origin.origin}\n`);
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
