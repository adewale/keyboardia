# API Security Specification

> **Status:** Draft
> **Created:** 2026-01-04
> **Context:** Phase 31H+ security hardening

This specification analyzes security concerns in the Keyboardia API and offers tiered options for resolution, aligned with the product vision of anonymous, friction-free collaboration.

---

## Table of Contents

1. [Design Philosophy Constraints](#design-philosophy-constraints)
2. [Threat Model](#threat-model)
3. [Issue 1: Unrestricted Session Creation](#issue-1-unrestricted-session-creation)
4. [Issue 2: Unrestricted Session Mutation](#issue-2-unrestricted-session-mutation)
5. [Issue 3: Debug Endpoints Exposed](#issue-3-debug-endpoints-exposed)
6. [Issue 4: Open CORS Policy](#issue-4-open-cors-policy)
7. [Issue 5: Weak Rate Limiting](#issue-5-weak-rate-limiting)
8. [Issue 6: No Abuse Detection](#issue-6-no-abuse-detection)
9. [Recommendations Summary](#recommendations-summary)

---

## Design Philosophy Constraints

Any security solution must respect these core principles:

| Principle | Implication for Security |
|-----------|-------------------------|
| **No authentication (current)** | Cannot require login, API keys for basic usage |
| **Friction-free sharing** | URL = access; no tokens to manage |
| **"Everyone hears the same music"** | Security can't break real-time sync |
| **Immutability as protection** | Publish creates safe, permanent copies |
| **Anonymous collaboration** | No user tracking in current phase |
| **Progressive enhancement** | Security features shouldn't break core UX |

**Key Insight:** The current security model is "security through obscurity" via unguessable UUIDs. This is acceptable for a creative tool where:
- Sessions are ephemeral/disposable
- Vandalism is annoying but not catastrophic
- Users can Publish to protect their work
- The cost of friction exceeds the cost of abuse

---

## Threat Model

### Threat Actors

| Actor | Motivation | Capability | Likelihood |
|-------|-----------|------------|------------|
| **Script Kiddie** | Curiosity, vandalism | Basic scripting, public tools | Medium |
| **Spammer** | SEO spam, link injection | Automated tools, proxies | Medium |
| **Competitor** | Service disruption | Moderate technical skill | Low |
| **Researcher** | Bug bounty, CVE hunting | Advanced skills | Low |
| **Malicious User** | Session vandalism | Browser DevTools | Medium |

### Attack Surfaces

```
┌─────────────────────────────────────────────────────────────┐
│                    ATTACK SURFACE MAP                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Internet                                                    │
│     │                                                        │
│     ▼                                                        │
│  ┌──────────────────┐                                        │
│  │ Cloudflare Edge  │ ◄── DDoS mitigation (built-in)        │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐     ┌─────────────────────────────┐   │
│  │ Worker (index.ts)│────►│ Attack Vector 1:            │   │
│  │                  │     │ Session Creation Spam       │   │
│  │ • Rate limiting  │     │ POST /api/sessions          │   │
│  │ • Input validation│    └─────────────────────────────┘   │
│  │ • CORS headers   │                                        │
│  └────────┬─────────┘     ┌─────────────────────────────┐   │
│           │               │ Attack Vector 2:            │   │
│           │               │ Debug Info Disclosure       │   │
│           │               │ GET /api/debug/*            │   │
│           │               └─────────────────────────────┘   │
│           ▼                                                  │
│  ┌──────────────────┐     ┌─────────────────────────────┐   │
│  │ Durable Object   │────►│ Attack Vector 3:            │   │
│  │ (live-session.ts)│     │ Session Hijacking/Vandalism │   │
│  │                  │     │ WebSocket mutations         │   │
│  │ • State mutations│     └─────────────────────────────┘   │
│  │ • Player mgmt    │                                        │
│  │ • Clock sync     │     ┌─────────────────────────────┐   │
│  └────────┬─────────┘     │ Attack Vector 4:            │   │
│           │               │ Resource Exhaustion         │   │
│           ▼               │ Many connections/sessions   │   │
│  ┌──────────────────┐     └─────────────────────────────┘   │
│  │ KV / R2 Storage  │                                        │
│  │                  │                                        │
│  │ • Session data   │                                        │
│  │ • Sample blobs   │                                        │
│  └──────────────────┘                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Risk Matrix

| Threat | Impact | Likelihood | Current Mitigation | Risk Level |
|--------|--------|------------|-------------------|------------|
| Session creation spam | Medium | High | Weak rate limit | **HIGH** |
| Session vandalism | Medium | Medium | Publish/immutability | **MEDIUM** |
| Debug info disclosure | Low | High | None | **HIGH** |
| Cross-origin abuse | Low | Medium | None | **MEDIUM** |
| DoS via WebSocket | Medium | Low | 10-player limit | **LOW** |
| UUID enumeration | High | Very Low | 2^128 space | **LOW** |
| XSS injection | High | Low | Input sanitization | **LOW** |

---

## Issue 1: Unrestricted Session Creation

### Current State

```typescript
// Anyone can create unlimited sessions
POST /api/sessions → Creates new session

// Only protection: IP-based rate limit (100/min, in-memory)
```

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Storage exhaustion** | Attacker creates millions of sessions | KV storage costs, quota limits |
| **Namespace pollution** | Spam sessions clutter any discovery features | UX degradation |
| **Amplification attack** | Each session = DO instance = compute cost | Billing spike |

### Options

#### Option A: Tighten Rate Limits (Low Effort) ✓ Recommended

Reduce rate limit and add exponential backoff.

```typescript
// Current: 100 sessions/min/IP
// Proposed: 5 sessions/min/IP with backoff

const RATE_LIMIT_CONFIG = {
  maxRequests: 5,           // Down from 100
  windowMs: 60_000,         // 1 minute
  backoffMultiplier: 2,     // Double wait time on repeated violations
  maxBackoff: 3600_000,     // Max 1 hour block
};
```

| Pros | Cons |
|------|------|
| No UX change for legitimate users | Determined attacker can rotate IPs |
| Simple implementation | Ephemeral memory still resets on deploy |
| Backward compatible | |

**Effort:** 1-2 hours

#### Option B: Proof of Work (Medium Effort)

Require client to solve a computational puzzle before session creation.

```typescript
// Server generates challenge
GET /api/challenge → { challenge: "abc123", difficulty: 4 }

// Client solves (finds nonce where SHA256(challenge + nonce) starts with N zeros)
POST /api/sessions
Headers: X-POW-Nonce: "87234"
```

| Pros | Cons |
|------|------|
| Raises cost of spam significantly | Adds latency to session creation |
| No user friction (happens in background) | Mobile devices slower at PoW |
| Works without authentication | Complexity increase |

**Effort:** 4-6 hours

#### Option C: Cloudflare Turnstile (Medium Effort)

Invisible CAPTCHA for session creation.

```typescript
// Client gets Turnstile token (invisible challenge)
POST /api/sessions
Headers: X-Turnstile-Token: "..."
```

| Pros | Cons |
|------|------|
| Industry-standard bot protection | Requires Turnstile setup |
| Invisible to most users | May block some legitimate users |
| Maintained by Cloudflare | External dependency |

**Effort:** 3-4 hours

#### Option D: Session Creation Requires Existing Session (Low Effort)

First session free, subsequent sessions require a valid session token.

```typescript
// First visit: auto-create one session (stored in localStorage)
// Creating more requires: X-Session-Token header from existing session

POST /api/sessions
Headers: X-Session-Token: "uuid-of-existing-session"
```

| Pros | Cons |
|------|------|
| Natural rate limiting | Users with cleared storage get blocked |
| No external dependencies | Slight UX friction |
| Prevents pure-API spam | |

**Effort:** 2-3 hours

---

## Issue 2: Unrestricted Session Mutation

### Current State

```typescript
// Anyone with session ID can mutate it
PUT /api/sessions/:id     → Full state replacement
PATCH /api/sessions/:id   → Partial update
WebSocket mutations       → Real-time changes

// Only protection: immutable flag (post-publish)
```

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Session vandalism** | Malicious actor joins and destroys work | User frustration, data loss |
| **Spam content** | Injecting offensive session names | Reputation damage |
| **Griefing** | Repeatedly disrupting collaborative sessions | UX degradation |

### Options

#### Option A: Educate Users + Improve Publish Flow (Low Effort) ✓ Recommended

Accept the current model but make protection more obvious.

```
Changes:
1. Auto-save reminder: "Your work is auto-saved but public. Publish to protect it."
2. First-time tooltip on Invite button: "Anyone with this link can edit"
3. Session recovery: "Undo all changes since [timestamp]" using DO storage history
4. Prominent Publish CTA before sharing
```

| Pros | Cons |
|------|------|
| No API changes | Doesn't prevent determined vandals |
| Aligns with product philosophy | Requires UI work |
| Empowers users | |

**Effort:** 3-4 hours (UI)

#### Option B: Session Tokens for Write Access (Medium Effort)

Generate a write token when creating a session; read is public, write requires token.

```typescript
// Session creation returns write token
POST /api/sessions → { id: "...", writeToken: "secret-xyz" }

// Mutations require token
PUT /api/sessions/:id
Headers: X-Write-Token: "secret-xyz"

// Read remains public
GET /api/sessions/:id → Works without token
```

| Pros | Cons |
|------|------|
| Separates read/write access | Token management complexity |
| Creator retains control | Sharing write access = sharing token |
| Backward compatible reads | Lost token = locked out |

**Effort:** 4-6 hours

#### Option C: Time-Limited Edit Windows (Low Effort)

Sessions become read-only after period of inactivity.

```typescript
// After 24 hours of no edits, session auto-locks
// Owner can unlock via special action (requires original browser/device)

interface Session {
  lockedAt: number | null;  // Timestamp when auto-locked
  lockToken: string;        // Stored in creator's localStorage
}
```

| Pros | Cons |
|------|------|
| Limits vandalism window | May frustrate returning users |
| Automatic protection | Requires unlock mechanism |
| No ongoing user action needed | |

**Effort:** 3-4 hours

#### Option D: Mutation Rate Limiting (Low Effort)

Limit how fast any single client can make changes.

```typescript
// Max 10 mutations per second per WebSocket connection
// Exceeding = temporary mute (5 seconds)

const MUTATION_RATE_LIMIT = {
  maxPerSecond: 10,
  muteSeconds: 5,
  maxMutes: 3,  // After 3 mutes, disconnect
};
```

| Pros | Cons |
|------|------|
| Prevents rapid vandalism | Doesn't prevent slow griefing |
| Easy to implement | May affect power users |
| Per-connection, not per-IP | |

**Effort:** 1-2 hours

---

## Issue 3: Debug Endpoints Exposed

### Current State

```typescript
// Publicly accessible debug endpoints
GET /api/debug/logs        → Session logs
GET /api/debug/session/:id → Session state dump
GET /api/metrics           → Internal metrics
```

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Information disclosure** | Exposes internal state, session data | Privacy violation |
| **Reconnaissance** | Helps attackers understand system | Increased attack surface |
| **Session enumeration** | Logs may reveal active session IDs | Targeted attacks |

### Options

#### Option A: Remove in Production (Low Effort) ✓ Recommended

Disable debug endpoints based on environment.

```typescript
// Only enable debug routes in staging/development
if (env.ENVIRONMENT !== 'production') {
  router.get('/api/debug/*', handleDebug);
  router.get('/api/metrics', handleMetrics);
}
```

| Pros | Cons |
|------|------|
| Zero production risk | Lose production debugging ability |
| Simple implementation | Need alternative for prod debugging |
| No UX impact | |

**Effort:** 30 minutes

#### Option B: Secret Debug Token (Low Effort)

Require a secret token for debug access.

```typescript
// Set via wrangler secret
// wrangler secret put DEBUG_TOKEN

GET /api/debug/logs
Headers: X-Debug-Token: "your-secret-token"
```

| Pros | Cons |
|------|------|
| Keeps prod debugging | Token could leak |
| Simple to implement | Manual token management |
| Backward compatible | |

**Effort:** 1 hour

#### Option C: Cloudflare Access (Medium Effort)

Use Cloudflare Access to protect debug routes.

```typescript
// Configure in Cloudflare dashboard:
// - Path: /api/debug/*
// - Policy: Email in allowed list

// Worker checks CF-Access-JWT-Assertion header
```

| Pros | Cons |
|------|------|
| Enterprise-grade auth | Requires Cloudflare Access setup |
| SSO integration possible | Additional cost for some plans |
| Audit logging included | Complexity increase |

**Effort:** 2-3 hours

---

## Issue 4: Open CORS Policy

### Current State

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Cross-site request abuse** | Malicious site makes API calls | Session manipulation |
| **Data exfiltration** | Third-party scripts read session data | Privacy violation |
| **Phishing amplification** | Fake Keyboardia sites with real backend | User confusion |

### Options

#### Option A: Origin Allowlist (Medium Effort) ✓ Recommended

Only allow requests from known origins.

```typescript
const ALLOWED_ORIGINS = [
  'https://keyboardia.dev',
  'https://staging.keyboardia.dev',
  'https://www.keyboardia.dev',
  /^https:\/\/.*\.keyboardia\.dev$/,  // Subdomains
  /^http:\/\/localhost(:\d+)?$/,       // Local development
];

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.some(allowed =>
    typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
  )) {
    return origin;
  }
  return ALLOWED_ORIGINS[0]; // Default to primary domain
}
```

| Pros | Cons |
|------|------|
| Blocks cross-origin abuse | Breaks third-party integrations |
| Industry standard practice | Need to maintain allowlist |
| No UX impact for normal users | |

**Effort:** 1-2 hours

#### Option B: Keep Open CORS + Rate Limit Per Origin (Low Effort)

Maintain open CORS but track abuse by origin.

```typescript
// Rate limit tracks both IP and Origin
const rateLimitKey = `${clientIP}:${origin}`;
```

| Pros | Cons |
|------|------|
| Maintains flexibility | Doesn't prevent all abuse |
| Simple addition to existing system | Origin header can be spoofed |
| No breaking changes | |

**Effort:** 30 minutes

#### Option C: CORS for Read, Strict for Write (Medium Effort)

Allow any origin to read, but restrict writes.

```typescript
// GET requests: open CORS
// POST/PUT/PATCH/DELETE: origin allowlist only

function getCorsHeaders(request: Request): Headers {
  const method = request.method;
  if (method === 'GET' || method === 'OPTIONS') {
    return { 'Access-Control-Allow-Origin': '*' };
  }
  return { 'Access-Control-Allow-Origin': getAllowedOrigin(request) };
}
```

| Pros | Cons |
|------|------|
| Balances openness and security | More complex logic |
| Embeds remain possible | Write operations from external tools break |
| Protects mutations | |

**Effort:** 2-3 hours

---

## Issue 5: Weak Rate Limiting

### Current State

```typescript
// In-memory rate limiting
const rateLimitMap = new Map<string, RateLimitEntry>();

// Issues:
// 1. Resets on worker restart/deploy
// 2. Per-worker (not distributed)
// 3. Only on session creation
// 4. Limit too high (100/min)
```

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Bypass via restart** | Deploy resets all limits | Spam window after deploy |
| **Multi-region bypass** | Different workers = different limits | Distributed attacks succeed |
| **Endpoint gaps** | WebSocket, mutations not limited | Focused attacks on unlimited routes |

### Options

#### Option A: Reduce Limits + Accept Ephemerality (Low Effort) ✓ Recommended

Tighten limits; accept they reset on deploy.

```typescript
const RATE_LIMITS = {
  sessionCreation: { max: 5, windowMs: 60_000 },
  sessionMutation: { max: 30, windowMs: 60_000 },
  webSocketConnect: { max: 10, windowMs: 60_000 },
};
```

| Pros | Cons |
|------|------|
| Better than current | Still ephemeral |
| Minimal implementation change | Not distributed |
| Good enough for current scale | |

**Effort:** 1 hour

#### Option B: Durable Object Rate Limiting (Medium Effort)

Use a dedicated DO for rate limit state.

```typescript
// RateLimitDO stores counters per IP
// Survives worker restarts
// Single source of truth

export class RateLimitDO extends DurableObject {
  async checkLimit(ip: string, action: string): Promise<boolean> {
    const key = `${ip}:${action}`;
    const count = await this.storage.get(key) || 0;
    // ... increment and check
  }
}
```

| Pros | Cons |
|------|------|
| Persistent across deploys | Additional DO cost |
| Single source of truth | Adds latency (DO hop) |
| Can implement complex policies | More moving parts |

**Effort:** 4-6 hours

#### Option C: Cloudflare Rate Limiting Rules (Low Effort)

Use Cloudflare's built-in rate limiting at the edge.

```
Dashboard → Security → WAF → Rate Limiting Rules

Rule 1: /api/sessions POST
  - 5 requests per minute per IP
  - Action: Block for 1 hour

Rule 2: /api/sessions/*
  - 60 requests per minute per IP
  - Action: Challenge
```

| Pros | Cons |
|------|------|
| Edge-level (before Worker) | Requires paid Cloudflare plan |
| Distributed by default | Less flexible than code |
| Zero code changes | Dashboard configuration |

**Effort:** 30 minutes (configuration)

---

## Issue 6: No Abuse Detection

### Current State

No monitoring for abuse patterns. Only protection is rate limiting.

### Threats

| Threat | Description | Impact |
|--------|-------------|--------|
| **Slow attacks** | Stay under rate limits but cause harm | Undetected abuse |
| **Coordinated attacks** | Multiple IPs, distributed abuse | Rate limits ineffective |
| **Content abuse** | Offensive session names/content | Reputation damage |

### Options

#### Option A: Logging + Manual Review (Low Effort) ✓ Recommended for Now

Enhance logging to enable post-hoc analysis.

```typescript
// Log suspicious patterns
interface AbuseLog {
  timestamp: number;
  ip: string;
  action: string;
  sessionId: string;
  userAgent: string;
  flags: ('rapid_creation' | 'unusual_pattern' | 'known_bad_ua')[];
}

// Store in KV with TTL for review
await env.ABUSE_LOGS.put(`abuse:${Date.now()}`, JSON.stringify(log), {
  expirationTtl: 86400 * 7, // 7 days
});
```

| Pros | Cons |
|------|------|
| Enables investigation | Manual review required |
| Low implementation cost | Reactive, not preventive |
| No false positives | |

**Effort:** 2-3 hours

#### Option B: Automated Abuse Scoring (Medium Effort)

Score requests and auto-block high-risk patterns.

```typescript
function calculateAbuseScore(request: Request, context: Context): number {
  let score = 0;

  // Suspicious user agent
  if (isBotUserAgent(request.headers.get('User-Agent'))) score += 30;

  // Rapid sequential requests
  if (context.requestsInLastMinute > 20) score += 20;

  // Known bad IP ranges
  if (isDatacenterIP(context.ip)) score += 10;

  // Missing expected headers
  if (!request.headers.get('Accept-Language')) score += 5;

  return score; // Block if > 50
}
```

| Pros | Cons |
|------|------|
| Catches sophisticated attacks | False positives possible |
| Automatic protection | Requires tuning |
| Adapts to patterns | Complexity |

**Effort:** 6-8 hours

#### Option C: Cloudflare Bot Management (Zero Effort)

Enable Cloudflare's bot detection.

```
Dashboard → Security → Bots → Configure Bot Management
```

| Pros | Cons |
|------|------|
| Enterprise-grade detection | Enterprise plan required |
| Zero code changes | Cost |
| ML-powered | Less customizable |

**Effort:** Configuration only

---

## Recommendations Summary

### Immediate Actions (Do Now)

| Issue | Recommended Option | Effort | Priority |
|-------|-------------------|--------|----------|
| Debug endpoints exposed | **A: Remove in production** | 30 min | **P0** |
| Rate limit too high | **A: Reduce to 5/min** | 1 hour | **P0** |
| Open CORS | **A: Origin allowlist** | 2 hours | **P1** |

### Short-Term (Next Sprint)

| Issue | Recommended Option | Effort | Priority |
|-------|-------------------|--------|----------|
| Session creation spam | **A: Tighten rate limits** | 1-2 hours | **P1** |
| Session vandalism | **A: Improve Publish flow** | 3-4 hours | **P2** |
| Mutation rate limiting | **D: Per-connection limits** | 1-2 hours | **P2** |

### Medium-Term (Next Quarter)

| Issue | Recommended Option | Effort | Priority |
|-------|-------------------|--------|----------|
| Abuse detection | **A: Enhanced logging** | 2-3 hours | **P2** |
| Distributed rate limiting | **B: DO-based** or **C: Cloudflare** | 4-6 hours | **P3** |
| Session tokens | **B: Write tokens** (if vandalism persists) | 4-6 hours | **P3** |

### Deferred (With Authentication Phase)

These require the authentication system planned for Phase 22+:

- Session ownership and deletion protection
- User-based rate limiting
- Audit trails with user attribution
- Abuse reporting mechanism
- Session access control lists

---

## Implementation Checklist

```
Phase 1: Immediate Hardening (P0)
├── [ ] Disable debug endpoints in production
├── [ ] Reduce session creation rate limit to 5/min
├── [ ] Add comment explaining rate limit rationale
└── [ ] Deploy to staging, verify, deploy to production

Phase 2: Origin Protection (P1)
├── [ ] Implement origin allowlist
├── [ ] Add localhost exception for development
├── [ ] Test WebSocket connections with new CORS
└── [ ] Update documentation

Phase 3: Enhanced Protection (P2)
├── [ ] Add mutation rate limiting to WebSocket
├── [ ] Improve Publish flow UI
├── [ ] Add abuse logging infrastructure
└── [ ] Create internal abuse review process
```

---

## Appendix: Threat Scenarios

### Scenario 1: Session Spam Attack

```
Attacker Goal: Exhaust KV storage quota
Method: Script creates sessions in a loop
Current Protection: Rate limit (weak)
Recommended: Reduce limit + Proof of Work for sustained creation
```

### Scenario 2: Collaborative Session Vandalism

```
Attacker Goal: Disrupt a live jam session
Method: Join via shared link, rapidly toggle all steps
Current Protection: None (by design)
Recommended: Mutation rate limiting + snapshot recovery
```

### Scenario 3: Cross-Site Session Manipulation

```
Attacker Goal: Modify victim's session via malicious website
Method: Victim visits evil.com which makes API calls
Current Protection: None (open CORS)
Recommended: Origin allowlist
```

### Scenario 4: Information Gathering

```
Attacker Goal: Understand system for larger attack
Method: Call debug endpoints, analyze responses
Current Protection: None
Recommended: Disable debug in production
```
