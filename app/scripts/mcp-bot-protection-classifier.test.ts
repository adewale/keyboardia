import { describe, expect, it } from 'vitest';
import { classifyProbeResponse, type ProbeResponseSnapshot } from './mcp-bot-protection-classifier';

function classify(overrides: Partial<ProbeResponseSnapshot> = {}) {
  return classifyProbeResponse('probe', {
    status: 200,
    contentType: 'application/json',
    mitigated: null,
    body: JSON.stringify({ jsonrpc: '2.0', result: { tools: [{ name: 'get_session' }] } }),
    ...overrides,
  });
}

describe('MCP bot-protection response classification', () => {
  it('rejects Cloudflare mitigation markers', () => {
    expect(classify({ mitigated: 'challenge' })).toMatchObject({ ok: false, detail: 'cf-mitigated: challenge' });
  });

  it('rejects HTML challenge pages', () => {
    expect(classify({ contentType: 'text/html', body: '<html>challenge</html>' })).toMatchObject({ ok: false });
  });

  it.each([403, 503])('rejects blocking HTTP %i', (status) => {
    expect(classify({ status })).toMatchObject({ ok: false, status });
  });

  it('rejects malformed non-SSE bodies', () => {
    expect(classify({ body: 'upstream exploded' })).toMatchObject({ ok: false });
  });

  it('accepts an SSE-framed JSON-RPC response', () => {
    expect(classify({
      contentType: 'text/event-stream',
      body: 'event: message\ndata: {"jsonrpc":"2.0","result":{}}\n\n',
    })).toMatchObject({ ok: true, detail: 'event-stream response from the Worker' });
  });

  it('accepts valid results and JSON-RPC errors from the Worker', () => {
    expect(classify()).toMatchObject({ ok: true, detail: 'listed 1 tools' });
    expect(classify({ body: JSON.stringify({ jsonrpc: '2.0', error: { message: 'bad request' } }) }))
      .toMatchObject({ ok: true });
  });
});
