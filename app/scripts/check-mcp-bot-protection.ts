#!/usr/bin/env npx tsx
/**
 * Zone bot-protection probe for the stateless MCP endpoint.
 *
 * Super Bot Fight Mode and "Block AI bots" are zone-level Cloudflare settings,
 * not repository state, so they can be switched on in the dashboard and break
 * /mcp without any code change. Every Keyboardia MCP client is, by any
 * reasonable definition, a bot — so the zone must be configured to skip /mcp.
 *
 * This sends real `initialize` requests to a deployed origin under several user
 * agents and fails if any of them is blocked, challenged, or answered by the
 * bot layer instead of by the Worker.
 *
 * Usage:
 *   npm run check:mcp-bot-protection
 *   npm run check:mcp-bot-protection -- https://staging.keyboardia.dev
 *
 * @see specs/STATELESS-MCP.md - "Deferred hardening"
 */

const DEFAULT_ORIGIN = 'https://keyboardia.dev';

/**
 * MCP clients arrive with wildly different user agents: an SDK default, a
 * hosted agent runtime's own string, or nothing at all. "Block AI bots" matches
 * on crawler signatures, so one of those is included deliberately — an agent
 * calling Keyboardia on someone's behalf is not the crawler the setting is
 * meant to stop, and the zone must not conflate them.
 */
const PROBES: Array<{ label: string; userAgent: string | null }> = [
  { label: 'no user agent', userAgent: null },
  { label: 'MCP SDK client', userAgent: 'modelcontextprotocol-sdk/2.0 (keyboardia probe)' },
  { label: 'generic automation', userAgent: 'python-httpx/0.27.0' },
  { label: 'AI crawler signature', userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
];

/**
 * `tools/list` rather than `initialize`: the endpoint is stateless, so there is
 * no handshake to complete, and sending a legacy `initialize` body alongside a
 * modern MCP-Protocol-Version header is a contradiction the SDK rejects.
 */
const PROBE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  // 2026-07-28 carries what the legacy handshake negotiated in a per-request
  // envelope instead, so every stateless call repeats it.
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
});

interface ProbeResult {
  label: string;
  ok: boolean;
  status: number;
  detail: string;
}

/**
 * A probe passes when the Worker answered, not when the call succeeded: this
 * script tests the zone, not the endpoint's health. A JSON-RPC error is still
 * proof the request got through the bot layer, and is reported as such.
 *
 * Cloudflare marks its own interventions with `cf-mitigated`, and a challenge
 * answers with an HTML interstitial no MCP client can parse. Either means the
 * request never reached the Worker.
 */
async function probe(origin: string, label: string, userAgent: string | null): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2026-07-28',
    // 2026-07-28 requires the method to be declared in a header as well as the
    // body, so intermediaries can route without parsing JSON.
    'MCP-Method': 'tools/list',
  };
  if (userAgent) headers['User-Agent'] = userAgent;

  let response: Response;
  try {
    response = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: PROBE_BODY });
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      detail: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const mitigated = response.headers.get('cf-mitigated');
  if (mitigated) {
    return { label, ok: false, status: response.status, detail: `cf-mitigated: ${mitigated}` };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return {
      label,
      ok: false,
      status: response.status,
      detail: 'HTML response — a challenge or block page, not the Worker',
    };
  }

  if (response.status === 403 || response.status === 503) {
    return { label, ok: false, status: response.status, detail: `blocked with HTTP ${response.status}` };
  }

  const body = await response.text();
  let parsed: { jsonrpc?: string; result?: { tools?: Array<{ name: string }> }; error?: { message?: string } };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // An SSE-framed answer is still the Worker answering.
    if (body.includes('"jsonrpc"')) {
      return { label, ok: true, status: response.status, detail: 'event-stream response from the Worker' };
    }
    return { label, ok: false, status: response.status, detail: `unparseable body: ${body.slice(0, 120)}` };
  }

  if (parsed.jsonrpc !== '2.0') {
    return { label, ok: false, status: response.status, detail: `not a JSON-RPC response: ${body.slice(0, 120)}` };
  }

  if (parsed.error) {
    // Reached the Worker, which is what this script asserts, but worth seeing.
    return {
      label,
      ok: true,
      status: response.status,
      detail: `reached the Worker; it answered with a JSON-RPC error: ${parsed.error.message ?? 'unknown'}`,
    };
  }

  return {
    label,
    ok: true,
    status: response.status,
    detail: `listed ${parsed.result?.tools?.length ?? 0} tools`,
  };
}

async function main(): Promise<void> {
  const origin = (process.argv[2] ?? process.env.MCP_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  console.log(`Probing ${origin}/mcp for zone bot protection\n`);

  const results: ProbeResult[] = [];
  for (const { label, userAgent } of PROBES) {
    results.push(await probe(origin, label, userAgent));
  }

  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${result.label.padEnd(22)} HTTP ${result.status} — ${result.detail}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    console.log('\nAll probes reached the Worker. Zone bot protection is not intercepting /mcp.');
    return;
  }

  console.error(`\n${failures.length} of ${results.length} probes did not reach the Worker.`);
  console.error('Check, for this zone:');
  console.error('  - Super Bot Fight Mode: the "Definitely automated" action');
  console.error('  - "Block AI bots"');
  console.error('  - Any WAF custom or rate limiting rule matching /mcp');
  console.error('Add a skip for http.request.uri.path eq "/mcp". Where a rule must');
  console.error('match, its action has to be block — MCP clients cannot solve a challenge.');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
