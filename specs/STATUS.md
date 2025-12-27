# Keyboardia Implementation Status

> Last updated: 2025-12-27
> Current version: **0.2.0**

## Current Phase: Phase 28 — Keyboard Shortcuts

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
| 28 | Not Started | Keyboard Shortcuts |
| 29 | 🔄 In Progress | Homepage (Landing Page) |
| 30 | Not Started | Mobile UI Polish |
| 31 | Not Started | Performance & React Best Practices |
| 32 | Not Started | Authentication & Session Ownership |
| 33 | Not Started | Session Provenance |
| 34 | Not Started | Playwright E2E Testing |
| 35 | Not Started | Public API |
| 36 | Not Started | Beat-Quantized Changes |
| 37 | Not Started | Admin Dashboard & Operations |

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
- ✅ Metrics endpoint
  - `GET /api/metrics` — System metrics (session counts, request counts by type)
  - Tracks: total sessions, created/accessed today, last 5 minutes activity
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

## Phase 28: Additional Instruments & Polish

**Goal:** Expand instrument library, velocity sensitivity, FM synthesis UI

### Planned

- [ ] Additional sampled instruments (strings, brass, etc.)
- [ ] Full velocity sensitivity (127 levels)
- [ ] FM synthesis UI controls
- [ ] Sampled instrument preloading optimization
- [ ] Mobile UI polish refinements

---

## Future Work

See [ROADMAP.md](./ROADMAP.md) for planned implementation.

- **Phase 28:** Keyboard Shortcuts — Global hotkeys for efficient workflow
- **Phase 29:** Homepage — Landing page with examples and introduction
- **Phase 30:** Mobile UI Polish — Action sheets, loading states, touch
- **Phase 31:** Performance & React Best Practices — Optimization, code splitting
- **Phase 32:** Auth & Ownership — BetterAuth integration
- **Phase 33:** Session Provenance — Rich clipboard, family tree
- **Phase 34:** Playwright E2E Testing — Multi-client, cross-browser
- **Phase 35:** Public API — Authenticated API access for integrations
- **Phase 36:** Beat-Quantized Changes — Musical sync for remote edits

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
