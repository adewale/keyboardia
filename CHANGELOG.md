# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Step counts 4 and 8** for pulse patterns and half-bar loops
  - 4-step: Four-on-the-floor kick, motorik beat, minimal techno pulse
  - 8-step: Half-bar phrases, Afrobeat percussion, call-response patterns
- **Solo button** per track with industry-standard behavior
  - Yellow (#f1c40f) active state
  - Solo wins over mute
  - Independent of mute state (preserved on un-solo)
- **Example sessions** demonstrating polyrhythms
  - Polyrhythm Demo: 4/8/16/32 step combinations
  - Afrobeat Groove: West African-inspired polyrhythmic percussion
- **Keyboard shortcuts spec** documenting Shift+Click semantics
- **Solo spec** documenting solo behavior and design decisions
- **Phase 7: Multiplayer Observability & Testing Infrastructure**
  - WebSocket lifecycle logging (connect, message, disconnect events)
  - Debug endpoints: `/api/debug/session/:id/connections`, `/clock`, `/state-sync`, `/ws-logs`
  - Debug endpoint: `/api/debug/durable-object/:id`
  - Client-side debug overlay with multiplayer, clock sync, and state hash sections
  - State hash-based consistency verification
  - Mock Durable Object for local development and testing
  - Multi-client development script (`npm run dev:multiplayer`)
  - 35 new tests for logging and mock DO (335 total tests)

### Changed
- Sessions are now permanent by default (removed 30-day TTL)
- Step count control changed from buttons `[16][32][64]` to dropdown
- Step count options expanded from `[16, 32, 64]` to `[4, 8, 16, 32, 64]`
- Mobile drawer now uses dropdown for step count

### Planned
- Phase 8: Cloudflare Durable Objects backend
- Phase 9: Multiplayer state sync via WebSockets
- Phase 10: Clock synchronization for audio sync
- Future: Euclidean rhythms, per-track swing, conditional triggers

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
| 0.1.0 | 2025-12-06 | 1-4A | Initial release with local audio, recording, persistence, polyrhythms |

[Unreleased]: https://github.com/user/keyboardia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/user/keyboardia/releases/tag/v0.1.0
