import discoveryIndex from '../../public/.well-known/agent-skills/index.json';
import skillMarkdown from '../../public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md';

// TypeScript's JSON resolver sees the source shape, while Wrangler's explicit
// Text rule deliberately supplies the raw file bytes at runtime.
const discoveryIndexText = discoveryIndex as unknown as string;

const DISCOVERY_ROOT = '/.well-known/agent-skills/';
const INDEX_PATH = `${DISCOVERY_ROOT}index.json`;
const SKILL_PATH = `${DISCOVERY_ROOT}collaborate-in-keyboardia/SKILL.md`;

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
};

function discoveryResponse(
  request: Request,
  content: string,
  contentType: string,
): Response {
  const headers = {
    ...COMMON_HEADERS,
    'Content-Type': contentType,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: 'GET, HEAD' },
    });
  }

  return new Response(request.method === 'HEAD' ? null : content, { headers });
}

/**
 * Serve Agent Skills discovery from Worker-bundled source bytes.
 *
 * Cloudflare uploads files below a dot-prefixed directory as static assets but
 * does not currently expose these paths through this Worker's asset binding.
 * Keeping the artifacts as text modules makes the checked-in bytes, rather
 * than undocumented asset-router behavior, the deployment contract.
 */
export function handleAgentSkillsRequest(
  request: Request,
  path: string,
): Response | null {
  if (path === INDEX_PATH) {
    return discoveryResponse(
      request,
      discoveryIndexText,
      'application/json; charset=utf-8',
    );
  }

  if (path === SKILL_PATH) {
    return discoveryResponse(
      request,
      skillMarkdown,
      'text/markdown; charset=utf-8',
    );
  }

  // Do not let unknown discovery URLs fall through to the SPA shell.
  if (path.startsWith(DISCOVERY_ROOT)) {
    return new Response(null, {
      status: 404,
      headers: COMMON_HEADERS,
    });
  }

  return null;
}
