# Keyboardia Implementation Status

> Current version: **0.2.1**

## Current Phase: Phase 36 — Keyboard Shortcuts

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
| 15 | ✅ Complete | iOS Ghost Click Fix |
| 16 | ✅ Complete | Audio Engineering |
| 17 | ✅ Complete | Favicon |
| 18 | ✅ Complete | Musical Foundations (Triplets, ±24 semitones) |
| 19 | ✅ Complete | Session Name API Fix |
| 20 | ✅ Complete | QR Code Sharing |
| 21 | ✅ Complete | Publishing (Immutable Sessions) |
| 22 | ✅ Complete | Codebase Audit & Advanced Synthesis Engine |
| 23 | ✅ Complete | UI Polish, Effects Controls, LRU Cache, Percussion Expansion |
| 24 | ✅ Complete | Unified Audio Bus Architecture |
| 25 | ✅ Complete | Hidden Feature UI Exposure |
| 26 | ✅ Complete | Mutation Tracking & Multiplayer Reliability |
| 27 | ✅ Complete | MIDI Export |
| 28 | ✅ Complete | Homepage (Landing Page) |
| 29 | ✅ Complete | Musical Enrichment (Samples, Held Notes, Key Assistant) |
| 30 | ✅ Complete | Color System Unification |
| 31 | ✅ Complete | UI Enhancements |
| 32 | ✅ Complete | Property-Based Testing (Sync Completeness) |
| 33 | ✅ Complete | Playwright E2E Testing (1048 tests, 27 files) |
| 34 | ✅ Complete | Performance & Reliability (41% bundle reduction, Suspense skeletons) |
| 35 | ✅ Complete | Observability 2.0 (Wide Events, Workers Logs) |
| 36 | Partial | Keyboard Shortcuts (Delete/Escape/Shift+Click work) |
| 37 | Not Started | Rich Clipboard (iOS clipboard utilities implemented) |
| 38 | Not Started | Mobile UI Polish |
| 39 | Not Started | Authentication & Session Ownership |
| 40 | Not Started | Session Family Tree |
| 41 | Not Started | Public API |
| 42 | Not Started | Admin Dashboard & Operations |

---

## Phase 1: Local Audio Playground ✅

**Goal:** User can create beats and hear them immediately (no backend)

### Completed

- ✅ Initialize Vite + React + TypeScript project
- ✅ Create basic UI components
  - ✅ `StepSequencer.tsx`
  - ✅ `StepCell.tsx` (with visual swing offset, p-lock badges)
  - ✅ `TrackRow.tsx` (inline controls, mode toggle)
  - ✅ `Transport.tsx` (play/stop, tempo, swing)
- ✅ Implement audio engine
  - ✅ `engine.ts` — AudioContext setup, sample loading
  - ✅ `scheduler.ts` — Lookahead scheduling (25ms timer, 100ms ahead)
  - ✅ `samples.ts` — Synthesized samples (16 sounds)
  - ✅ `synth.ts` — Real-time synthesizer engine (5 presets)
- ✅ Implement state management
  - ✅ `grid.tsx` — React Context + useReducer
- ✅ Wire up UI to audio engine

### Additional Features Implemented

- ✅ **Swing/Shuffle** — Adjustable swing timing (0-100%)
- ✅ **Parameter Locks** — Per-step pitch and volume overrides
- ✅ **Track Transpose** — Per-track pitch offset (-12 to +12 semitones)
- ✅ **Per-Track Step Count** — Polyrhythms via independent loop lengths (4/8/12/16/24/32/64/96/128 steps)
- ✅ **Solo** — Per-track solo with industry-standard behavior (solo wins over mute)
- ✅ **16 tracks** — Supports up to 16 simultaneous tracks
- ✅ **Copy/Paste** — Copy patterns between tracks
- ✅ **Mute/Clear/Delete** — Per-track controls

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

- ✅ Implement `recorder.ts` — MediaRecorder wrapper
- ✅ Add Recorder UI component with waveform display
- ✅ Preview before adding to grid
- ✅ Auto-slice with transient detection
- ✅ Add recorded samples as new tracks

---

## Phase 3: Session Persistence & Sharing ✅

**Goal:** Users can save, share, and remix sessions via unique URLs

### Completed

- ✅ Create KV namespace for session storage (permanent, no TTL)
- ✅ Worker API endpoints
  - ✅ `POST /api/sessions` — Create new session
  - ✅ `GET /api/sessions/:id` — Load session
  - ✅ `PUT /api/sessions/:id` — Update session (debounced auto-save)
  - ✅ `POST /api/sessions/:id/remix` — Remix a session
- ✅ Frontend session sync layer (`sync/session.ts`)
- ✅ Share/Remix/New UI buttons in header
- ✅ URL routing (`/s/{uuid}`) with SPA support
- ✅ Session state includes: tracks, tempo, swing, parameter locks
- ✅ Remix tracking (remixedFrom field)
- ✅ "Session not found" error handling with Create New option

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

- ✅ Extend MAX_STEPS to 128
- ✅ Per-track stepCount property (4, 8, 12, 16, 24, 32, 64, 96, or 128)
- ✅ Step count dropdown in track controls (replaced buttons)
- ✅ Polyrhythmic looping — each track loops at its own length
- ✅ Solo button — per-track solo with yellow (#f1c40f) active state
- ✅ Visual enhancements
  - ✅ Active step glow effect (box-shadow pulse)
  - ✅ Velocity fill indicator (volume p-lock visualization)
  - ✅ Page separators every 16 steps
  - ✅ Dark mode colors (#121212 background, desaturated accents)
- ✅ Inline scrolling for steps that exceed viewport
- ✅ Fixed-width track controls to prevent layout shift
- ✅ Backwards compatibility for existing sessions (default to 16 steps)
- ✅ Mobile drawer dropdown for step count

### Step Count Options

| Steps | Bars | Loops/Bar | Use Case |
|-------|------|-----------|----------|
| **4** | 0.25 | 8× | Four-on-the-floor kick, pulse patterns, motorik beat |
| **8** | 0.5 | 4× | Half-bar phrases, 8th-note arpeggios, call-response |
| **12** | 0.75 | ~2.67× | Triplet feel, jazz/gospel shuffle, waltz |
| 16 | 1 | 2× | Standard patterns (drums, bass) |
| **24** | 1.5 | ~1.33× | Triplet hi-hats (trap), Afro-Cuban rhythms |
| 32 | 2 | 1× | Basslines with variation, 2-bar melodies |
| 64 | 4 | 0.5× | Long melodies, chord progressions, evolving patterns |
| **96** | 6 | ~0.33× | Extended triplet patterns, 6-bar phrases |
| **128** | 8 | 0.25× | Full verse/chorus sections, cinematic builds |

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

- ✅ Rename "Share" button to "Invite"
- ✅ Add "Send Copy" button (creates remix, copies URL, stays on current session)
- ✅ Add `lastAccessedAt` field to session model (for orphan detection)
- ✅ Add `remixCount` field to session model
- ✅ Add `remixedFromName` field to session model
- ✅ Display remix lineage in session header ("Remixed from X")
- ✅ Show remix count as social proof
- ✅ Add orphan banner for sessions inactive 90+ days
- ✅ Backwards compatibility for existing sessions

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

- ✅ Structured request logging middleware
  - Request/response logging for all API endpoints
  - Logs include: timestamp, requestId, method, path, status, responseTime
  - Session state tracking (trackCount, hasData)
  - Stored in KV with 1-hour TTL for cost efficiency
- ✅ Debug endpoints
  - `GET /api/debug/session/:id` — Inspect session state without modifying access time
  - `GET /api/debug/logs` — Query recent logs (supports `?sessionId=` and `?last=` filters)
- ✅ Observability 2.0
  - Metrics derived from Workers Logs wide events (replaced legacy `/api/metrics` endpoint)
  - Use `wrangler tail` or Cloudflare dashboard for real-time monitoring
- ✅ Client-side debug mode (`?debug=1`)
  - Debug overlay showing session ID and state
  - Real-time operation logging in UI
  - Quick links to debug API endpoints
  - Console logging of all session operations
- ✅ Playwright debug tests
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

- ✅ Expand/collapse toggle on synth tracks (♪ button)
- ✅ Chromatic grid with 12 pitch rows (-12 to +12 semitones)
- ✅ Click-to-place notes at pitch/step intersections
- ✅ Pitch contour overlay on collapsed view (shows melody shape)
- ✅ Sound preview when placing notes
- ✅ Visual feedback for playing notes

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

- ✅ Mock Durable Object for local development (`mock-durable-object.ts`)
- ✅ WebSocket lifecycle logging (connect, message, disconnect)
- ✅ Debug endpoints for multiplayer state
- ✅ State consistency verification via hash comparison
- ✅ Multi-client testing infrastructure
- ✅ KV sync simulation for testing

---

## Phase 8: Cloudflare Backend Setup ✅

**Goal:** Deploy infrastructure for multiplayer

### Completed

- ✅ `wrangler.jsonc` configured with DO and R2 bindings
- ✅ LiveSessionDurableObject class created (`live-session.ts`)
- ✅ Worker exports DO class
- ✅ WebSocket upgrade handling
- ✅ DO hibernation API support

---

## Phase 9: Multiplayer State Sync ✅

**Goal:** Real-time grid sharing between players

### Completed

- ✅ WebSocket message protocol (23 message types)
- ✅ State synchronization on player join (snapshot)
- ✅ Broadcast changes to all connected players
- ✅ Track add/delete/clear operations
- ✅ Step toggle synchronization
- ✅ Tempo/swing changes
- ✅ Mute/solo state
- ✅ Parameter locks
- ✅ Track sample/volume/transpose changes
- ✅ Max 10 players per session

---

## Phase 10: Clock Sync ✅

**Goal:** Synchronized playback across players

### Completed

- ✅ Clock sync request/response protocol
- ✅ Server time authority
- ✅ Playback start/stop synchronization
- ✅ RTT-based offset calculation

---

## Phase 11: Presence & Awareness ✅

**Goal:** Make multiplayer feel alive, prevent "poltergeist" problem

### Completed

- ✅ **Anonymous identities** — 18 colors × 73 animals (1,314 combinations)
- ✅ **Player join/leave notifications** — Broadcast to all players
- ✅ **Change attribution** — All broadcasts include `playerId`
- ✅ **State invariant validation** — Detect and repair corruption
- ✅ **DO Alarms** — Hibernation-safe KV saves (replaced setTimeout)
- ✅ **Production logging** — Invariant violations logged via `logInvariantStatus()`
- ✅ **Avatar stack in header UI** — Shows connected players with colored avatars
- ✅ **Cursor tracking** — Real-time cursor positions with 50ms throttling
- ✅ **Visual change attribution** — Color-coded flash animations on remote changes
- ✅ **Toast notifications** — Player join/leave toasts
- ✅ **Ghost player fix** — `webSocketError` now properly broadcasts `player_left`

### Also Completed (Later)

- ✅ **Session naming** — Inline editable name in header, persists via API, updates browser tab
- ✅ **Cursor hidden on mobile** — Misleading between form factors, presence via avatar stack instead
- ✅ **Playback presence indicators** — (Phase 22) Play icon on avatars when players are playing

### Deferred

- [ ] Beat-quantized changes (batch to musical boundaries) — Moved to Phase 28

### Files Added/Modified

| File | Purpose |
|------|---------|
| `src/worker/live-session.ts` | DO with identity generation, invariant validation, cursor handling, playback tracking |
| `src/worker/invariants.ts` | State validation, logging, auto-repair |
| `src/sync/multiplayer.ts` | Cursor state, remote change callbacks, playback presence tracking |
| `src/context/RemoteChangeContext.tsx` | Flash animation state management |
| `src/context/MultiplayerContext.tsx` | Cursor sharing context, playback presence |
| `src/components/CursorOverlay.tsx` | Remote cursor visualization |
| `src/components/AvatarStack.tsx` | Player avatar display with playback indicators |
| `src/components/ToastNotification.tsx` | Join/leave notifications |
| `docs/Multiplayer_lessons.md` | Lessons learned from Phase 11 debugging |

---

## Phase 12: Error Handling & Testing ✅

**Goal:** Robust reconnection, offline support, comprehensive testing

### Completed

- ✅ **Exponential backoff with jitter** — Reconnection delays with randomization
- ✅ **Offline message queue** — Buffer messages during disconnect, replay on reconnect
- ✅ **Connection status UI** — Visual indicator (connected/connecting/disconnected)
- ✅ **Queue size indicator** — Shows pending messages during reconnection
- ✅ **Reconnection attempt counter** — Tracks retry progress
- ✅ **State hash verification** — Client sends periodic state hashes, server validates and responds with `state_hash_match` or `state_mismatch`
- ✅ **Automatic state resync** — Client requests snapshot after consecutive mismatches
- ✅ **Clock sync metrics** — RTT P95 calculation using nearest-rank method
- ✅ **Unit tests** — Backoff algorithm, queue behavior, hash verification
- ✅ **E2E tests** — Session persistence, multiplayer scenarios

---

## Phase 13A: Backend Hardening ✅

**Goal:** Apply Cloudflare-recommended patterns to improve reliability and reduce costs

### Completed

- ✅ **Worker-level validation** — Validate requests BEFORE routing to DO (saves billing)
- ✅ **UUID format validation** — Reject malformed session IDs early
- ✅ **Body size validation** — Check Content-Length before parsing JSON
- ✅ **Session state validation** — Validate tempo, swing, tracks against invariants
- ✅ **Session name XSS prevention** — Block `<script>`, `javascript:`, event handlers
- ✅ **Stub recreation on errors** — Recreate DO stub on retryable errors
- ✅ **Overload error handling** — Return 503 on DO overload (no retry)
- ✅ **Request timeouts** — AbortController with 10-15s timeouts

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

- ✅ **HTTP retry with exponential backoff** — 1s → 2s → 4s → 8s (capped at 30s) with ±25% jitter
- ✅ **Retry-After header support** — Respects server-specified retry delays
- ✅ **Integration tests** — vitest-pool-workers with real DO/KV (via Miniflare)
- ✅ **Quota observability strategy** — Documented in QUOTA-OBSERVABILITY.md

---

## Phase 15: Polish & Production 🔄 In Progress

**Goal:** Production-ready quality and polish

### Completed

#### Mobile Portrait Mode
- ✅ **Read-mostly layout** — Optimized for viewing shared sessions
- ✅ **Track header row** — Name with synth indicator (♪) and M/S status badges
- ✅ **Full-width step grid** — Swipeable horizontally, partial cell visibility at edge
- ✅ **Expandable edit panel** — "tap to edit" reveals M/S, Transpose, Steps, Copy/Clear/Delete
- ✅ **Scroll snap alignment** — Clean stopping points when swiping
- ✅ **OrientationHint** — Dismissible suggestion to rotate for more steps
- ✅ **48x48px step cells** — Larger touch targets in portrait
- ✅ **Hidden cursor arrows** — Misleading between form factors, presence via avatar stack

#### Infrastructure
- ✅ **Dev-only logger** — Production console output suppressed
- ✅ **iOS audio fixes** — AudioContext resume on touch events
- ✅ **iOS clipboard fix** — Share/Send Copy work on iOS Safari/Chrome with fallback toast

### Remaining

- [ ] Loading states and skeleton screens
- [ ] Long-press for parameter locks on mobile
- [ ] Profile and optimize hot paths (StepButton rendering)
- [ ] Lazy-load preset samples
- [ ] Code splitting for faster initial load
- [ ] User guide / help overlay
- [ ] Keyboard shortcuts reference

---

## Phase 23: UI Polish, Effects Controls, LRU Cache ✅

**Goal:** Enhanced effects UI, playback controls, and memory-efficient sample caching

### Completed

#### Effects Master Bypass
- ✅ **Bypass toggle in Transport** — Enable/disable all effects without losing settings
- ✅ **Bypass toggle in EffectsPanel** — Mobile-friendly bypass control
- ✅ **Visual feedback** — Green when active, red when bypassed
- ✅ **State preserved** — All effect parameters retained when bypassed

#### Combined FX Button
- ✅ **Split click zones** — Main area toggles bypass, chevron toggles panel
- ✅ **Stable width** — CSS Grid stacking renders both states, opacity toggles visibility
- ✅ **Perfect vertical alignment** — Grid with `place-items: center`, `line-height: 1`
- ✅ **Information hierarchy** — Bypass is primary action, panel toggle is secondary

#### Playback Mode Toggle
- ✅ **SET_TRACK_PLAYBACK_MODE action** — New reducer action for changing playback mode
- ✅ **Mode toggle UI in InlineDrawer** — Mobile-friendly control in track drawer
- ✅ **Desktop mode toggle** — Button in TrackRow grid column
- ✅ **One-shot/Gate modes** — One-shot plays to completion, Gate cuts at step boundary
- ✅ **Visual indication** — Mode button shows current state with clear icons

#### XY Pad Component
- ✅ **XYPad.tsx** — Reusable two-dimensional parameter control
- ✅ **Touch and mouse support** — Works on mobile and desktop
- ✅ **Integration with reverb** — Controls wet/decay simultaneously
- ✅ **Visual feedback** — Crosshairs, puck, axis labels, value display
- ✅ **External labels** — Labels outside interactive area for clean sizing
- ✅ **Accessibility** — ARIA attributes, keyboard focus support

#### LRU Sample Cache
- ✅ **LRUSampleCache class** — O(1) get/set with doubly-linked list
- ✅ **Reference counting** — Prevents evicting in-use samples
- ✅ **Memory management** — Size-based eviction (default 64MB limit)
- ✅ **Metrics** — Hits, misses, evictions, current size tracking
- ✅ **Specification document** — specs/LRU-SAMPLE-CACHE.md

#### Cache Integration (Phase 23 final)
- ✅ **SampledInstrument uses cache** — Samples cached to avoid redundant network requests
- ✅ **Cache key format** — `{instrumentId}:{note}` (e.g., `piano:60`)
- ✅ **Reference counting API** — `acquireCacheReferences()` / `releaseCacheReferences()` on instruments
- ✅ **Engine integration** — `acquireInstrumentSamples()` / `releaseInstrumentSamples()` methods
- ✅ **Loading state API** — `getSampledInstrumentState()` and `onSampledInstrumentStateChange()` for UI

#### Lazy Loading
- ✅ **Removed eager preload** — Instruments no longer load at startup
- ✅ **On-demand loading** — Instruments load when first used via `ensureLoaded()` or `load()`
- ✅ **Progressive loading preserved** — C4 loads first, then remaining samples in background

### Files Added

| File | Purpose |
|------|---------|
| `src/components/XYPad.tsx` | XY pad component |
| `src/components/XYPad.css` | XY pad styles |
| `src/audio/lru-sample-cache.ts` | LRU cache with reference counting |
| `src/audio/lru-sample-cache.test.ts` | 25 unit tests for cache |
| `specs/LRU-SAMPLE-CACHE.md` | Cache architecture specification |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/Transport.tsx` | Combined FX button, effects bypass, XY pad integration |
| `src/components/Transport.css` | CSS Grid centering, stable width, bypass button styles |
| `src/components/EffectsPanel.tsx` | Bypass toggle |
| `src/components/EffectsPanel.css` | Bypass button styles |
| `src/components/TrackRow.tsx` | Playback mode toggle (desktop) |
| `src/components/TrackRow.css` | Playback mode grid column |
| `src/components/InlineDrawer.css` | Playback mode button styles |
| `src/components/StepSequencer.tsx` | Playback mode handler |
| `src/state/grid.tsx` | SET_TRACK_PLAYBACK_MODE reducer case |
| `src/types.ts` | SET_TRACK_PLAYBACK_MODE action type |
| `src/audio/sampled-instrument.ts` | LRU cache integration, lazy loading |
| `src/audio/engine.ts` | Removed eager preload, added cache reference APIs |

---

## Phase 24: Performance Optimization

**Goal:** Optimize rendering performance and reduce bundle size for production

### Planned

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **Profile and optimize hot paths** | React DevTools profiling, memoization audit, reduce re-renders in StepButton/StepCell during playback | Medium | High |
| **Code splitting** | Lazy load heavy components: EffectsPanel, ChromaticGrid, Recorder, DebugOverlay. Use React.lazy() + Suspense with fallback UI. | Medium | Medium |
| **Bundle analysis** | Run build analyzer. Audit Tone.js tree-shaking. Identify oversized dependencies. Consider lighter alternatives where possible. | Low | Medium |

### Success Criteria

| Metric | Target |
|--------|--------|
| Initial JS bundle | < 200KB gzipped |
| StepButton re-render | < 1ms |
| Playback framerate | 60fps (no dropped frames) |
| Time to Interactive | < 3s on 3G |

### Technical Approach

**Profiling workflow:**
1. React DevTools Profiler → identify slow components
2. `why-did-you-render` → catch unnecessary re-renders
3. Chrome Performance tab → measure actual frame times
4. Lighthouse → track regression

**Code splitting targets:**
```typescript
// Lazy load heavy features
const EffectsPanel = React.lazy(() => import('./EffectsPanel'));
const ChromaticGrid = React.lazy(() => import('./ChromaticGrid'));
const Recorder = React.lazy(() => import('./Recorder'));
const DebugOverlay = React.lazy(() => import('./debug/DebugOverlay'));
```

---

## Phase 25: Mobile UX Polish

**Goal:** Improve mobile touch interactions and perceived performance

### Planned

| Task | Description | Effort | Priority |
|------|-------------|--------|----------|
| **Loading states and skeleton screens** | Show placeholder UI during session load and sample decode. Skeleton components for TrackRow, Transport, StepGrid. Smooth fade-in on content ready. | Medium | High |
| **Long-press for parameter locks on mobile** | 500ms touch-and-hold opens p-lock editor (pitch/volume). Visual feedback during hold (progress ring). Haptic feedback on iOS/Android. Matches desktop Shift+Click behavior. | Medium | High |

### Success Criteria

| Metric | Target |
|--------|--------|
| Perceived load time | Instant (skeleton visible < 100ms) |
| Long-press recognition | 500ms ± 50ms |
| P-lock editor usability | Can adjust pitch/volume without accidental dismissal |

### Technical Approach

**Skeleton screens:**
```typescript
// Skeleton component pattern
function TrackRowSkeleton() {
  return (
    <div className="track-row skeleton">
      <div className="skeleton-box" style={{ width: 80 }} />
      <div className="skeleton-steps">
        {Array(16).fill(0).map((_, i) => (
          <div key={i} className="skeleton-step" />
        ))}
      </div>
    </div>
  );
}

// Usage with Suspense
<Suspense fallback={<TrackRowSkeleton />}>
  <TrackRow {...props} />
</Suspense>
```

**Long-press detection:**
```typescript
function useLongPress(callback: () => void, ms = 500) {
  const timerRef = useRef<number>();
  const [pressing, setPressing] = useState(false);

  const start = useCallback(() => {
    setPressing(true);
    timerRef.current = window.setTimeout(() => {
      // Haptic feedback
      navigator.vibrate?.(10);
      callback();
    }, ms);
  }, [callback, ms]);

  const cancel = useCallback(() => {
    setPressing(false);
    clearTimeout(timerRef.current);
  }, []);

  return { onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, pressing };
}
```

---

## Phase 26: Mutation Tracking & Multiplayer Reliability ✅

**Goal:** Improve multiplayer sync reliability with mutation tracking and invariant detection

### Completed

- ✅ **Full mutation tracking** — Track pending mutations from send to server confirmation
- ✅ **Delivery confirmation** — clientSeq echo from server confirms mutation delivery
- ✅ **Supersession detection** — Detect when another player touches same key
- ✅ **Invariant violation logging** — `[INVARIANT VIOLATION]` logs for lost mutations
- ✅ **Snapshot regression detection** — Log when confirmed state missing from snapshot
- ✅ **SyncHealth refactor** — Unified health tracking (sequence, hash, recovery)
- ✅ **Handler factory consolidation** — Reduced boilerplate in live-session.ts
- ✅ **Message type consolidation** — Single source of truth in `src/shared/message-types.ts`
- ✅ **Comprehensive E2E test tool** — `scripts/staging-e2e-test.ts` with 13 tests

---

## Phase 27: Hybrid Persistence Architecture ✅

**Goal:** Eliminate data loss vulnerability by using DO storage as primary persistence

### Completed

- ✅ **DO storage per-mutation** — State persisted immediately via `ctx.storage.put()`
- ✅ **KV on-disconnect only** — Single KV write when last client leaves
- ✅ **Load from DO first** — `ensureStateLoaded()` checks DO storage before KV
- ✅ **Lazy migration** — Legacy KV sessions migrate to DO storage on first access
- ✅ **Dead code removal** — Removed `scheduleKVSave()`, `alarm()`, `KV_SAVE_DEBOUNCE_MS`
- ✅ **Test updates** — Handler factory tests updated for hybrid persistence

### Architecture

```
Mutation Flow:
1. Client sends mutation
2. DO applies to memory
3. DO persists to ctx.storage.put() (immediate, ~1ms)
4. DO broadcasts to clients
5. (No KV write until disconnect)

On Disconnect (last client):
- DO writes to KV for API reads

On Reconnect:
- DO loads from ctx.storage.get() (fresh state!)
- KV used only for API reads and legacy migration
```

### Cost Impact

| Sessions/Month | KV Debounce (old) | Hybrid (new) | Delta |
|----------------|-------------------|--------------|-------|
| 1M | $145/month | $149/month | +$4 |

**Trade-off:** +$4/month for zero data loss.

---

## Phase 29: Musical Enrichment ✅ Complete

**Goal:** Transform Keyboardia from synthesizer-focused to comprehensive music production through sampled instruments, held notes, and scale lock.

### Sub-Phase Progress

| Phase | Status | Description |
|-------|--------|-------------|
| 29A: Essential Samples | ✅ Complete | 808 kit, acoustic drums, finger bass, vinyl crackle |
| 29B: Held Notes | ✅ Complete | Per-step `tie` property for sustained notes (TB-303 style) |
| 29C: Expressive Samples | ✅ Complete | Rhodes, strings, vibraphone, french horn, alto sax |
| 29D: Complete Collection | ✅ Complete | Clean guitar, acoustic guitar, marimba |
| 29E: Key Assistant | ✅ Complete | Scale Lock + Scale Sidebar |
| 29F: Polyrhythm Support | ✅ Complete | Odd step counts (3, 5, 7, etc.) for true polyrhythms |

### Phase 29A: Essential Samples ✅ Complete

**12 sampled instruments implemented:**

| Instrument | Source | License |
|------------|--------|---------|
| `808-kick` | tidalcycles/Dirt-Samples | Free |
| `808-snare` | tidalcycles/Dirt-Samples | Free |
| `808-hihat-closed` | tidalcycles/Dirt-Samples | Free |
| `808-hihat-open` | tidalcycles/Dirt-Samples | Free |
| `808-clap` | tidalcycles/Dirt-Samples | Free |
| `acoustic-kick` | Virtuosity Drums | CC0 |
| `acoustic-snare` | Virtuosity Drums | CC0 |
| `acoustic-hihat-closed` | U of Iowa | PD |
| `acoustic-hihat-open` | U of Iowa | PD |
| `acoustic-ride` | U of Iowa | PD |
| `finger-bass` | Karoryfer Meatbass | CC0 |
| `vinyl-crackle` | Procedural | CC0 |

### Phase 29B: Held Notes ✅ Complete

**Implementation (TB-303 style ties):**

| Component | Implementation |
|-----------|---------------|
| Data model | `tie?: boolean` in `ParameterLock` (`sync-types.ts:34`) |
| Scheduler | Tie detection skips attack, extends duration (`scheduler.ts:283-294, 408-430`) |
| UI | Tie badge in `StepCell.tsx`, toggle in `TrackRow.tsx` p-lock editor |
| Styling | Blue tie indicator in `StepCell.css` |

**Behavior:** Tied steps continue the previous note without new attack. Pitch comes from first step only.

### Phase 29C: Expressive Samples ✅ Complete

**5 sampled instruments implemented:**

| Instrument | Source | License |
|------------|--------|---------|
| `vibraphone` | U of Iowa | PD |
| `string-section` | VSCO 2 CE | CC0 |
| `rhodes-ep` | jRhodes3d | CC0 |
| `french-horn` | VSCO 2 CE | CC0 |
| `alto-sax` | Karoryfer Weresax | CC0 |

**Removed from spec:** `choir_ah` and `vocal_ooh` — no CC0 multisampled sources found.

### Phase 29D: Complete Collection ✅ Complete

**3 sampled instruments implemented:**

| Instrument | Source | License |
|------------|--------|---------|
| `clean-guitar` | Karoryfer Black and Green Guitars | CC0 |
| `acoustic-guitar` | Discord GM Bank (Martin HD28) | CC0 |
| `marimba` | VSCO 2 CE | CC0 |

**Removed from spec:** `kalimba` — no CC0 multisampled source found (only individual CC0 notes on Freesound).

### Phase 29E: Key Assistant ✅ Complete

**Scale Lock + Scale Sidebar for harmonic safety.**

| Component | Implementation |
|-----------|---------------|
| ScaleSelector | Root note + scale type dropdown in Transport |
| ScaleSidebar | Visual scale reference panel (toggleable) |
| Scale Lock | Constrains ChromaticGrid to scale notes only |
| Multiplayer sync | Scale state synced via `scale_change` message |

**Demo sessions published:**
- Pentatonic Flow (`83015acd-c53d-4c53-94ae-3df62e7acef1`)
- Jazz Exploration (`dcc33ea4-f42b-4379-9c8e-9eb4d669eb30`)
- Minor Key Feels (`ddfa76ad-128f-4d13-ac90-36e2d3e365ff`)

### Phase 29F: Polyrhythm Support ✅ Complete

**Odd step counts for true polyrhythmic patterns.**

| Feature | Implementation |
|---------|---------------|
| VALID_STEP_COUNTS | 24 values including 3, 5, 6, 7, 9, 10, 11, 13, 15, etc. |
| Swing fix | Uses local step position (`trackStep % 2`) not global step |
| Frontend | Full support for odd step counts |
| Backend | Pending update to support odd step counts in persistence |

**Demo sessions (local validation passing):**
- 5 Against 8 (5-step vs 8-step polyrhythm)
- Afrobeat 3:4 (3, 4, 6, 12-step combination)
- Math Rock 7 (all tracks at 7 steps)

### Instrument Totals

| Category | Count |
|----------|-------|
| Procedural samples | 22 |
| Synth presets | 32 |
| Tone.js synths | 11 |
| Advanced synths | 8 |
| **Sampled instruments** | **21** |
| **Total instruments** | **94** |

### Tooling Added

- `npm run samples` — CLI tool for sample processing (validate, normalize, convert, manifest)
- Volume normalization against piano reference (-1.4 dB, ±2 dB tolerance)

---

## Phase 30: Color System Unification ✅ Complete

**Goal:** Consolidate CSS color variables and sync design documentation.

### Completed

- ✅ Unified CSS color variables across all components
- ✅ Migrated to Spotify green (`#1db954`) for success states
- ✅ Play button uses Spotify green with hover fill effect
- ✅ Synced DESIGN-LANGUAGE.md with implementation
- ✅ Removed gate mode (playbackMode) from codebase

### Gate Mode Removal

| Item | Status |
|------|--------|
| Type definitions | ✅ Removed from `types.ts`, `sync-types.ts` |
| Reducer | ✅ Removed `SET_TRACK_PLAYBACK_MODE` case |
| UI components | ✅ Removed toggle from TrackRow |
| Multiplayer messages | ✅ Removed from message types |
| Session JSON files | ✅ No `playbackMode` in any session |
| Backwards compat | ✅ `playbackMode?: string` in state.ts (ignored on load) |

---

## Phase 31: UI Enhancements ✅ Complete

**Goal:** Transform step entry, add professional workflow features, polish visual feedback.

**Summary:** All 20+ features implemented including drag-to-paint, pattern tools, velocity lane, mixer panel, comprehensive tooltips, inaudible instrument warning, and social media preview.

### Completed

| Feature | Section | Description |
|---------|---------|-------------|
| **Drag-to-paint steps** | 31F | Click-drag to paint on/off steps |
| **Pattern manipulation** | 31B | Rotate, invert, reverse, mirror, Euclidean |
| **Category color coding** | 31C | Left border color by instrument category |
| **Double-click rename** | 31D | Inline track name editing |
| **Per-track swing** | 31D | Individual swing per track |
| **Unmute All button** | 31D | Reset all mutes with one click |
| **StepCountDropdown** | 31I | Grouped dropdown with portal overlay |
| **TransposeDropdown** | 31I | Matching grouped dropdown style |
| **Panel animations** | — | Unified grid-template-rows transitions |
| **Implicit grid layout** | — | Grouped gaps (2px within, 8px between) |
| **Cloudflare footer** | — | "Built on the Cloudflare Developer Platform" |
| **Multi-select steps** | 31F | Ctrl+click toggle, Shift+extend selection, Delete/Backspace to clear, batch p-lock apply |
| **Velocity Lane** | 31G | Per-track velocity editing with visual bars |
| **Track reorder** | 31G | Drag-and-drop track reordering via grip handle |
| **Panel title consistency** | 31H | All transport panels use 14px white titles |

#### Multi-Select Steps (31F) Implementation Details

**Completed:**
- ✅ Ctrl+Click to toggle individual step selection
- ✅ Shift+Click to extend selection from anchor to clicked step
- ✅ Visual highlight for selected steps (blue outline)
- ✅ Delete/Backspace keyboard shortcut to clear selected steps and their p-locks
- ✅ Batch p-lock application to selected steps via ChromaticGrid
- ✅ Selection state management (anchor-based for Shift+extend)
- ✅ Multiplayer sync for batch operations (batch_clear_steps, batch_set_parameter_locks)
- ✅ 25 unit tests covering all selection actions
- ✅ Console warning when applying p-locks to inactive steps (skipped)

**Known Limitations:**
- Selection is per-track only (no cross-track selection)
- Selection state is local-only (intentional - each user has their own selection)
- P-locks can only be applied to active (on) steps, inactive steps are silently skipped with console warning

#### Drag-to-Paint (31F) ✅ Fixed

**Status:** Fixed in January 2026. Removed `setPointerCapture()` and implemented container-based event handling.

**Reference:** Bug pattern `pointer-capture-multi-element` in `src/utils/bug-patterns.ts` documents the anti-pattern and correct approach.

### Completed (additional)

| Feature | Section | Description |
|---------|---------|-------------|
| Progress bar above grid | 31A | ✅ Thin progress indicator (StepSequencer.tsx:393-575) |
| Metronome pulse on play button | 31A | ✅ Tempo-aware beat pulse (Transport.tsx:216-224) |
| Click track name to preview | 31D | ✅ Single-click plays sample (200ms debounce) |
| Loop selection | 31G | ✅ LoopRuler component with drag/shift+click (LoopRuler.tsx) |

### Not Started

| Feature | Section | Description |
|---------|---------|-------------|
| Dim unused beat markers | 31C | Reduce visual noise |
| MixerPanel completion | 31I | Multi-track volume faders |
| Tooltips | 31H | Hover help on all elements |
| Inaudible instrument warning | 31H | PitchOverview warns about sub-bass frequencies inaudible on laptop speakers |

### No Longer Necessary

| Feature | Section | Reason |
|---------|---------|--------|
| Track Drawer consolidation | 31I | Desktop uses panel-toggle paradigm (⚙/▎/🎹), mobile uses drawer. Two intentionally different but valid approaches. Per-track volume handled by MixerPanel. |

#### Phase 31H: Pitch Visualization ✅ Complete

| Feature | Status | Description |
|---------|--------|-------------|
| Dynamic note names in ChromaticGrid | ✅ | Pitch labels show actual note names (C, F#, G-1) |
| Instrument range utilities | ✅ | `getInstrumentRange()`, `isInRange()`, `getRangeWarning()` |
| PitchOverview component | ✅ | Multi-track pitch visualization panel |
| pitchToNoteName utility | ✅ | Converts pitch offset to note name with octave |
| PitchOverview UI integration | ✅ | Collapsible panel in StepSequencer |

**Removed from scope:**
- Chord detection: Removed from PitchOverview UI for simplicity (utilities still exist in music-theory.ts)
- Note name tooltips: Deferred
- Range warnings in StepCell: Deferred

**Planned — Inaudible Instrument Warning:**

PitchOverview should warn about instruments that are effectively inaudible on typical hardware:

| Warning Type | Threshold | Visual | Tooltip |
|--------------|-----------|--------|---------|
| Sub-bass on laptop speakers | < 100 Hz fundamental | ⚠️ icon in header | "May be inaudible on laptop speakers (sub-bass frequencies)" |
| Pure sine sub-bass | Sine wave < 130 Hz | ⚠️ icon in header | "Sine waves at low frequencies have no audible harmonics" |
| Extreme transpose | Track below audible range | ⚠️ icon on track dot | "This pitch is below audible range for most speakers" |

**Rationale:** A Bass track using `advanced:sub-bass` at transpose -24 produces 65 Hz frequencies — inaudible on laptop speakers which typically can't reproduce <100 Hz. Users should know when they've added an instrument they can't hear. This warning would have prevented the "inaudible bass" bug discovered in Phase 29C.

**Implementation:**
- Add `getAudibilityWarning(sampleId, transpose): string | null` utility
- Check fundamental frequency against 100 Hz threshold
- Check waveform type (sine = no harmonics, sawtooth = rich harmonics)
- Display warning icon in PitchOverview header row for affected tracks

#### Phase 31H: Velocity Editing ✅ Complete

| Feature | Status | Description |
|---------|--------|-------------|
| VelocityLane component | ✅ | Per-track velocity bars with click/drag editing |
| Color spectrum | ✅ | Purple (pp) → Orange (mf) → Red (ff) |
| Velocity toggle button | ✅ | Per-track expand/collapse (36x36 matching other buttons) |

**Design Decision — VelocityOverview Removed:**

VelocityOverview was removed from scope because it provided information without actionable insight. VelocityLane is sufficient for velocity editing.

---

## Future Work

See [ROADMAP.md](./ROADMAP.md) for planned implementation.

### Recently Completed
- **Phase 34:** Performance & Reliability — 41% bundle reduction (934KB → 547KB), Suspense skeletons, CLS elimination ✅
- **Phase 33:** Playwright E2E Testing — 1048 tests across 27 files, WebSocket tests local-only ✅
- **Phase 32:** Property-Based Testing — Sync completeness verification (4251 unit tests, 111 files) ✅
- **Phase 31:** UI Enhancements — Drag-to-paint, pattern tools, velocity lane, mixer panel, tooltips ✅
- **Phase 30:** Color System Unification — CSS variable migration, Spotify green ✅
- **Phase 29:** Musical Enrichment — 26 sampled instruments, held notes, Key Assistant ✅
- **Phase 28:** Homepage — Landing page with examples and introduction ✅

### Recent Changes (January 2026)
- Added 5 new instruments: Hammond Organ, Wurlitzer EP, Upright Bass, Orchestra Strings, Timpani
- Fixed silent failure bugs with playableRange validation
- Resolved ESLint warnings in ScaleSidebar and grid
- Fixed internal consistency issues (MAX_TRACK_NAME_LENGTH, EFFECTS_BOUNDS, isValidNumberInRange)
- Route all session reads through DO for architectural consistency

### Partial / In Progress
- **Phase 36:** Rich Clipboard — iOS clipboard utilities implemented
- **Phase 37:** Keyboard Shortcuts — Delete/Escape/Shift+Click work

### Not Started
- **Phase 35:** Observability 2.0 — Production monitoring, Sentry integration, alerting
- **Phase 38:** Mobile UI Polish — Action sheets, loading states, touch
- **Phase 39:** Auth & Ownership — BetterAuth integration
- **Phase 40:** Session Family Tree — Visual ancestry and descendant tree
- **Phase 41:** Public API — Authenticated API access for integrations
- **Phase 42:** Admin Dashboard & Operations

---

## Deployment

**Live URL:** https://keyboardia.dev

---

## Quick Links

### Core Specs
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Technical architecture
- [WHY_CLOUDFLARE.md](./WHY_CLOUDFLARE.md) — Why Cloudflare Workers, KV, DO, R2
- [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) — Session persistence & sharing spec
- [SESSION-LIFECYCLE.md](./SESSION-LIFECYCLE.md) — Session state machine, sharing modes
- [SESSION-NOTATION.md](./SESSION-NOTATION.md) — Text pattern notation and JSON data model
- [SOLO.md](./SOLO.md) — Solo feature specification
- [KEYBOARD-SHORTCUTS.md](./KEYBOARD-SHORTCUTS.md) — Keyboard shortcuts specification
- [TESTING.md](./TESTING.md) — Testing plan
- [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) — OP-Z inspired design principles

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
- [research/SESSION-NOTATION-RESEARCH.md](./research/SESSION-NOTATION-RESEARCH.md) — Notation philosophy and design principles
