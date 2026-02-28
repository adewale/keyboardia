# Security Vulnerability Analysis — Keyboardia

**Date**: 2026-02-27
**Scope**: Full codebase audit of Keyboardia, a multiplayer step sequencer with Cloudflare Workers backend, WebSocket sync, Durable Objects, and KV/R2 storage.

---

## Executive Summary

Keyboardia demonstrates **strong security fundamentals** for a real-time collaborative web application. The codebase has comprehensive input validation, proper CSP headers, HTML escaping for user-generated content, and well-structured server-side invariant enforcement. However, several vulnerabilities ranging from **medium to low severity** were identified that should be addressed.

**Critical**: 0
**High**: 2
**Medium**: 8
**Low**: 7

---

## HIGH Severity

### H-1: Wildcard CORS Allows Any Origin to Access API

**File**: `app/src/worker/index.ts:129-133`
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

**Risk**: The `Access-Control-Allow-Origin: *` header allows **any website** to make cross-origin requests to the Keyboardia API. A malicious site could:
- Create/modify/delete sessions on behalf of a user who has the page open
- Enumerate session IDs and scrape session data
- Perform state mutations via PUT/PATCH API endpoints from any origin

**Impact**: Since there is no authentication, the CORS wildcard combined with unauthenticated state-mutating endpoints (PUT, PATCH, DELETE) means any website can modify any Keyboardia session if the session ID is known.

**Recommendation**: Restrict `Access-Control-Allow-Origin` to the actual domains:
```typescript
const allowedOrigins = new Set([
  'https://keyboardia.dev',
  'https://www.keyboardia.dev',
  'https://staging.keyboardia.dev',
]);
const origin = request.headers.get('Origin') || '';
const corsOrigin = allowedOrigins.has(origin) ? origin : '';
```

---

### H-2: No Authentication on State-Mutating REST API Endpoints

**File**: `app/src/worker/index.ts:765` (PUT), `app/src/worker/live-session.ts:348` (PATCH)

The REST API endpoints `PUT /api/sessions/:id` and `PATCH /api/sessions/:id` allow **anyone who knows a session ID** to overwrite the full session state or rename a session. There is no ownership verification, no tokens, no session cookies.

Combined with H-1 (wildcard CORS), this means a cross-origin attacker can:
1. Call `PUT /api/sessions/{known-id}` with an empty tracks array to wipe a session
2. Call `PATCH /api/sessions/{known-id}` with `{"name": "Hacked"}` to vandalize session names

**Impact**: Session vandalism and data loss. Session IDs are exposed in URLs (shared via links), making them easily obtainable.

**Recommendation**: Implement at minimum a session-creator token:
- On session creation, return a secret `editToken` (stored in the creator's browser)
- Require `Authorization: Bearer {editToken}` on PUT/PATCH/DELETE endpoints
- WebSocket connections could use the same token as a query parameter

---

## MEDIUM Severity

### M-1: Rate Limit Set to 100/min (Testing Value Left in Production)

**File**: `app/src/worker/index.ts:13`
```typescript
// NOTE: Increased from 10 to 100 for integration testing. Revert after testing.
const RATE_LIMIT_MAX_REQUESTS = 100;
```

The comment explicitly says this was increased for testing and should be reverted. At 100 session creates per minute per IP, an attacker can create **6,000 sessions per hour per IP** and significantly more using rotating IPs, potentially exhausting the KV daily write quota.

**Recommendation**: Revert to 10 per minute as originally intended. Consider adding Cloudflare Rate Limiting rules at the edge for additional protection.

---

### M-2: In-Memory Rate Limiter Resets on Worker Restart

**File**: `app/src/worker/index.ts:9-20`

The rate limiter uses an in-memory `Map<string, RateLimitEntry>`. Cloudflare Workers are frequently recycled (cold starts, deployments, scaling). Each new worker instance starts with a fresh rate limit map, allowing attackers to bypass limits by waiting for worker restarts or hitting different isolates.

**Impact**: Rate limiting is unreliable in a distributed serverless environment.

**Recommendation**: Use Cloudflare's built-in Rate Limiting product or store rate limit counters in a Durable Object for persistence across worker restarts.

---

### M-3: dangerouslySetInnerHTML with Library-Generated SVG

**File**: `app/src/components/QROverlay/QRCode.tsx:98`
```tsx
dangerouslySetInnerHTML={{ __html: state.svgString }}
```

The `QRCodeLib.toString()` output is rendered via `dangerouslySetInnerHTML`. While the `qrcode` library is a trusted dependency and the `value` parameter is a URL constructed from `window.location.origin` (controlled), this pattern is fragile:
- If the `qrcode` library has a bug or is compromised, arbitrary HTML/JS could be injected
- Future changes could pass user-controlled input as the QR value without escaping

**Impact**: Potential XSS if the qrcode library is compromised or if inputs change.

**Recommendation**: Parse the SVG string and render it safely, or use the qrcode library's `toCanvas()` or `toDataURL()` methods instead, which produce non-executable output:
```tsx
<img src={dataUrl} alt="QR code" />
```

---

### M-4: WebSocket Message Flooding (No Per-Connection Rate Limiting)

**File**: `app/src/worker/live-session.ts:753-810`

The `webSocketMessage` handler validates message size and JSON structure, but does not enforce any rate limiting on message frequency. A malicious client can:
- Send thousands of `toggle_step` messages per second, causing excessive DO storage writes
- Flood `cursor_move` messages to overwhelm all other connected clients with broadcasts
- Trigger rapid `state_hash` checks to increase server load

While there is connection storm detection on the **client** side (`utils/connection-storm.ts`), there is no server-side per-connection message rate limiting.

**Impact**: Denial of service to all players in a session; excessive DO storage write costs.

**Recommendation**: Add per-connection rate limiting:
```typescript
const MAX_MESSAGES_PER_SECOND = 50;
if (player.messageCount / ((Date.now() - player.connectedAt) / 1000) > MAX_MESSAGES_PER_SECOND) {
  ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
  ws.close(1008, 'Rate limit exceeded');
  return;
}
```

---

### M-5: Session Name XSS Validation Uses Incomplete Regex Blocklist

**File**: `app/src/worker/validation.ts:332`
```typescript
if (/<script|javascript:|on\w+\s*=/i.test(name)) {
  errors.push('Name contains potentially unsafe content');
}
```

This blocklist approach to XSS prevention is brittle. It can be bypassed with:
- `<img src=x onerror="alert(1)">` (partially covered by `on\w+\s*=` but not `<img`)
- `<svg/onload=alert(1)>` — the `on\w+\s*=` catches this but `<svg` is not blocked
- HTML entities: `&#106;avascript:` bypasses the `javascript:` check
- Data URIs, vbscript:, and other exotic vectors

However, the impact is mitigated because:
1. The CSP header blocks inline script execution
2. The `escapeHtml()` function in `social-preview.ts` properly escapes session names for HTML context
3. React's default escaping prevents most XSS in the frontend

**Impact**: Low practical impact due to defense-in-depth, but the regex gives a false sense of security.

**Recommendation**: Remove the blocklist regex and rely on the structural defenses (CSP + output encoding) which are more robust. If you want server-side validation, use an allowlist approach (which you already have with `SESSION_NAME_PATTERN`).

---

### M-6: `add_track` WebSocket Message Accepts Unvalidated Track Object

**File**: `app/src/worker/live-session.ts:1238`
```typescript
this.state.tracks.push(msg.track);
```

The `add_track` handler pushes the entire client-provided track object into server state without deep validation. While `validateAndRepairState` is called afterward, it only checks structural invariants (array lengths, bounds). It does **not** validate:
- `sampleId` against known samples (unlike REST API which uses `VALID_SAMPLE_IDS`)
- `name` for length or content
- That `steps` contains only booleans
- That `parameterLocks` contains valid lock objects

**Impact**: A malicious WebSocket client can inject arbitrary data into session state that is persisted and broadcast to all other clients.

**Recommendation**: Apply the same `validateTrack()` logic from `validation.ts` to WebSocket `add_track` messages before accepting them.

---

### M-7: `set_track_sample` WebSocket Handler Skips sampleId Validation

**File**: `app/src/worker/live-session.ts:1815-1831`

The `set_track_sample` handler does not validate `sampleId` against `VALID_SAMPLE_IDS`, nor does it sanitize or length-limit the `name` field. The REST API validation layer (`validation.ts:132`) validates sampleIds, but WebSocket messages bypass it entirely.

**Impact**: A malicious client can set arbitrary sampleId values and overlong track names through the WebSocket connection.

**Recommendation**: Add `VALID_SAMPLE_IDS.has(msg.sampleId)` check and `name.trim().slice(0, MAX_TRACK_NAME_LENGTH)` sanitization in the handler's `validate` callback.

---

### M-8: Security Headers Missing from Session Pages and API Responses

**File**: `app/src/worker/index.ts:90-97, 162-172, 221`

Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP) are only applied via `serveAssetWithSecurityHeaders()` for static assets. They are **not** applied to:
- API responses (only get CORS headers)
- Session pages served with injected social meta tags (line 221: `injectSocialMeta()` returns an un-headered response)

Additionally, `Strict-Transport-Security` (HSTS) is absent entirely.

**Impact**: API responses and dynamically-generated session pages lack security headers.

**Recommendation**: Apply security headers to all responses, not just static assets. Add HSTS header.

---

## LOW Severity

### L-1: Multiple Debug Endpoints Exposed Without Authentication

**Files**: `app/src/worker/index.ts:511-534, 986-1197`, `app/src/worker/live-session.ts:251`

The following debug endpoints are publicly accessible without authentication:
- `GET /api/sessions/:id/live-debug` — Full DO internal state
- `GET /api/debug/session/:id` — Session metadata, track details, byte sizes
- `GET /api/debug/session/:id/connections` — Connection info
- `GET /api/debug/session/:id/clock` — Clock sync data including client info
- `GET /api/debug/session/:id/state-sync` — State hashes and client identifiers
- `GET /api/debug/durable-object/:id` — Durable Object internal state

**Impact**: Information disclosure. An attacker can enumerate active sessions, discover connected players, observe state hashes, and gather internal server state.

**Recommendation**: Either remove debug endpoints from production builds, or gate them behind an admin secret:
```typescript
if (request.headers.get('X-Debug-Key') !== env.DEBUG_SECRET) {
  return new Response('Forbidden', { status: 403 });
}
```

---

### L-2: Error Responses Leak Internal Details

**File**: `app/src/worker/live-session.ts:449-455`
```typescript
return new Response(JSON.stringify({
  error: 'Invalid request body',
  details: e instanceof Error ? e.message : String(e),
}), { status: 400 });
```

Multiple error handlers return internal error messages (including stack traces) to the client. This can leak implementation details about the server.

**Recommendation**: Return generic error messages to clients and log detailed errors server-side only.

---

### L-3: Player ID Controlled by Client

**File**: `app/src/worker/live-session.ts:639`
```typescript
const requestedPlayerId = url.searchParams.get('playerId') || crypto.randomUUID();
```

The player ID for a WebSocket connection is taken directly from a query parameter. While this is by design (for ghost avatar fix / tab persistence), it means:
- An attacker can impersonate another player's ID by using their UUID in the query string
- This could allow "kicking" a legitimate player by connecting with their ID (the existing zombie connection replacement code at line 643 would close the original connection)

**Impact**: Low — player IDs don't grant special permissions, and the visual identity (color/animal) is deterministic from the ID. However, one user could force-disconnect another.

**Recommendation**: Add a simple anti-spoofing mechanism: generate a connection secret on first connect and require it on reconnect. Or use signed tokens.

---

### L-4: CSP Allows `'unsafe-inline'` for Styles

**File**: `app/src/worker/index.ts:92`
```
style-src 'self' 'unsafe-inline'
```

The `'unsafe-inline'` directive for styles weakens the CSP against CSS-based attacks (data exfiltration via CSS selectors, CSS injection). This is a common trade-off for React applications using inline styles.

**Impact**: Low — CSS injection is a weaker attack vector than script injection, and the script-src does not allow unsafe-inline.

**Recommendation**: If feasible, use nonce-based style-src or extract CSS to files. This is a low priority given the trade-off with development experience.

---

### L-5: `blob:` in CSP `script-src` Weakens XSS Protection

**File**: `app/public/_headers`
```
script-src 'self' blob: https://static.cloudflareinsights.com
```

Allowing `blob:` in `script-src` means any code that can create a blob URL can execute arbitrary JavaScript. This is needed for Tone.js AudioWorklets, but it weakens the CSP significantly — if an attacker achieves partial XSS (e.g., HTML injection), they could potentially escalate to full JavaScript execution via blob URLs.

**Impact**: Low — requires an existing injection vector to exploit, but reduces defense-in-depth.

---

### L-6: Debug Mode Activatable in Production via URL Parameter

**File**: `app/src/utils/debug-coordinator.ts:85-95`
```typescript
const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
```

Anyone can enable full debug mode in production by appending `?debug=1` to the URL. This activates event tracing, log persistence to IndexedDB, bug detection, and exposes multiple debug functions on the `window` object (`__runFullDiagnostics__`, `__queryLogs__`, `__exportLogsToFile__`, etc.).

**Impact**: Information disclosure. An attacker who tricks a user into visiting a `?debug=1` link enables persistent logging of subsequent activity.

**Recommendation**: Gate debug URL flags behind `import.meta.env.DEV`.

---

### L-7: Track IDs Generated with `Date.now()` (Predictable)

**File**: `app/src/state/grid.tsx:178`
```typescript
id: `track-${Date.now()}`,
```

Track IDs are generated using `Date.now()`, making them trivially predictable and potentially colliding if two tracks are created within the same millisecond. While track IDs are not used for authorization, predictable IDs could allow a malicious multiplayer participant to craft targeted mutations.

**Recommendation**: Use `crypto.randomUUID()` for track ID generation.

---

## Positive Security Observations

The following security measures are well-implemented and deserve recognition:

1. **Comprehensive input validation**: The `validation.ts`, `invariants.ts`, and `validators.ts` modules provide thorough server-side validation with clamping, type checking, and bounds enforcement for all WebSocket messages and REST API inputs.

2. **Strong CSP headers**: The Content-Security-Policy blocks framing (`frame-ancestors 'none'`), restricts form actions, script sources, and connect sources appropriately.

3. **HTML escaping for social previews**: The `escapeHtml()` function in `social-preview.ts` properly escapes user-provided session names for HTML attribute context (meta tags).

4. **Session ID validation**: UUIDs are validated with regex before being routed to Durable Objects, preventing billing on invalid requests.

5. **Message size limits**: Both WebSocket messages (`MAX_MESSAGE_SIZE`) and HTTP request bodies are size-validated.

6. **Immutability enforcement**: Published sessions have a centralized immutability check that rejects all state-mutating messages.

7. **State invariant validation and repair**: `validateStateInvariants()` and `repairStateInvariants()` are called after mutations to catch and fix state corruption.

8. **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` are all properly configured.

9. **Cryptographic session IDs**: Session IDs are generated using `crypto.randomUUID()`, not `Math.random()`.

10. **No hardcoded secrets**: Configuration uses Cloudflare environment bindings; no API keys or secrets are present in the source code.

---

## Recommendations Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | H-1: Restrict CORS to known origins | Low |
| 2 | M-1: Revert rate limit from 100 to 10 | Trivial |
| 3 | M-4: Add WebSocket per-connection rate limiting | Medium |
| 4 | H-2: Add edit tokens for REST API mutations | Medium-High |
| 5 | M-6/M-7: Add WebSocket input validation parity with REST API | Medium |
| 6 | M-2: Use durable rate limiter | Medium |
| 7 | M-8: Apply security headers to all responses | Low |
| 8 | L-1: Gate debug endpoints | Low |
| 9 | M-3: Replace dangerouslySetInnerHTML in QRCode | Low |
| 10 | L-2: Sanitize error responses | Low |
| 11 | L-6: Gate debug URL flags behind DEV mode | Low |
| 12 | M-5: Remove XSS regex blocklist | Low |
| 13 | L-3: Add anti-spoofing for player IDs | Medium |
| 14 | L-7: Use crypto.randomUUID() for track IDs | Trivial |
