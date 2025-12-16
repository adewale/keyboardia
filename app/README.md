# Keyboardia

A multiplayer step sequencer with polyrhythmic patterns, built for real-time collaboration.

## Features

- **Real-time Multiplayer** - Up to 10 players can jam together on the same session
- **Polyrhythmic Patterns** - Each track can have different step counts (4, 8, 12, 16, 24, 32, 64)
- **40+ Synth Presets** - Bass, lead, pad, pluck, keys, and genre-specific sounds
- **Sampled Instruments** - Grand piano with velocity sensitivity
- **Effects Chain** - Reverb, delay, chorus, and distortion with full multiplayer sync
- **Parameter Locks** - Per-step pitch and volume automation
- **Session Sharing** - Share links, remix others' work, publish immutable sessions
- **QR Code Sharing** - Mobile-friendly session sharing

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Audio**: Web Audio API, Tone.js
- **Backend**: Cloudflare Workers, Durable Objects, KV Storage
- **Real-time**: WebSockets with Hibernation API

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test:all

# Build for production
npm run build
```

## Development

### Debug Mode

Add `?debug=1` to the URL to enable debug features:
- Event tracing
- Audio state debugging
- Persistent log storage
- Bug pattern detection

See [docs/DEVELOPMENT-TOOLS.md](docs/DEVELOPMENT-TOOLS.md) for comprehensive debugging documentation.

### Project Structure

```
src/
├── audio/           # Audio engine, synths, effects, scheduling
├── components/      # React UI components
├── hooks/           # React hooks (useSession, useMultiplayer, etc.)
├── state/           # State management (grid reducer)
├── sync/            # Multiplayer synchronization
├── worker/          # Cloudflare Worker (Durable Objects, API routes)
├── utils/           # Logging, debugging, utilities
└── debug/           # Debug overlay and context
```

### Key Files

| File | Description |
|------|-------------|
| `audio/engine.ts` | Main audio engine - coordinates all audio subsystems |
| `audio/scheduler.ts` | Drift-free lookahead scheduling (25ms timer, 100ms lookahead) |
| `audio/synth.ts` | 16-voice polyphonic synthesizer with voice stealing |
| `audio/toneSynths.ts` | Tone.js synth manager (FM, AM, Membrane, etc.) |
| `audio/toneEffects.ts` | Effects chain (reverb, delay, chorus, distortion) |
| `sync/multiplayer.ts` | WebSocket client for real-time sync |
| `worker/live-session.ts` | Durable Object for session state |

### Testing

```bash
npm run test:unit          # Unit tests (vitest)
npm run test:integration   # Integration tests (Cloudflare Workers)
npm run test:all           # All tests
npm run analyze:bugs       # Static bug pattern analysis
```

## Architecture

### Audio Signal Chain

```
Source (Oscillator/Sample)
    → Track Gain (per-track volume)
    → Master Gain
    → Effects Chain (Tone.js: reverb → delay → chorus → distortion)
    → Limiter
    → Compressor
    → Destination
```

### Synth Engines

1. **SynthEngine** (`synth.ts`) - Native Web Audio oscillators, 40+ presets
2. **ToneSynthManager** (`toneSynths.ts`) - Tone.js FM/AM/Membrane synths
3. **AdvancedSynthEngine** (`advancedSynth.ts`) - Dual-oscillator with filter envelope and LFO
4. **SampledInstrument** (`sampled-instrument.ts`) - Sample-based playback (piano)

### Multiplayer Architecture

```
Client A ←→ Durable Object ←→ Client B
              ↓
           KV Storage (persistence)
```

- Each session is a single Durable Object instance
- WebSocket connections use Hibernation API for cost efficiency
- State changes broadcast to all connected clients
- 5-second debounced save to KV storage

## Documentation

- [ROADMAP.md](../specs/ROADMAP.md) - Implementation phases and status
- [SYNTHESIS-ENGINE.md](../specs/SYNTHESIS-ENGINE.md) - Audio architecture spec
- [SESSION-SHARING.md](../specs/SESSION-SHARING.md) - Session persistence spec
- [DEVELOPMENT-TOOLS.md](docs/DEVELOPMENT-TOOLS.md) - Debug tools reference
- [UI-PHILOSOPHY.md](../specs/UI-PHILOSOPHY.md) - Design principles

## License

Private - All rights reserved
