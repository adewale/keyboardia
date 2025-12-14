# Keyboardia Implementation Status

> Last updated: 2025-12-11
> Current version: **0.2.0**

## Current Phase: Phase 15 (Polish & Production) — In Progress

### Overview

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Complete | Local Audio Playground |
| 2 | ✅ Complete | Mic Recording |
| 3 | ✅ Complete | Session Persistence & Sharing |
| 4A | ✅ Complete | Per-Track Step Count & Polyrhythms |
| 4B | ✅ Complete | Chromatic Step View (Inline Pitch Editing) |
| 5 | ✅ Complete | Sharing UI Polish |
| 6 | ✅ Complete | Observability |
| 7 | ✅ Complete | Multiplayer Observability & Testing Infrastructure |
| 8 | ✅ Complete | Cloudflare Backend Setup (DO + R2) |
| 9 | ✅ Complete | Multiplayer State Sync |
| 10 | ✅ Complete | Clock Sync |
| 11 | ✅ Complete | Presence & Awareness |
| 12 | ✅ Complete | Error Handling & Testing |
| 13A | ✅ Complete | Backend Hardening (CF Best Practices) |
| 13B | ✅ Complete | Frontend Hardening |
| 14 | ✅ Complete | Resilience & Testing Infrastructure |
| 15 | 🔄 In Progress | Polish & Production |
| 16 | Not Started | Authentication & Session Ownership |
| 17 | Not Started | Shared Sample Recording |
| 18 | Not Started | Publishing (Immutable Sessions) |
| 19 | Not Started | Advanced Synthesis Engine |
| 20 | Not Started | Session Provenance |
| 21 | Not Started | Beat-Quantized Changes |
| 22 | Not Started | Playwright E2E Testing |
| 23 | Not Started | Public API |

---

## Phase 1: Local Audio Playground ✅

**Goal:** User can create beats and hear them immediately (no backend)

### Completed

- [x] Initialize Vite + React + TypeScript project
- [x] Create basic UI components
  - [x] `StepSequencer.tsx`
  - [x] `StepCell.tsx` (with visual swing offset, p-lock badges)
  - [x] `TrackRow.tsx` (inline controls, mode toggle)
  - [x] `Transport.tsx` (play/stop, tempo, swing)
- [x] Implement audio engine
  - [x] `engine.ts` — AudioContext setup, sample loading
  - [x] `scheduler.ts` — Lookahead scheduling (25ms timer, 100ms ahead)
  - [x] `samples.ts` — Synthesized samples (16 sounds)
  - [x] `synth.ts` — Real-time synthesizer engine (5 presets)
- [x] Implement state management
  - [x] `grid.tsx` — React Context + useReducer
- [x] Wire up UI to audio engine

### Additional Features Implemented

- [x] **Swing/Shuffle** — Adjustable swing timing (0-100%)
- [x] **Parameter Locks** — Per-step pitch and volume overrides
- [x] **Track Transpose** — Per-track pitch offset (-12 to +12 semitones)
- [x] **Per-Track Step Count** — Polyrhythms via independent loop lengths (4/8/16/32/64 steps)
- [x] **Solo** — Per-track solo with industry-standard behavior (solo wins over mute)
- [x] **16 tracks** — Supports up to 16 simultaneous tracks
- [x] **Copy/Paste** — Copy patterns between tracks
- [x] **Mute/Clear/Delete** — Per-track controls

### Instruments

| Category | Sounds |
|----------|--------|
| Drums | Kick, Snare, Hi-Hat, Clap, Tom, Rim, Cowbell, Open Hat |
| Bass | Bass (saw), Sub Bass (sine) |
| Samples | Lead, Pluck, Chord, Pad |
| FX | Zap, Noise |
| Synth (real-time) | Bass, Lead, Pad, Pluck, Acid |

---

## Phase 2: Mic Recording ✅

**Goal:** User can record custom samples and use them in the sequencer

### Completed

- [x] Implement `recorder.ts` — MediaRecorder wrapper
- [x] Add Recorder UI component with waveform display
- [x] Preview before adding to grid
- [x] Auto-slice with transient detection
- [x] Add recorded samples as new tracks

---

## Phase 3: Session Persistence & Sharing ✅

**Goal:** Users can save, share, and remix sessions via unique URLs

### Completed

- [x] Create KV namespace for session storage (permanent, no TTL)
- [x] Worker API endpoints
  - [x] `POST /api/sessions` — Create new session
  - [x] `GET /api/sessions/:id` — Load session
  - [x] `PUT /api/sessions/:id` — Update session (debounced auto-save)
  - [x] `POST /api/sessions/:id/remix` — Remix a session
- [x] Frontend session sync layer (`sync/session.ts`)
- [x] Share/Remix/New UI buttons in header
- [x] URL routing (`/s/{uuid}`) with SPA support
- [x] Session state includes: tracks, tempo, swing, parameter locks
- [x] Remix tracking (remixedFrom field)
- [x] "Session not found" error handling with Create New option

### Files Added

| File | Purpose |
|------|---------|
| `src/worker/index.ts` | Worker entry, API routing |
| `src/worker/sessions.ts` | KV CRUD operations |
| `src/worker/types.ts` | Session type definitions |
| `src/sync/session.ts` | Frontend sync layer |
| `src/hooks/useSession.ts` | React session hook |

---

## Phase 4: Per-Track Step Count & Polyrhythms ✅

**Goal:** Enable varied pattern lengths with polyrhythmic looping

### Completed

- [x] Extend MAX_STEPS to 64
- [x] Per-track stepCount property (4, 8, 16, 32, or 64)
- [x] Step count dropdown in track controls (replaced buttons)
- [x] Polyrhythmic looping — each track loops at its own length
- [x] Solo button — per-track solo with yellow (#f1c40f) active state
- [x] Visual enhancements
  - [x] Active step glow effect (box-shadow pulse)
  - [x] Velocity fill indicator (volume p-lock visualization)
  - [x] Page separators every 16 steps
  - [x] Dark mode colors (#121212 background, desaturated accents)
- [x] Inline scrolling for steps that exceed viewport
- [x] Fixed-width track controls to prevent layout shift
- [x] Backwards compatibility for existing sessions (default to 16 steps)
- [x] Mobile drawer dropdown for step count

### Step Count Options

| Steps | Bars | Loops/Bar | Use Case |
|-------|------|-----------|----------|
| **4** | 0.25 | 4× | Four-on-the-floor kick, pulse patterns, motorik beat |
| **8** | 0.5 | 2× | Half-bar phrases, 8th-note arpeggios, call-response |
| 16 | 1 | 1× | Standard patterns (drums, bass) |
| 32 | 2 | 0.5× | Basslines with variation, 2-bar melodies |
| 64 | 4 | 0.25× | Long melodies, chord progressions, evolving patterns |

### Polyrhythmic Combinations

| Combo | Resolution | Musical Style |
|-------|------------|---------------|
| 4 vs 16 | 1 bar | Pulse under complex melody (minimal techno) |
| 4 vs 32 | 2 bars | Hypnotic repetition (Berlin minimal) |
| 8 vs 16 | 1 bar | Half-time feel (boom-bap, lo-fi) |
| 8 vs 12 | 1.5 bars | Afrobeat / West African clave |
| 4 vs 8 vs 16 | 1 bar | Layered polyrhythm |

### Example Sessions

| Session | URL | Demonstrates |
|---------|-----|--------------|
| Polyrhythm Demo | `/s/cab63f7d-7aea-4e26-b990-2ce7d5d1401c` | 4/8/16/32 step combinations |
| Afrobeat Groove | `/s/4c889c91-1c43-4c4a-ab8a-4a2bff3f50fd` | 4/8-step polyrhythms, tresillo pattern |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Step count vs multipliers | Actual step count | Clearer mental model, all steps visible/editable |
| Loop behavior | Per-track independent | Polyrhythms emerge naturally |
| Visual approach | Inline scrolling | Direct manipulation, see all steps |
| Dark mode | #121212 not #000000 | Industry standard, reduces eye strain |
| Dropdown vs buttons | Dropdown | Scales to 5+ options, cleaner UI |
| Solo behavior | Solo wins over mute | Industry standard (Ableton, Logic, Pro Tools) |
| No exclusive solo | Explicit un-solo | Consistent modifier semantics (Shift = disclose) |

---

## Phase 5: Sharing UI Polish ✅

**Goal:** Complete the sharing model with clear terminology and remix lineage visibility

### Completed

- [x] Rename "Share" button to "Invite"
- [x] Add "Send Copy" button (creates remix, copies URL, stays on current session)
- [x] Add `lastAccessedAt` field to session model (for orphan detection)
- [x] Add `remixCount` field to session model
- [x] Add `remixedFromName` field to session model
- [x] Display remix lineage in session header ("Remixed from X")
- [x] Show remix count as social proof
- [x] Add orphan banner for sessions inactive 90+ days
- [x] Backwards compatibility for existing sessions

### Session Creation

All new sessions start empty (no tracks, default tempo 120 BPM, swing 0%):
- **Home page** (`/`): Automatically creates empty session and redirects to `/s/{uuid}`
- **New button**: Creates empty session and navigates to it

### Button Actions

| Button | Action | Result |
|--------|--------|--------|
| **Invite** | Copy current session URL | Recipients join your live session |
| **Send Copy** | Create remix, copy that URL, stay here | Recipients get their own independent copy |
| **Remix** | Create remix, navigate to it | You work on a copy |
| **New** | Create empty session (no tracks, default tempo/swing), navigate to it | Fresh start |

---

## Phase 6: Observability ✅

**Goal:** Add logging, metrics, and debugging tools to understand system behavior and diagnose issues

### Completed

- [x] Structured request logging middleware
  - Request/response logging for all API endpoints
  - Logs include: timestamp, requestId, method, path, status, responseTime
  - Session state tracking (trackCount, hasData)
  - Stored in KV with 1-hour TTL for cost efficiency
- [x] Debug endpoints
  - `GET /api/debug/session/:id` — Inspect session state without modifying access time
  - `GET /api/debug/logs` — Query recent logs (supports `?sessionId=` and `?last=` filters)
- [x] Metrics endpoint
  - `GET /api/metrics` — System metrics (session counts, request counts by type)
  - Tracks: total sessions, created/accessed today, last 5 minutes activity
- [x] Client-side debug mode (`?debug=1`)
  - Debug overlay showing session ID and state
  - Real-time operation logging in UI
  - Quick links to debug API endpoints
  - Console logging of all session operations
- [x] Playwright debug tests
  - Session persistence integrity tests
  - Observability endpoint tests
  - Debug mode UI tests
  - State transition cycle tests

### Files Added/Modified

| File | Purpose |
|------|---------|
| `src/worker/logging.ts` | Structured logging, metrics tracking |
| `src/debug/DebugContext.tsx` | React context for debug state |
| `src/debug/DebugOverlay.tsx` | Debug panel UI component |
| `src/debug/DebugOverlay.css` | Debug panel styles |
| `e2e/session-persistence.spec.ts` | Comprehensive E2E tests |

---

## Phase 4B: Chromatic Step View ✅

**Goal:** Make melodic input as intuitive as Ableton's Learning Music piano roll

### Completed

- [x] Expand/collapse toggle on synth tracks (♪ button)
- [x] Chromatic grid with 12 pitch rows (-12 to +12 semitones)
- [x] Click-to-place notes at pitch/step intersections
- [x] Pitch contour overlay on collapsed view (shows melody shape)
- [x] Sound preview when placing notes
- [x] Visual feedback for playing notes

### How It Works

1. **Synth tracks** show a ♪ button in the track controls
2. Click ♪ to **expand** the chromatic grid view
3. **Click any cell** at the intersection of pitch row and step column
4. Notes are placed using the existing parameter lock system
5. **Collapse** to see pitch contour line overlay on steps

### Files Added

| File | Purpose |
|------|---------|
| `src/components/ChromaticGrid.tsx` | Chromatic grid + pitch contour components |
| `src/components/ChromaticGrid.css` | Styles for chromatic view |

### UI Philosophy Compliance

| Principle | Status |
|-----------|--------|
| Controls live where they act | ✅ Grid is inline with track |
| Visual feedback is immediate | ✅ Notes appear instantly |
| No confirmation dialogs | ✅ Click = place/remove |
| Modes are visible | ✅ Toggle shows ♪/▼ state |
| Progressive disclosure | ✅ Expand for power feature |

---

## Phase 7: Multiplayer Observability & Testing Infrastructure ✅

**Goal:** Build debugging, logging, and testing infrastructure for multiplayer

### Completed

- [x] Mock Durable Object for local development (`mock-durable-object.ts`)
- [x] WebSocket lifecycle logging (connect, message, disconnect)
- [x] Debug endpoints for multiplayer state
- [x] State consistency verification via hash comparison
- [x] Multi-client testing infrastructure
- [x] KV sync simulation for testing

---

## Phase 8: Cloudflare Backend Setup ✅

**Goal:** Deploy infrastructure for multiplayer

### Completed

- [x] `wrangler.jsonc` configured with DO and R2 bindings
- [x] LiveSessionDurableObject class created (`live-session.ts`)
- [x] Worker exports DO class
- [x] WebSocket upgrade handling
- [x] DO hibernation API support

---

## Phase 9: Multiplayer State Sync ✅

**Goal:** Real-time grid sharing between players

### Completed

- [x] WebSocket message protocol (23 message types)
- [x] State synchronization on player join (snapshot)
- [x] Broadcast changes to all connected players
- [x] Track add/delete/clear operations
- [x] Step toggle synchronization
- [x] Tempo/swing changes
- [x] Mute/solo state
- [x] Parameter locks
- [x] Track sample/volume/transpose changes
- [x] Max 10 players per session

---

## Phase 10: Clock Sync ✅

**Goal:** Synchronized playback across players

### Completed

- [x] Clock sync request/response protocol
- [x] Server time authority
- [x] Playback start/stop synchronization
- [x] RTT-based offset calculation

---

## Phase 11: Presence & Awareness ✅

**Goal:** Make multiplayer feel alive, prevent "poltergeist" problem

### Completed

- [x] **Anonymous identities** — 18 colors × 73 animals (1,314 combinations)
- [x] **Player join/leave notifications** — Broadcast to all players
- [x] **Change attribution** — All broadcasts include `playerId`
- [x] **State invariant validation** — Detect and repair corruption
- [x] **DO Alarms** — Hibernation-safe KV saves (replaced setTimeout)
- [x] **Production logging** — Invariant violations logged via `logInvariantStatus()`
- [x] **Avatar stack in header UI** — Shows connected players with colored avatars
- [x] **Cursor tracking** — Real-time cursor positions with 50ms throttling
- [x] **Visual change attribution** — Color-coded flash animations on remote changes
- [x] **Toast notifications** — Player join/leave toasts
- [x] **Ghost player fix** — `webSocketError` now properly broadcasts `player_left`

### Also Completed (Later)

- [x] **Session naming** — Inline editable name in header, persists via API, updates browser tab
- [x] **Cursor hidden on mobile** — Misleading between form factors, presence via avatar stack instead

### Deferred

- [ ] Beat-quantized changes (batch to musical boundaries) — Moved to Phase 21

### Files Added/Modified

| File | Purpose |
|------|---------|
| `src/worker/live-session.ts` | DO with identity generation, invariant validation, cursor handling |
| `src/worker/invariants.ts` | State validation, logging, auto-repair |
| `src/sync/multiplayer.ts` | Cursor state, remote change callbacks |
| `src/context/RemoteChangeContext.tsx` | Flash animation state management |
| `src/context/MultiplayerContext.tsx` | Cursor sharing context |
| `src/components/CursorOverlay.tsx` | Remote cursor visualization |
| `src/components/AvatarStack.tsx` | Player avatar display |
| `src/components/ToastNotification.tsx` | Join/leave notifications |
| `docs/Multiplayer_lessons.md` | Lessons learned from Phase 11 debugging |

---

## Phase 12: Error Handling & Testing ✅

**Goal:** Robust reconnection, offline support, comprehensive testing

### Completed

- [x] **Exponential backoff with jitter** — Reconnection delays with randomization
- [x] **Offline message queue** — Buffer messages during disconnect, replay on reconnect
- [x] **Connection status UI** — Visual indicator (connected/connecting/disconnected)
- [x] **Queue size indicator** — Shows pending messages during reconnection
- [x] **Reconnection attempt counter** — Tracks retry progress
- [x] **State hash verification** — Client sends periodic state hashes, server validates and responds with `state_hash_match` or `state_mismatch`
- [x] **Automatic state resync** — Client requests snapshot after consecutive mismatches
- [x] **Clock sync metrics** — RTT P95 calculation using nearest-rank method
- [x] **Unit tests** — Backoff algorithm, queue behavior, hash verification
- [x] **E2E tests** — Session persistence, multiplayer scenarios

---

## Phase 13A: Backend Hardening ✅

**Goal:** Apply Cloudflare-recommended patterns to improve reliability and reduce costs

### Completed

- [x] **Worker-level validation** — Validate requests BEFORE routing to DO (saves billing)
- [x] **UUID format validation** — Reject malformed session IDs early
- [x] **Body size validation** — Check Content-Length before parsing JSON
- [x] **Session state validation** — Validate tempo, swing, tracks against invariants
- [x] **Session name XSS prevention** — Block `<script>`, `javascript:`, event handlers
- [x] **Stub recreation on errors** — Recreate DO stub on retryable errors
- [x] **Overload error handling** — Return 503 on DO overload (no retry)
- [x] **Request timeouts** — AbortController with 10-15s timeouts

---

## Phase 13B: Frontend Hardening ✅

**Goal:** Address technical debt from comprehensive codebase audit

> **Lessons Learned:** See [PHASE-13B-LESSONS.md](./research/PHASE-13B-LESSONS.md)

### Critical Issues Fixed

| Issue | Fix |
|-------|-----|
| Race condition in useSession.ts | State machine: `idle` → `loading` → `applying` → `ready` |
| WebSocket message ordering | Client/server sequence numbers |
| Missing Error Boundary | React Error Boundary with recovery UI |

### High Priority Issues Fixed

| Issue | Fix |
|-------|-----|
| Memory leak in RemoteChangeContext | Track timers in Set, clear in cleanup |
| Audio volume reset timers | Added `pendingTimers` Set with cleanup on `stop()` |
| Missing null check | Defensive null checks with fallback |
| Race condition in useMultiplayer | Cancellation flag pattern |
| Unbounded message queue | Priority queue: `high` > `normal` > `low` |

### Medium Priority Issues Fixed

| Issue | Fix |
|-------|-----|
| Inconsistent constants | Aligned server to client bounds + parity tests |
| Missing error handling in audio decode | try/catch with meaningful error messages |
| Scheduler timing drift | Multiplicative timing: `startTime + (stepCount * duration)` |
| Missing mic cleanup | `releaseMicAccess()` stops MediaStream tracks |

### Documentation Created

| Document | Purpose |
|----------|---------|
| [PHASE-13B-LESSONS.md](./research/PHASE-13B-LESSONS.md) | Patterns, anti-patterns, key takeaways |
| [DURABLE-OBJECTS-TESTING.md](./research/DURABLE-OBJECTS-TESTING.md) | Comprehensive DO testing guide |
| [REACT-BEST-PRACTICES.md](./research/REACT-BEST-PRACTICES.md) | React patterns for real-time collaborative apps |

### Key Patterns Documented

1. **State machines > boolean flags** for async operations
2. **Track all timers** in a Set for reliable cleanup
3. **Use cancellation flags** in useEffect to prevent stale callbacks
4. **Multiplicative timing** prevents drift in schedulers
5. **Priority queues** protect critical messages
6. **Parity tests** catch constant drift between modules
7. **Always catch** external API errors with meaningful messages
8. **Release resources** (MediaStream tracks, WebSockets) explicitly

---

## Phase 14: Resilience & Testing Infrastructure ✅

**Goal:** Improve API resilience and establish integration testing patterns

### Completed

- [x] **HTTP retry with exponential backoff** — 1s → 2s → 4s → 8s (capped at 30s) with ±25% jitter
- [x] **Retry-After header support** — Respects server-specified retry delays
- [x] **Integration tests** — vitest-pool-workers with real DO/KV (via Miniflare)
- [x] **Quota observability strategy** — Documented in QUOTA-OBSERVABILITY.md

---

## Phase 15: Polish & Production 🔄 In Progress

**Goal:** Production-ready quality and polish

### Completed

#### Mobile Portrait Mode
- [x] **Read-mostly layout** — Optimized for viewing shared sessions
- [x] **Track header row** — Name with synth indicator (♪) and M/S status badges
- [x] **Full-width step grid** — Swipeable horizontally, partial cell visibility at edge
- [x] **Expandable edit panel** — "tap to edit" reveals M/S, Transpose, Steps, Copy/Clear/Delete
- [x] **Scroll snap alignment** — Clean stopping points when swiping
- [x] **OrientationHint** — Dismissible suggestion to rotate for more steps
- [x] **48x48px step cells** — Larger touch targets in portrait
- [x] **Hidden cursor arrows** — Misleading between form factors, presence via avatar stack

#### Infrastructure
- [x] **Dev-only logger** — Production console output suppressed
- [x] **iOS audio fixes** — AudioContext resume on touch events
- [x] **iOS clipboard fix** — Share/Send Copy work on iOS Safari/Chrome with fallback toast

### Remaining

- [ ] Loading states and skeleton screens
- [ ] Long-press for parameter locks on mobile
- [ ] Profile and optimize hot paths (StepButton rendering)
- [ ] Lazy-load preset samples
- [ ] Code splitting for faster initial load
- [ ] User guide / help overlay
- [ ] Keyboard shortcuts reference

---

## Phases 16-23: Future Work

See [ROADMAP.md](./ROADMAP.md) for planned implementation.

- **Phase 16:** Authentication & Session Ownership — BetterAuth integration
- **Phase 17:** Shared Sample Recording — R2-backed multiplayer samples
- **Phase 18:** Publishing (Immutable Sessions) — see [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md)
- **Phase 19:** Advanced Synthesis Engine — Sampled instruments, effects
- **Phase 20:** Session Provenance — Rich clipboard, family tree
- **Phase 21:** Beat-Quantized Changes — Musical sync for remote edits
- **Phase 22:** Playwright E2E Testing — Multi-client, cross-browser
- **Phase 23:** Public API — Authenticated API access for integrations

---

## Deployment

**Live URL:** https://keyboardia.adewale-883.workers.dev

---

## Quick Links

### Core Specs
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Technical architecture
- [WHY_CLOUDFLARE.md](./WHY_CLOUDFLARE.md) — Why Cloudflare Workers, KV, DO, R2
- [SESSION-SHARING.md](./SESSION-SHARING.md) — Session persistence & sharing spec
- [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md) — Session state machine, sharing modes
- [SOLO.md](./SOLO.md) — Solo feature specification
- [KEYBOARD-SHORTCUTS.md](./KEYBOARD-SHORTCUTS.md) — Keyboard shortcuts specification
- [TESTING.md](./TESTING.md) — Testing plan
- [UI-PHILOSOPHY.md](../app/UI-PHILOSOPHY.md) — OP-Z inspired design principles

### Research

- [research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md](./research/CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md) — 150+ DO features with documentation URLs
- [research/PHASE-13B-LESSONS.md](./research/PHASE-13B-LESSONS.md) — Frontend hardening patterns and lessons learned
- [research/REACT-BEST-PRACTICES.md](./research/REACT-BEST-PRACTICES.md) — React patterns for real-time collaborative apps
- [research/DURABLE-OBJECTS-TESTING.md](./research/DURABLE-OBJECTS-TESTING.md) — Comprehensive DO testing guide
- [research/INTEGRATION-TESTING.md](./research/INTEGRATION-TESTING.md) — vitest-pool-workers patterns
- [research/MOBILE-UI-PATTERNS.md](./research/MOBILE-UI-PATTERNS.md) — Responsive design decisions
- [research/MOBILE-LESSONS.md](./research/MOBILE-LESSONS.md) — Lessons from mobile UI work
- [research/MULTIPLAYER-PRESENCE-RESEARCH.md](./research/MULTIPLAYER-PRESENCE-RESEARCH.md) — Presence and awareness patterns
- [research/EMERGENCE.md](./research/EMERGENCE.md) — Emergent behaviors and community features
- [research/DURABLE-OBJECTS-COSTS.md](./research/DURABLE-OBJECTS-COSTS.md) — DO pricing analysis
- [research/COST-ANALYSIS.md](./research/COST-ANALYSIS.md) — Cloudflare cost analysis with projections
- [research/IOS-CHROME-COMPATIBILITY.md](./research/IOS-CHROME-COMPATIBILITY.md) — iOS/Chrome browser API compatibility
- [research/RESEARCH-PLAYBACK-MODES.md](./research/RESEARCH-PLAYBACK-MODES.md) — Playback mode research
- [research/ABLETON-LEARNING-MUSIC-ANALYSIS.md](./research/ABLETON-LEARNING-MUSIC-ANALYSIS.md) — Ableton Learning Music analysis
