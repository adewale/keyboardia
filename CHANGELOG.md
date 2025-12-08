# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Sessions are now permanent by default (removed 30-day TTL)

### Planned
- Phase 5: Sharing UI polish (Invite/Send Copy/Remix buttons, lineage display)
- Phase 6: Cloudflare Durable Objects backend
- Phase 7: Multiplayer state sync via WebSockets
- Phase 8: Clock synchronization for audio sync

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
