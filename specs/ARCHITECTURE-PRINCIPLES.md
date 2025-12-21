# Keyboardia Architecture Principles

This document captures the architectural principles that guide Keyboardia's design and implementation.

---

## Core Principle

### "Everyone Hears the Same Music"

Keyboardia is a **multiplayer music creation tool**. The foundational promise is that all connected players experience identical audio output. Any feature that violates this principle breaks the product.

This single principle drives most architectural decisions:
- Why we have a single source of truth (consistency)
- Why audio features must sync (shared experience)
- Why we use Durable Objects (coordination)
- Why we optimize for low latency (real-time collaboration)

---

## The Ten Principles

### 1. Single Source of Truth

**The Durable Object is authoritative. Clients are optimistic.**

```
                    ┌─────────────────┐
                    │  Durable Object │ ◄── Authoritative
                    │   (in-memory)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌────────┐    ┌────────┐    ┌────────┐
         │Client A│    │Client B│    │Client C│ ◄── Optimistic
         └────────┘    └────────┘    └────────┘
```

**Implications:**
- All mutations flow through the DO
- Clients apply changes optimistically for responsiveness
- If client and server diverge, server state wins
- KV is a persistence layer, not a source of truth (DO can be ahead by 5s)

**Code locations:**
- `src/worker/live-session.ts` - DO implementation
- `src/sync/multiplayer.ts` - Client sync logic
- `src/state/grid.tsx` - Client state with `isRemote` flag

---

### 2. The Three Surfaces Must Align

**A feature exists in API, UI, and Session State - or it's incomplete.**

| Surface | Purpose | Question to Ask |
|---------|---------|-----------------|
| **API** | What the code can do | Can the system perform this action? |
| **UI** | What users can control | Can users discover and trigger this? |
| **State** | What persists and syncs | Does this survive refresh? Does it sync? |

**Examples:**

| Feature | API | UI | State | Complete? |
|---------|-----|----|----|-----------|
| Tempo | `setTempo()` | BPM slider | `session.tempo` | ✅ Yes |
| Step toggle | `toggleStep()` | Grid click | `track.steps[]` | ✅ Yes |
| Reverb (rolled back) | `setReverb()` | None | None | ❌ No |

**Implications:**
- Don't ship API capabilities without UI
- Don't ship UI without persistence
- Don't ship persistence without sync
- If any surface is missing, the feature is incomplete

**Lesson learned:** Phase 20 implemented reverb/delay in the API only. Rolled back because it violated "everyone hears the same music" - only the local player heard effects.

---

### 3. Audio-Affecting Features Must Sync

**If it changes what you hear, everyone must hear the same change.**

```
MUST SYNC (affects shared audio):     MAY BE LOCAL (visual/personal):
├── Tempo                             ├── Cursor display
├── Swing                             ├── Theme preferences
├── Track steps                       ├── Zoom level
├── Track mute/solo                   ├── UI density
├── Track volume                      ├── Debug mode
├── Track transpose                   └── Which track is selected
├── Effects (reverb, delay)
├── Synth parameters (FM, ADSR)
└── Step parameter locks
```

**The heuristic:** Before implementing an audio feature, ask: "If Player A changes this, should Player B hear the change?" If yes, it must sync.

**Implications:**
- Audio features require full stack: client, server, persistence, broadcast
- "Local-only" audio features are a category of bug
- Visual-only preferences can safely differ between players

---

### 4. Optimistic Updates with Last-Write-Wins

**Immediate feedback, simple conflict resolution.**

```
User clicks step
      │
      ▼
┌─────────────────┐
│ Local state     │ ◄── Immediate (optimistic)
│ updated         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Message sent    │
│ to server       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Server applies  │ ◄── Authoritative
│ mutation        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Broadcast to    │
│ all clients     │
└─────────────────┘
```

**Why Last-Write-Wins:**
- Simple to implement and reason about
- No complex merge logic
- Works well for music: if two people edit the same step, either outcome is musically valid
- Step toggles are "self-correcting": on→off→on = on

**Why NOT CRDTs:**
- We have a single source of truth (DO), not multi-master
- CRDTs solve offline-first with eventual consistency
- We have real-time connection with authoritative server
- Complexity not warranted

---

### 5. Graceful Degradation

**The system degrades gracefully, never fails silently.**

```
Connected ──► Disconnected ──► Reconnecting ──► Single Player
     ▲              │               │                │
     │              │               │                │
     └──────────────┴───────────────┘                │
           (auto-reconnect with backoff)             │
                                                     │
                              (manual retry available)
```

**Degradation layers:**
1. **Connected** - Full multiplayer sync
2. **Disconnected** - Queue messages, show status
3. **Reconnecting** - Exponential backoff + jitter, replay queue
4. **Single Player** - After 10 failed attempts, work locally

**Implications:**
- Connection status must be visible (Principle 8: Observability)
- Offline queue must have limits (prevent memory issues)
- Users can always continue working (never blocked)
- Manual retry available after giving up

**Code locations:**
- `src/sync/multiplayer.ts:1284-1324` - Reconnection logic
- `src/sync/multiplayer.ts:470-473` - Offline queue
- `src/components/ConnectionStatus.tsx` - UI indicator

---

### 6. Server-Side Validation

**Never trust the client. Validate everything.**

```typescript
// Every mutation is validated and clamped
handleSetTempo(msg) {
  const tempo = clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO);  // 60-180
  // ...
}

handleSetVolume(msg) {
  const volume = clamp(msg.volume, MIN_VOLUME, MAX_VOLUME);  // 0-1
  // ...
}

// Invariants checked after mutations
validateStateInvariants(state);
repairStateInvariants(state);  // Auto-fix if possible
```

**What we validate:**
- Numeric ranges (tempo, volume, transpose, swing)
- Array bounds (step index, track count)
- String lengths (track names)
- Message size (64KB max)
- JSON validity

**Implications:**
- Client can be buggy or malicious - server corrects
- Validation constants shared between client and server
- Auto-repair for recoverable invariant violations
- Log violations for monitoring

**Code locations:**
- `src/worker/invariants.ts` - Validation functions and constants
- `src/worker/live-session.ts` - Handler validation
- `src/worker/handler-factory.ts` - Validation in factories

---

### 7. Type Parity Across Boundaries

**Client and server types must be structurally identical for serialization.**

```typescript
// BAD: Different optionality causes JSON mismatch
// Client
interface Track {
  soloed: boolean;  // Always present → {"soloed":false}
}
// Server
interface SessionTrack {
  soloed?: boolean;  // May be undefined → {}
}

// GOOD: Same structure, same JSON
interface Track {
  soloed: boolean;
}
interface SessionTrack {
  soloed: boolean;
}
```

**Why this matters:**
- `JSON.stringify` omits `undefined` values
- Hash comparisons fail if structure differs
- Bugs are silent and hard to diagnose

**How we enforce:**
- Compile-time parity tests in `types.test.ts`
- Canonical normalization in `canonicalHash.ts`
- Shared types in `src/shared/sync-types.ts` (planned)

**Code locations:**
- `src/types.ts` - Client types
- `src/worker/types.ts` - Server types
- `src/state/grid.test.ts` - Parity tests

---

### 8. Hybrid Persistence (Phase 27)

**DO Storage is source of truth, KV syncs on disconnect.**

```
Mutation arrives at DO
         │
         ├──► Update in-memory state (immediate)
         │
         ├──► Write to DO storage (immediate) ← SOURCE OF TRUTH
         │
         ├──► Broadcast to clients (immediate)
         │
         └──► Mark pendingKVSave = true
                      │
                      ▼
         Last client disconnects
                      │
                      ▼
              ┌───────────────┐
              │ Write to KV   │ ← Long-term storage only
              └───────────────┘
```

**Why hybrid approach:**
- DO storage is 5x cheaper than KV for writes ($1/M vs $5/M)
- DO storage survives hibernation (data is persistent)
- No 5-second staleness window (bug fixed in Phase 27)
- KV only needed for long-term storage after DO eviction

**Architecture guarantees:**
- Every mutation persisted to DO storage immediately
- Reconnecting clients always get fresh state from DO
- KV syncs only when session becomes empty (cost-efficient)
- No data loss possible during active sessions

**Implications:**
- Clients see changes immediately (via broadcast)
- DO storage always has latest state
- KV may be stale during active sessions (this is OK)
- On DO eviction, state reloads from KV (synced on last disconnect)

**Code locations:**
- `src/worker/live-session.ts:1279` - `persistToDoStorage()` method
- `src/worker/live-session.ts:1309` - `flushPendingKVSave()` on disconnect

---

### 9. Handler Factories for DRY

**Systematic patterns, not repetitive handlers.**

```typescript
// WITHOUT factory: 15 handlers with similar structure
private handleSetTempo(ws, player, msg) {
  if (!this.state) return;
  this.state.tempo = clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO);
  this.broadcast({ type: 'tempo_changed', tempo: this.state.tempo, playerId: player.id });
  this.scheduleKVSave();
}

// WITH factory: declarative, consistent
private handleSetTempo = createGlobalMutationHandler({
  validate: (msg) => ({ ...msg, tempo: clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO) }),
  mutate: (state, msg) => { state.tempo = msg.tempo; },
  toBroadcast: (msg, playerId) => ({ type: 'tempo_changed', tempo: msg.tempo, playerId }),
});
```

**Benefits:**
- Consistent validation, mutation, broadcast, persistence
- Adding new sync'd features is systematic
- Reduces surface area for bugs
- Easier to add cross-cutting concerns (logging, acks)

**Code locations:**
- `src/worker/handler-factory.ts` - Server factories
- `src/sync/handler-factory.ts` - Client factories

---

### 10. Safety Nets, Not Primary Mechanisms

**Multiple layers of protection, each with a clear role.**

```
┌─────────────────────────────────────────────────────────┐
│                    RELIABILITY LAYERS                    │
├─────────────────────────────────────────────────────────┤
│  Layer 5: Snapshot Recovery     (last resort)           │
│  Layer 4: Hash Verification     (detect drift)          │
│  Layer 3: Delivery Confirmation (confirm receipt) [GAP] │
│  Layer 2: Message Ordering      (sequence numbers)      │
│  Layer 1: Connection Recovery   (reconnect + replay)    │
│  Layer 0: Transport             (WebSocket)             │
└─────────────────────────────────────────────────────────┘
```

**Each layer has ONE job:**
- Transport: Move bytes
- Connection Recovery: Handle disconnects
- Ordering: Detect out-of-order messages
- **Delivery Confirmation: Confirm server received message** ← MISSING
- Hash Verification: Detect state drift
- Snapshot Recovery: Reset to known-good state

**Implications:**
- Don't use a safety net as primary detection
- When a gap exists (Layer 3), layers above compensate poorly
- Hash verification every 30s is too slow for primary detection
- Debug assertions were a workaround, not a solution

---

## Anti-Patterns

### What We Avoid

| Anti-Pattern | Why It's Bad | What We Do Instead |
|--------------|--------------|---------------------|
| Local-only audio features | Breaks "everyone hears the same" | Sync all audio state |
| Trust client data | Security risk, corruption | Server validates everything |
| Silent failures | Users lose work unknowingly | Visible status, error states |
| Complex conflict resolution | Over-engineering | Last-write-wins |
| Scattered validation | Inconsistent, bugs | Centralized in invariants.ts |
| setTimeout in DO | Lost on hibernation | DO Alarms |
| Types with different optionality | Serialization mismatch | Type parity tests |

---

## Decision Framework

When implementing a new feature, ask:

1. **Does it affect audio?** → Must sync (Principle 3)
2. **Does it have all three surfaces?** → API + UI + State (Principle 2)
3. **Is it validated server-side?** → Add to invariants.ts (Principle 6)
4. **Does it follow existing patterns?** → Use handler factories (Principle 9)
5. **Does it degrade gracefully?** → Handle offline case (Principle 5)
6. **Are types identical client/server?** → Add parity test (Principle 7)

---

## References

- `../docs/LESSONS-LEARNED.md` - War stories and debugging insights
- `../docs/BUG-PATTERNS.md` - Common bugs and prevention
- `MUTATION-TRACKING.md` - Client-side mutation tracking and delivery confirmation
- `src/worker/invariants.ts` - Validation constants and functions
