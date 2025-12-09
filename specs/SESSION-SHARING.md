# Session Sharing Specification

> **See also:** [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md) for the full session state machine, sharing modes (Remix vs Share Session vs Share Snapshot), and admin dashboard requirements.

## Overview

Sessions allow users to save, share, and remix their patterns. Each session has a unique, unguessable ID (UUID v4) and is stored in Cloudflare KV for persistence.

---

## Goals

1. **Shareable URLs** — Users can share a link to their session
2. **Persistence** — Sessions survive page refresh and browser close
3. **Remixing** — Users can create a copy of any session they have access to
4. **Unguessable IDs** — Session IDs cannot be enumerated or guessed
5. **No Authentication** — Anonymous access, anyone with the URL can view/edit

---

## URL Scheme

```
https://keyboardia.adewale-883.workers.dev/                    # New empty session
https://keyboardia.adewale-883.workers.dev/s/{uuid}            # Load existing session
https://keyboardia.adewale-883.workers.dev/s/{uuid}/remix       # Remix session (creates new)
```

### Examples

```
/s/f47ac10b-58cc-4372-a567-0e02b2c3d479        # Direct link to session
/s/f47ac10b-58cc-4372-a567-0e02b2c3d479/remix   # Remix this session
```

---

## Session ID Format

**UUID v4** — 128-bit random identifier

- Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
- Generated using `crypto.randomUUID()` (Web Crypto API)
- 122 bits of randomness = 5.3×10³⁶ possible values
- Collision probability: negligible
- Cannot be enumerated or guessed

### Why UUID v4 over alternatives?

| Option | Pros | Cons |
|--------|------|------|
| UUID v4 | Standard, unguessable, no coordination | Longer URLs |
| Nanoid | Shorter URLs | Custom dependency |
| Sequential IDs | Short | Guessable, enumerable |
| Word combos | Memorable | Limited namespace, collisions |

**Decision:** UUID v4 — security and standardization outweigh URL length concerns.

---

## Data Model

### Session Object

```typescript
interface Session {
  // Identity
  id: string;                    // UUID v4
  createdAt: number;             // Unix timestamp (ms)
  updatedAt: number;             // Unix timestamp (ms)
  lastAccessedAt: number;        // For orphan detection (90+ days inactive)

  // Provenance
  remixedFrom: string | null;     // Parent session ID (if remixed)
  remixedFromName: string | null; // Cached parent name for display
  remixCount: number;             // How many times this was remixed

  // State
  state: SessionState;
}

interface SessionState {
  // Tracks
  tracks: Track[];

  // Transport
  tempo: number;
  swing: number;

  // Metadata
  version: number;               // Schema version for migrations
}

interface Track {
  id: string;
  name: string;
  sampleId: string;              // Built-in sample, 'synth:{preset}', or 'recording-{uuid}'
  steps: boolean[];              // Up to 64 steps
  parameterLocks: (ParameterLock | null)[];
  volume: number;
  muted: boolean;
  soloed: boolean;               // When any track is soloed, only soloed tracks play
  playbackMode: 'oneshot' | 'gate';
  transpose: number;             // Semitones (-12 to +12)
  stepCount: number;             // Loop length (4, 8, 16, 32, or 64)
}

interface ParameterLock {
  pitch?: number;                // Semitones (-12 to +12)
  volume?: number;               // Multiplier (0-2)
}
```

### KV Storage

**Namespace:** `SESSIONS`

**Key format:** `session:{uuid}`

**Value:** JSON-encoded `Session` object

**TTL:** None (sessions are permanent by default)

```typescript
// Example KV operations
await env.SESSIONS.put(
  `session:${sessionId}`,
  JSON.stringify(session)
  // No expirationTtl — sessions persist indefinitely
);

const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
```

---

## API Endpoints

### Create New Session

```
POST /api/sessions
Content-Type: application/json

Request body: (optional initial state)
{
  "state": { ... }
}

Response: 201 Created
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "url": "/s/f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Get Session

```
GET /api/sessions/{uuid}

Response: 200 OK
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "createdAt": 1733400000000,
  "updatedAt": 1733401234567,
  "remixedFrom": null,
  "state": { ... }
}

Response: 404 Not Found (if session doesn't exist)
{
  "error": "Session not found"
}
```

### Update Session

```
PUT /api/sessions/{uuid}
Content-Type: application/json

Request body:
{
  "state": { ... }
}

Response: 200 OK
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "updatedAt": 1733402000000
}
```

### Remix Session

```
POST /api/sessions/{uuid}/remix

Response: 201 Created
{
  "id": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "remixedFrom": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "url": "/s/a1b2c3d4-e5f6-4789-abcd-ef0123456789"
}
```

### Delete Session

```
DELETE /api/sessions/{uuid}

Response: 204 No Content
```

---

## Client Behavior

### Page Load Flow

```
1. Parse URL
   ├── No session ID → Create new session, update URL
   └── Has session ID → Fetch session from API
                           ├── Found → Load state into app
                           └── Not found → Show error, offer to create new

2. Initialize audio engine

3. Start auto-save debounce timer
```

### Auto-Save

```typescript
const SAVE_DEBOUNCE_MS = 2000;  // Save 2 seconds after last change

let saveTimeout: number | null = null;

function onStateChange(newState: SessionState) {
  // Update local state immediately
  setState(newState);

  // Debounce save to server
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSession(sessionId, newState);
  }, SAVE_DEBOUNCE_MS);
}
```

### Remix Flow

```
1. User clicks "Remix" button
2. POST /api/sessions/{currentId}/remix
3. Receive new session ID
4. Update URL to /s/{newId}
5. Continue editing (now on remixed copy)
```

### Invite Flow

```
1. User clicks "Invite" button
2. Copy current URL to clipboard
3. Show confirmation toast: "Session link copied!"
4. Recipients who open the link join the same session
```

### Send Copy Flow

```
1. User clicks "Send Copy" button
2. POST /api/sessions/{currentId}/remix
3. Receive new session ID
4. Copy NEW URL to clipboard (not current session)
5. User stays on current session
6. Show confirmation toast: "Copy link sent!"
7. Recipients get their own independent session to edit
```

---

## Edge Cases

### Session Not Found

When loading a URL with an invalid session ID:

1. Show friendly error: "This session doesn't exist"
2. Offer button: "Create New Session"
3. Do not auto-redirect (user may want to try a different link)

### Concurrent Edits

For now (single-player mode), last-write-wins:

1. Each save overwrites the entire session state
2. No conflict resolution
3. Future: Add version numbers or CRDTs for multiplayer

### Large Sessions

**KV Value Limit:** 25 MB (more than enough for patterns)

**Mitigation:**
- Recordings stored separately in R2 (not in session state)
- Session state only contains references (`recording-{uuid}`)

---

## Sample Storage (Future)

Recorded samples are stored separately from session state:

```
Session State (KV)           Sample Storage (R2)
┌────────────────┐           ┌─────────────────────────────┐
│ sampleId:      │           │ samples/{sessionId}/{uuid}  │
│ "recording-abc"│──────────▶│ (binary audio data)         │
└────────────────┘           └─────────────────────────────┘
```

When remixing a session with recordings:
1. Remix creates new session in KV
2. Sample references remain unchanged (same R2 paths)
3. Samples are immutable — no need to copy

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Session enumeration | UUID v4 has 122 bits of randomness |
| Data exfiltration | No sensitive data stored |
| DoS via session creation | Rate limit: 10 sessions/minute/IP |
| Storage abuse | Size limits, future: inactive session cleanup |
| XSS via session data | Sanitize all user input on render |

---

## Wrangler Configuration

```jsonc
{
  "name": "keyboardia",
  "main": "src/worker/index.ts",
  "compatibility_date": "2024-01-01",

  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  ],

  "r2_buckets": [
    {
      "binding": "SAMPLES",
      "bucket_name": "keyboardia-samples"
    }
  ]
}
```

---

## Implementation Status

> Last updated: December 2024

### Basic Persistence ✅ Complete
- [x] Create KV namespace
- [x] Implement create/get/update endpoints
- [x] Add auto-save to frontend (2s debounce)
- [x] Add session ID to URL

### Sharing ✅ Complete
- [x] Add "Invite" button with clipboard copy
- [x] Add "Send Copy" button (creates remix, copies URL)
- [x] Handle invalid session URLs (error page with "Create New" option)
- [x] Add session metadata (created, updated, lastAccessed timestamps)

### Remixing ✅ Complete
- [x] Implement remix endpoint
- [x] Add "Fork" button to UI (remix + navigate)
- [x] Track remixedFrom lineage
- [x] Display remix lineage in UI ("Remixed from X")
- [x] Track and display remixCount

### Sample Storage ⚠️ Partial
- [x] R2 bucket configured
- [ ] Upload recordings to R2 (currently in-memory only)
- [ ] Reference R2 samples from session state
- [ ] Handle sample loading on session restore

---

## UI Components

### Session Buttons

```
┌──────────────────────────────────────────────────────┐
│  [Invite]  [Send Copy]  [Remix]  [New]               │
└──────────────────────────────────────────────────────┘
```

- **Invite:** Copy current session URL, show toast "Session link copied!"
- **Send Copy:** Create remix, copy remix URL (stay on current), show toast "Copy link sent!"
- **Remix:** Create copy, navigate to new URL
- **New:** Create empty session, navigate to new URL

### Remix Lineage Display

```
┌──────────────────────────────────────────────────────┐
│  ↳ Remixed from "Funky Beat" • 3 remixes             │
└──────────────────────────────────────────────────────┘
```

- Show "Remixed from {parent name}" with link to parent session
- Show remix count as social proof

---

## Metrics (Future)

Track via Workers Analytics:

- Sessions created per day
- Sessions remixed per day
- Average session age at last access
- Sessions inactive for 90+ days (candidates for cleanup notification)
