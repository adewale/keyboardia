# Keyboardia

A multiplayer step sequencer with polyrhythmic patterns, built for real-time collaboration.

## Features

- **Real-time Multiplayer** - Up to 10 players can jam together on the same session
- **Polyrhythmic Patterns** - Each track can have 3-128 step counts (26 options including triplet-friendly values)
- **70 Sound Generators** - 32 Web Audio synths, 11 Tone.js FM/AM synths, 27 sampled instruments
- **27 Sampled Instruments** - Grand piano, 808 kit, acoustic drums, Hammond organ, kalimba, steel drums, strings, guitars, sax, and more
- **Effects Chain** - Reverb, delay, chorus, and distortion with limiter (full multiplayer sync)
- **Parameter Locks** - Per-step pitch, volume, and tied notes automation
- **Chromatic Grid** - Two view modes: "Events" (key intervals + used pitches) and "All" (49 pitches from -24 to +24)
- **Scale Lock** - Constrain chromatic grid to selected musical scale with out-of-scale warnings
- **Scale Sidebar** - Visualize scale notes with root/fifth emphasis and active usage highlighting
- **Per-track Swing** - Global and per-track swing settings for groove control
- **Session Sharing** - Share links, remix others' work, publish immutable sessions
- **QR Code Sharing** - Mobile-friendly session sharing
- **Agent Rhythm Editing (Experimental)** - Co-edit, create, remix, publish, export, and analyze sessions through stateless MCP

## Use with an agent

Configure your MCP client with:

```text
https://keyboardia.dev/mcp
```

To co-edit music you already have, open a session and give the agent the UUID
from its `https://keyboardia.dev/s/{session_id}` URL. Agents can read the
current rhythm, add a track, assign specific steps, and change tempo. Their
edits use the same live session as connected browsers, and published sessions
stay read-only.

Agents can also start from nothing: create a new session and hand back its link,
remix a published session into an editable copy without touching the original,
publish the current result as an immutable snapshot when you ask, and export the
session as a MIDI file for a DAW.

They can explain music too — ask what key a session is in, how its rhythms sit
against each other, or what chord a moment forms, and the answer comes from the
same music-theory module the Key Assistant uses, with its uncertainty stated
rather than hidden.

See the [stateless MCP rhythm-slice specification](specs/STATELESS-MCP.md) for
the exact tool contract and current limitations. Directory maintainers can use
the canonical [MCP listing record](docs/MCP-DIRECTORY-LISTINGS.md), and hosted
data handling is described in the [MCP privacy notice](docs/MCP-PRIVACY.md).

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Audio**: Web Audio API, Tone.js
- **Backend**: Cloudflare Workers, Durable Objects, KV Storage
- **Real-time**: WebSockets with Hibernation API

## Getting Started

```bash
cd app

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
app/
├── src/
│   ├── audio/           # Audio engine, synths, effects, scheduling
│   ├── components/      # React UI components
│   ├── hooks/           # React hooks (useSession, useMultiplayer, etc.)
│   ├── state/           # State management (grid reducer)
│   ├── sync/            # Multiplayer synchronization
│   ├── worker/          # Cloudflare Worker (Durable Objects, API routes)
│   ├── utils/           # Logging, debugging, utilities
│   └── debug/           # Debug overlay and context
├── e2e/                 # End-to-end tests (Playwright)
├── test/                # Integration tests
└── scripts/             # Development and debugging scripts
```

### Key Files

| File | Description |
|------|-------------|
| `app/src/audio/engine.ts` | Main audio engine - coordinates all audio subsystems |
| `app/src/audio/scheduler.ts` | Drift-free lookahead scheduling (25ms timer, 100ms lookahead) |
| `app/src/audio/synth.ts` | 16-voice polyphonic synthesizer with voice stealing |
| `app/src/audio/toneSynths.ts` | Tone.js synth manager (FM, AM, Membrane, etc.) |
| `app/src/audio/toneEffects.ts` | Effects chain (reverb, delay, chorus, distortion) |
| `app/src/sync/multiplayer.ts` | WebSocket client for real-time sync |
| `app/src/worker/live-session.ts` | Durable Object for session state |

### Testing

```bash
cd app
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
        DO Storage (immediate)
              ↓
        KV Storage (on disconnect)
```

- Each session is a single Durable Object instance
- WebSocket connections use Hibernation API for cost efficiency
- State changes broadcast to all connected clients
- **Hybrid persistence:** Mutations saved immediately to DO storage, KV updated on disconnect

## Documentation

- [ROADMAP.md](specs/ROADMAP.md) - Implementation phases and status
- [SYNTHESIS-ENGINE.md](specs/SYNTHESIS-ENGINE.md) - Audio architecture spec
- [SHARING-AND-PUBLISHING.md](specs/SHARING-AND-PUBLISHING.md) - Session persistence spec
- [DEVELOPMENT-TOOLS.md](docs/DEVELOPMENT-TOOLS.md) - Debug tools reference
- [UI-PHILOSOPHY.md](specs/UI-PHILOSOPHY.md) - Design principles
- [LESSONS-LEARNED.md](docs/LESSONS-LEARNED.md) - Debugging war stories

## License

[MIT](LICENSE)

Bundled instrument samples are third-party content with their own licenses
(CC0, public domain, and similar free-use terms), documented in
[app/public/instruments/LICENSE.md](app/public/instruments/LICENSE.md).
