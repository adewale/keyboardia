export interface ProbeResult {
  label: string;
  ok: boolean;
  status: number;
  detail: string;
}

export interface ProbeResponseSnapshot {
  status: number;
  contentType: string;
  mitigated: string | null;
  body: string;
}

interface JsonRpcProbeBody {
  jsonrpc?: string;
  result?: { tools?: Array<{ name: string }> };
  error?: { message?: string };
}

/** Pure classification seam: network I/O cannot change the decision rules. */
export function classifyProbeResponse(
  label: string,
  response: ProbeResponseSnapshot
): ProbeResult {
  if (response.mitigated) {
    return {
      label,
      ok: false,
      status: response.status,
      detail: `cf-mitigated: ${response.mitigated}`,
    };
  }

  if (response.contentType.toLowerCase().includes('text/html')) {
    return {
      label,
      ok: false,
      status: response.status,
      detail: 'HTML response — a challenge or block page, not the Worker',
    };
  }

  if (response.status === 403 || response.status === 503) {
    return {
      label,
      ok: false,
      status: response.status,
      detail: `blocked with HTTP ${response.status}`,
    };
  }

  let parsed: JsonRpcProbeBody;
  try {
    parsed = JSON.parse(response.body) as JsonRpcProbeBody;
  } catch {
    // An SSE-framed JSON-RPC answer is still the Worker answering.
    if (response.body.includes('"jsonrpc"')) {
      return {
        label,
        ok: true,
        status: response.status,
        detail: 'event-stream response from the Worker',
      };
    }
    return {
      label,
      ok: false,
      status: response.status,
      detail: `unparseable body: ${response.body.slice(0, 120)}`,
    };
  }

  if (parsed.jsonrpc !== '2.0') {
    return {
      label,
      ok: false,
      status: response.status,
      detail: `not a JSON-RPC response: ${response.body.slice(0, 120)}`,
    };
  }

  if (parsed.error) {
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
