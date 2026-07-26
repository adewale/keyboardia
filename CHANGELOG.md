# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Phase 29: Keyboard Shortcuts (global hotkeys for efficient workflow)
- Phase 30: Mobile UI Polish (action sheets, loading states)
- Phase 31: Performance & React Best Practices
- Phase 32: Authentication & session ownership
- Future: Euclidean rhythms, per-track swing, conditional triggers

### Recently Added (since 0.2.0)

#### Stateless MCP: Session Lifecycle Tools & Endpoint Hardening (July 2026)

**Added (MCP tool surface, `/mcp`):** four session-lifecycle tools alongside the
existing `get_session` and `edit_session`. Each wraps the authoritative
Keyboardia operation rather than reimplementing it, and returns the canonical
`/s/{session_id}` URL.
- **`create_session`** — a new editable session with normal defaults. Requires a
  caller-generated UUID `idempotency_key`, recorded in KV for 24 hours, so a
  retried create resolves to the session the first attempt made instead of
  leaving duplicates behind. The key must be a UUID because it is a lookup into
  created sessions: a memorable key would collide across unrelated callers, and
  a session UUID is the only access control Keyboardia has.
- **`remix_session`** — wraps `remixSessionFromState()`. Reads the source from
  the Durable Object so pending edits are included, never modifies it, and
  records lineage. This is how an agent continues from published work.
- **`publish_session`** — wraps `publishSessionFromState()`. Returns the new
  immutable URL plus the still-editable `source_url`, purges both cached social
  previews, and rejects publishing an already-published session. Never an
  implicit side effect of editing or exporting.
- **`export_midi`** — runs the same `exportToMidi()` as the browser's Export
  MIDI button, so identical state produces identical bytes. Returns the file
  base64-encoded, reports skipped tracks with a reason, and lists what a
  Standard MIDI File cannot carry — per-track swing, track mix levels,
  microphone recordings, instruments with no GM mapping, effects, loop region —
  rather than approximating them silently.

**Fixed (rate limiting):**
- **The session-create limit had been stuck at a test value.**
  `RATE_LIMIT_MAX_REQUESTS` sat at 100 behind a "revert after testing" comment
  that was never acted on, so a temporary value was the production limit.
  Budgets now live in `RATE_LIMIT_DEFAULTS` (10 creates, 100 OG images per
  minute per IP), and a load test raises
  `SESSION_CREATE_RATE_LIMIT_PER_MINUTE` / `OG_IMAGE_RATE_LIMIT_PER_MINUTE` in
  `wrangler.jsonc` instead of editing the constant. Staging carries the raised
  create limit.
- **OG image traffic consumed a visitor's session-create budget.** Both
  endpoints shared one counter keyed only by IP. Buckets are now keyed per
  limit.
- `create_session` writes to the same KV namespace and daily quota as
  `POST /api/sessions`, so it is charged against the same per-IP budget — an
  unauthenticated endpoint must not be a way around it. A replay is free
  because it writes nothing.

**Added (endpoint hardening):**
- **Pre-parse guards on `/mcp`** (`worker/mcp-guard.ts`): non-POST is rejected
  with 405 and `Allow: POST`, an oversized `Content-Length` with 413, and a
  non-JSON content type with 415. The guard runs before the dynamic
  `import('./mcp')`, so a rejected request never evaluates the SDK, zod, or the
  schema validator, and never reaches a Durable Object or KV.
- **`npm run check:mcp-bot-protection`** probes a deployed origin under four
  user agents, including an AI-crawler signature, and fails if any is blocked,
  challenged, or answered by Cloudflare's bot layer instead of the Worker. Zone
  bot protection is dashboard state that can break `/mcp` with no code change.

**Fixed (Workers runtime):**
- **`import.meta.env.DEV` crashed every `/mcp` request.** Reusing the browser
  MIDI exporter brought `src/utils/logger.ts` into the Worker through
  instrument-ID parsing, and that Vite-only global does not exist in workerd, so
  the read threw during module evaluation. All 4,881 unit and 280 integration
  tests passed regardless — both layers transform through Vite, which defines
  it. Guarded, and `worker-runtime-safety.test.ts` now walks the Worker's
  import graph and fails on an unguarded read. See LESSONS-LEARNED Lesson 50.

**Changed (internal):**
- Rate limiting moved from `worker/index.ts` into `worker/rate-limit.ts`.
- `purgeOGCache()` moved into `worker/og-cache.ts`, re-exported from
  `og-image.tsx`. Invalidating a cache entry no longer drags in React, Satori,
  and a Yoga WASM binary.

#### Durable Object Hibernation Reload Fixes & Integration Test Upgrade (June 2026)

**Fixed (multiplayer durability):**
- **Edits silently dropped after hibernation.** A Durable Object woken purely by
  an incoming WebSocket *message* never re-ran the upgrade path that loads
  session state, so `state` was null and every mutating handler early-returned —
  the client's change was dropped with no ack (stuck "pending"). `webSocketMessage()`
  now lazily reloads state on a cold wake.
- **Stale KV mirror after a disconnect wake.** A WebSocket *close*/error event
  could wake a hibernated DO whose in-memory state was discarded; the final KV
  flush then skipped (null state), stranding the legacy KV mirror at a
  pre-hibernation value. `flushPendingKVSave()` now reloads state first, and a
  close/error with no live connections still flushes when it is the last
  disconnect.
- The constructor now restores `sessionId` from DO storage so a message-wake has
  an id to load by.

**Changed (integration test harness):**
- Upgraded `@cloudflare/vitest-pool-workers` 0.10.14 → 0.16.20 and vitest 3 → 4.
- Migrated `defineWorkersProject()` to the `cloudflareTest()` vitest-4 plugin form.
- Pinned `automation-events` (transitive via `tone`) to its native-class ES2019
  ESM build; the Workers test runtime resolved the package's `browser` condition,
  loading an ES5 UMD bundle that crashed with `_createClass is not a function`.

**Added (tests):**
- `test/integration/eviction-recovery.test.ts` — drives real eviction/hibernation
  via the new `evictDurableObject` / `evictAllDurableObjects` helpers over genuine
  WebSocket I/O (message-wake, close-wake, multi-client, in-flight draining,
  published-session immutability across eviction).
- `test/integration/state-machine-fuzz.test.ts` — randomized DO ↔ WebSocket ↔ KV
  state-machine fuzzing across eviction cycles.

#### Sample Library Rebuilds & Audio QA Tooling (June 2026)
Tier-4 rebuilds from the June audit, all from license-verified CC0/PD sources:
- **Marimba**: 10 notes F2–C7 × 3 velocity layers from VCSL (was 5
  single-layer notes with a 17-semitone gap)
- **Vibraphone**: 11 notes F3–E6 × 2 hard-mallet layers, max gap 4 (was 4
  ff-only notes at 12-semitone gaps)
- **Kalimba**: 10 mbira keys (VCSL Kalimba-Kenya) f0-measured and retuned to
  equal temperament within ±0.6 cents — the source instrument is tuned up to
  45 cents off ET with doubled unison courses
- **Steel drums**: jSteelDrum2 (Unlicense), 8 notes at uniform 3-semitone
  gaps × 3 honest layers — replaces the scrambled name→velocity workaround
- **Piano**: Iowa pp/mf/ff on every note (C notes were single-layer); up to
  922ms of recorded lead silence trimmed; 30s decays capped — 5.6MB → 2.3MB
- **Acoustic kit**: Virtuosity mid-mic velocity layers — kick/snare/hats ×4,
  ride/crash ×3; hi-hats are now stick hits (previously Iowa foot-pedal
  articulations); choke groups preserved
- **Hammond**: top octave added (E5/G#5/C6) and all 13 notes loop seamlessly
  via baked 200ms equal-power crossfades (wrap residual ≤3.6%, was 60–120%)
- **Licensing**: jRhodes3d turns out to be **CC BY-NC for redistribution**
  (its CC0 grant covers only "musicians making music") — a CC0 FreePats FM
  replacement was built, then reverted pending a licensing decision; the
  shipped set remains the octave-corrected jRhodes samples
- **Defect sweep & fixes**: finger-bass files decoding at +3.8dB over full
  scale, the acoustic-guitar set +1.2dB over, DC offset on sax and piano-pp
  files, MP3-overshoot clipping on bright ff layers — all fixed; library now
  decodes clip-free
- **New audio QA tools** (`scripts/`): `validate-audio-defects.py` (decoded
  clipping, flat-tops, DC, leading silence, loop-seam clicks, range
  overextension) and `compare-sample-quality.py` (A/B two git trees on
  perceptually-grounded metrics: pitch-shift distance, onset lead, note
  evenness, velocity→timbre, tuning, truncation)

#### Sample Tuning & Licensing Fixes (June 2026)
An acoustic audit (decoding every sample and measuring its sounding pitch)
found several instruments mapped to the wrong octave because sample-library
file-name conventions were taken at face value:
- **Fixed octave errors**: french horn, alto sax, marimba, kalimba (+12),
  clean guitar (−12), and rhodes-ep (whose "C" files actually contain
  E2/D3/D4/F4 — the January remap had detuned it)
- **String section rebuilt**: 15 samples (cello low end + viola mid/high),
  max gap 5 semitones, all leveled to a consistent −20dB RMS (adjacent
  samples previously ranged from −13 to −40dB)
- **Gap fills**: french horn +5 samples (17-semitone gap → ≤7), alto sax
  +2 (12 → ≤6), rhodes +4 (max gap 5) — all from the already-cleared
  CC0 sources
- **808 kit relicensed**: swapped to `tidalcycles/sounds-tr808-fischer`
  (explicit CC0) — same Fischer recordings (waveforms cross-correlate
  0.95–1.00), the old source repo has no license at all
- **New validator**: `npm run validate:acoustic-pitch` (requires ffmpeg)
  pins all 81 pitched samples to their manifest notes

#### Sample Pipeline Fixes (June 2026)
Fixes from the June 2026 sample & audio pipeline audit
(`specs/research/SAMPLE-AUDIT-2026-06.md`), built on the AudioWorklet engine:
- **Sampled instruments now start at their scheduled time** — they previously
  played the moment the lookahead loop dispatched them (up to 100ms early,
  with jitter), and swing silently did nothing for sampled tracks
- **Velocity layers are reachable** — the volume p-lock (Velocity Lane) now
  derives a MIDI velocity that selects pp/mf/ff samples; previously the
  velocity was hardcoded and ~3MB of velocity-layer samples could never play
- **Hi-hat choke groups** — closed hat hits silence ringing open hats
  (808 and acoustic kits), like the physical cymbals
- **Sustain loops** — Hammond organ notes no longer go silent after ~4s
- **Declick attack ramp** (3ms) on sampled notes; release envelope anchored
  to the scheduled start; audio-sprite offsets honoured again
- **Downshift-preferring pitch selection** — equidistant sample choices now
  shift down (less audible artifacts) instead of map-iteration-order luck
- **Manifest `gainDb` loudness trim** — match instrument levels without
  re-encoding sample files (re-normalizing destroyed velocity dynamics once)
- **LICENSE.md generated from manifests** (`npm run generate:license`) with a
  doc-sync test; fixed acoustic-guitar crediting a non-existent repository
- **New tests:** behavioural playback suite on fake Web Audio nodes,
  property-based tests for velocity mapping / sample selection / loop
  validation / note scheduling / choke groups, scheduler⇄worklet velocity
  parity tests, engine pass-through seam tests

#### Phase 28: Homepage / Landing Page (December 2025) — In Progress
- **Landing page component** with animated step grid demo
- **10 curated example sessions** from real published sessions
- **Carousel navigation** with CSS Grid layout for proper button positioning
- **Mobile responsive design** with fixed-width cards (340px desktop, 260px mobile)
- **Real session links** — clicking examples navigates to `/s/{uuid}`
- **Files:** `LandingPage.tsx`, `LandingPage.css`, `example-sessions.ts`

#### Phases 24-27 Complete (December 2025)
- **Phase 24: Unified Audio Bus** — TrackBusManager for consistent routing
- **Phase 25: Hidden Feature UI Exposure** — Playback mode, XY Pad, FM controls
- **Phase 26: Mutation Tracking** — Full delivery confirmation for multiplayer
- **Phase 27: MIDI Export** — SMF Type 1 format for DAW integration

#### Infrastructure: Centralized Retry Utilities (December 2025)
- **Centralized retry logic** (`src/utils/retry.ts`) with proper exponential backoff + jitter
  - Formula: `min(baseDelay * 2^attempt, maxDelay) ± jitter`
  - Prevents "thundering herd" when services recover
  - Configurable: baseDelayMs, maxDelayMs, jitterFactor, maxAttempts
- **E2E test utilities** (`e2e/test-utils.ts`) with shared helpers
  - `createSessionWithRetry()` - handles DO cold starts and rate limiting
  - `getSessionWithRetry()` - handles KV eventual consistency
  - Typed `SessionResponse` interface documents correct API structure
- **Fixed E2E test failures**: API returns `{ state: { tracks } }` not `{ tracks }`
- **Updated `multiplayer.ts`** to use centralized retry utilities
- **Comprehensive tests**: 13 unit tests in `src/utils/retry.test.ts`
- **Documentation**: Added Lessons 15 & 16 to LESSONS-LEARNED.md
  - Lesson 15: E2E Tests Must Use Correct API Response Structure
  - Lesson 16: CI Tests Need Retry Logic for API Resilience

#### Phase 23: Percussion Expansion (December 2025)
- **6 new procedural percussion samples**: shaker, conga, tambourine, clave, cabasa, woodblock
- All synthesized procedurally (zero external files, no bundle size increase)
- ADSR envelopes calibrated for 120 BPM compatibility (attack < 10ms)
- Registered in SamplePicker under Drums category with mobile-friendly abbreviated names
- Fixed demo sessions: `synth:piano` → `sampled:piano` typos corrected
- Added comprehensive test coverage (`percussion.test.ts`)

#### Previous additions
- Extended MAX_STEPS from 64 to 128 (8 bars at 16th note resolution)
- Added step count options: 96, 128 for full verse/chorus sections
- 6 new demo sessions showcasing all instrument categories
- LRU sample cache with reference counting for memory management
- Effects master bypass and XY pad controls

## [0.2.0] - 2025-12-11

### Added

#### Multiplayer (Phases 8-12)
- **Real-time collaboration** via Cloudflare Durable Objects
- **WebSocket state sync** — changes broadcast to all connected players instantly
- **Clock synchronization** — synced playback across all participants
- **Player presence** — anonymous identities (color + animal), avatar stack UI
- **Cursor tracking** — see where others are pointing (desktop only)
- **Change attribution** — step toggles flash with editor's color
- **Connection status** — visual indicator (connected/connecting/disconnected/single_player)
- **Graceful degradation** — falls back to single-player after connection failures
- **Offline queue** — buffers changes during disconnect, replays on reconnect

#### Mobile (Phase 15)
- **Portrait read-mostly layout** — optimized for viewing shared sessions
  - Track header with name, synth indicator (♪), and M/S badges
  - Full-width step grid (swipeable)
  - Expandable "tap to edit" panel with M/S, Transpose, Steps, Copy/Clear/Delete
- **48x48px step cells** in portrait for easier tapping
- **Scroll snap alignment** for clean stopping points
- **OrientationHint** component suggesting landscape for more steps
- **Hidden cursor arrows** on mobile (misleading between form factors)

#### Observability (Phases 6-7)
- Structured request/response logging
- WebSocket lifecycle logging
- Debug endpoints for session state, connections, clock, state-sync
- Client-side debug overlay (`?debug=1`)
- State hash verification (30s periodic checks)

#### Backend Hardening (Phases 13-14)
- Worker-level validation before routing to DO
- UUID format, body size, and state validation
- Session name XSS prevention
- DO stub recreation on retryable errors
- HTTP retry with exponential backoff + jitter
- Request timeouts via AbortController
- Integration tests with vitest-pool-workers

#### Infrastructure
- **19 synth presets** across 4 categories (Core, Keys, Genre, Ambient)
- **Session naming** — inline editable, persisted, updates browser tab
- **Dev-only logger** — production console output suppressed
- **iOS audio fixes** — AudioContext resume on touch events

### Changed
- Sessions are now permanent by default (removed 30-day TTL)
- Step count control changed from buttons to dropdown
- Step count options expanded from `[16, 32, 64]` to `[4, 8, 16, 32, 64]`
- Debounce intervals increased from 2s to 5s (KV write reduction)

### Fixed
- CSS cascade bug hiding track actions on mobile
- InlineDrawer click-outside handler (collapse button works)
- Audio volume reset timer cleanup on stop
- Memory leaks in RemoteChangeContext and scheduler
- Race conditions in session loading and multiplayer initialization
- Scheduler timing drift (multiplicative timing)
- Mic stream cleanup on recording completion
- **iOS clipboard compatibility** — Share/Send Copy buttons now work on iOS Safari/Chrome
  - Uses ClipboardItem API with Promise content to preserve user gesture
  - Falls back to execCommand for older browsers
  - Shows tappable URL toast when clipboard fails

### Documentation
- WHY_CLOUDFLARE.md — architecture deep dive
- CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md — 150+ DO features
- PHASE-13B-LESSONS.md — patterns and anti-patterns
- REACT-BEST-PRACTICES.md — real-time collaboration patterns
- MOBILE-UI-PATTERNS.md — responsive design decisions
- IOS-CHROME-COMPATIBILITY.md — browser API compatibility research
- COST-ANALYSIS.md — Cloudflare cost analysis with projections

## [0.1.0] - 2025-12-06

### Added

#### Audio Engine
- Step sequencer with 16 tracks × 128 steps
- 16 synthesized samples (drums, bass, synth, FX)
- 5 real-time synth presets (bass, lead, pad, pluck, acid)
- Lookahead scheduling (25ms timer, 100ms ahead)
- Swing/shuffle timing (0-100%)
- Per-track transpose (-12 to +12 semitones)

#### Sequencer Features
- Per-track step count (16/32/64) for polyrhythms
- Parameter locks (pitch, volume per step)
- Copy/paste patterns between tracks
- Mute, clear, delete track controls
- Playback mode: oneshot (default) and gate

#### Recording
- Mic recording with hold-to-record
- Waveform visualization during recording
- Auto-slice with transient detection
- Preview before adding to grid
- Recorded samples become new tracks

#### Session Persistence
- KV storage (permanent sessions)
- Shareable URLs (`/s/{uuid}`)
- Remix sessions to create editable copies
- Auto-save with 2-second debounce
- Backwards compatibility for old session formats

#### UI/UX
- Dark mode interface (#121212 background)
- Single scrollbar for tracks panel
- Fixed-width controls prevent layout shift
- Visual playhead indicator
- Beat boundary markers every 4 steps
- Page separators every 16 steps
- Parameter lock badges (pitch/volume indicators)

#### Testing
- 44 unit tests (Vitest) for scheduler and state
- 6 e2e tests (Playwright) for playback and UI
- Polyrhythmic behavior verification
- 64-step pattern verification

#### Infrastructure
- Vite + React + TypeScript frontend
- Cloudflare Workers deployment
- KV namespace for session storage
- SPA routing support

### Technical Details
- `MAX_STEPS = 128` (8 bars of 16th notes)
- `STEPS_PER_PAGE = 16` (1 bar)
- `MAX_TRACKS = 16`
- Global step counter (0-127) with per-track modulo for polyrhythms

---

## Version History

| Version | Date | Phase | Description |
|---------|------|-------|-------------|
| 0.2.0 | 2025-12-11 | 5-15 | Multiplayer, mobile portrait mode, observability, backend hardening |
| 0.1.0 | 2025-12-06 | 1-4A | Initial release with local audio, recording, persistence, polyrhythms |

[Unreleased]: https://github.com/adewale/keyboardia/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/adewale/keyboardia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adewale/keyboardia/releases/tag/v0.1.0
