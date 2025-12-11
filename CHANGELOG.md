# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Phase 16: Authentication & session ownership
- Phase 17: Advanced synthesis engine
- Future: Euclidean rhythms, per-track swing, conditional triggers

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

### Documentation
- WHY_CLOUDFLARE.md — architecture deep dive
- CLOUDFLARE-DURABLE-OBJECTS-REFERENCE.md — 150+ DO features
- PHASE-13B-LESSONS.md — patterns and anti-patterns
- REACT-BEST-PRACTICES.md — real-time collaboration patterns
- MOBILE-UI-PATTERNS.md — responsive design decisions

## [0.1.0] - 2025-12-06

### Added

#### Audio Engine
- Step sequencer with 16 tracks × 64 steps
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
- `MAX_STEPS = 64` (4 bars of 16th notes)
- `STEPS_PER_PAGE = 16` (1 bar)
- `MAX_TRACKS = 16`
- Global step counter (0-63) with per-track modulo for polyrhythms

---

## Version History

| Version | Date | Phase | Description |
|---------|------|-------|-------------|
| 0.2.0 | 2025-12-11 | 5-15 | Multiplayer, mobile portrait mode, observability, backend hardening |
| 0.1.0 | 2025-12-06 | 1-4A | Initial release with local audio, recording, persistence, polyrhythms |

[Unreleased]: https://github.com/adewale/keyboardia/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/adewale/keyboardia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adewale/keyboardia/releases/tag/v0.1.0
