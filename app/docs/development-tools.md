# Development Tools

This document describes the development tools added during Phase 21A to support audio asset management, local development, and instrument extensibility.

## Overview

| Tool | Type | Location | Purpose |
|------|------|----------|---------|
| Audio Impact Analyzer | CLI script | `scripts/audio-impact.sh` | Audio performance analysis |
| Mock API Plugin | Vite plugin | `vite.config.ts` | Backend-free local development |
| Instrument Manifest | JSON schema | `public/instruments/*/manifest.json` | Sampled instrument definition |

---

## 1. Audio Impact Analyzer

**Location:** `scripts/audio-impact.sh` (234 lines)

A comprehensive CLI tool for analyzing how audio assets affect page load performance.

### Usage

```bash
# Basic analysis
./scripts/audio-impact.sh

# Preview trimmed file sizes
./scripts/audio-impact.sh --trim-preview 5
```

### Features

- **Size Analysis**: Measures each sample's file size and duration
- **Load Time Projections**: Calculates load times across connection speeds:
  - 3G (750 Kbps)
  - 4G (10 Mbps)
  - WiFi (50 Mbps)
- **Waste Detection**: Identifies audio beyond the sequencer's playable range
- **Spec Compliance**: Checks against <2s load time target on 3G
- **Trim Preview**: Estimates savings from trimming samples to a specified duration
- **Bundle Comparison**: Shows ratio of audio assets to JS bundle size

### Sequencer Constraint Analysis

The tool calculates the maximum useful sample duration based on sequencer parameters:

```
Max step duration = (4 beats × 60) / MIN_TEMPO / MIN_STEPS
                  = (4 × 60) / 60 / 4
                  = 1 second

Max useful sample = Max step duration + Release time
                  = 1s + 0.5s
                  = 1.5 seconds
```

With a safety margin, the tool recommends **5 second samples**.

### Sample Output

```
═══════════════════════════════════════════════════════════════
           AUDIO ASSET IMPACT ANALYSIS
═══════════════════════════════════════════════════════════════

BEFORE → AFTER OPTIMIZATION
┌─────────────────────────┬──────────────┬──────────────┐
│ Metric                  │ Before       │ After        │
├─────────────────────────┼──────────────┼──────────────┤
│ Sample duration         │ 24-50s       │ 5s each      │
│ Total size              │ 3.4MB        │ ~480KB       │
│ Initial page impact     │ 37.5s (3G)   │ 0s (lazy)    │
│ First note playable     │ 37.5s (3G)   │ 1.3s (3G)    │
│ Spec compliance (<2s)   │ ✗ FAIL       │ ✓ PASS       │
└─────────────────────────┴──────────────┴──────────────┘
```

### Dependencies

- `ffprobe` (from FFmpeg) - for reading audio metadata
- `bc` - for floating-point arithmetic
- Standard Unix tools (`stat`, `basename`, etc.)

---

## 2. Mock API Plugin

**Location:** `vite.config.ts` (78 lines added)

A Vite development server plugin that provides mock backend endpoints, enabling frontend development without running a real backend server.

### Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/sessions/:id` | Retrieve session by ID |
| `PUT` | `/api/sessions/:id` | Update session (full replace) |
| `PATCH` | `/api/sessions/:id` | Update session (partial) |

### Session Schema

```typescript
interface MockSession {
  id: string;              // UUID v4
  state: unknown;          // Application state (sequencer, instruments, etc.)
  name: string | null;     // User-assigned name
  remixedFrom: string | null;      // Parent session ID if remixed
  remixedFromName: string | null;  // Parent session name
  remixCount: number;      // Number of times this session was remixed
  lastAccessedAt: number;  // Unix timestamp
}
```

### Implementation Details

- **Storage**: In-memory `Map<string, Session>` (non-persistent, resets on server restart)
- **ID Generation**: Uses Node.js `crypto.randomUUID()`
- **Request Parsing**: Manual body parsing via `req.on('data')`
- **Error Handling**: Returns 404 JSON response for missing sessions

### Example Usage

```typescript
// Create session
const response = await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tracks: [], tempo: 120 })
});
const session = await response.json();
// { id: "550e8400-e29b-41d4-a716-446655440000", state: {...}, ... }

// Update session
await fetch(`/api/sessions/${session.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My Beat' })
});
```

### Limitations

- Data is not persisted across server restarts
- No authentication or authorization
- No validation of state schema
- Single-user only (no concurrency handling)

---

## 3. Instrument Manifest Schema

**Location:** `public/instruments/<instrument>/manifest.json`

A declarative JSON format for defining sampled instruments. This schema enables adding new instruments by simply creating a folder with audio files and a manifest.

### Schema

```typescript
interface InstrumentManifest {
  id: string;           // Unique identifier (e.g., "piano")
  name: string;         // Display name (e.g., "Grand Piano")
  type: "sampled";      // Instrument type
  baseNote: number;     // MIDI note number for primary sample (usually 60/C4)
  releaseTime: number;  // Note release duration in seconds
  credits: {
    source: string;     // Attribution
    url: string;        // Source URL
    license: string;    // License terms
  };
  samples: Array<{
    note: number;       // MIDI note number
    file: string;       // Filename relative to manifest
  }>;
}
```

### Example: Piano Manifest

```json
{
  "id": "piano",
  "name": "Grand Piano",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.5,
  "credits": {
    "source": "University of Iowa Electronic Music Studios",
    "url": "https://theremin.music.uiowa.edu/MISpiano.html",
    "license": "Free for any projects, without restrictions"
  },
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

### How It's Used

The `SampledInstrument` class reads the manifest to:

1. **Determine loading order**: `baseNote` sample (C4) loads first for fast playback
2. **Map MIDI notes to samples**: Each note finds the nearest sample and calculates pitch shift
3. **Configure playback**: `releaseTime` controls note decay
4. **Display credits**: Attribution shown in UI

### Adding a New Instrument

To add a new sampled instrument (e.g., electric guitar):

```
public/instruments/guitar/
├── manifest.json
├── E2.mp3
├── A2.mp3
├── D3.mp3
├── G3.mp3
├── B3.mp3
└── E4.mp3
```

The `SampledInstrument` class will automatically handle:
- Progressive loading (baseNote first)
- Pitch shifting between samples
- Note-to-sample mapping

### Design Decisions

1. **One octave spacing**: Samples every 12 semitones balances quality vs. file size
2. **MP3 format**: Good compression, universal browser support
3. **5-second duration**: Covers maximum sequencer step + release time
4. **MIDI note numbers**: Standard, unambiguous note identification

---

## Future Tools

Potential additions for future phases:

1. **Sample Trimmer**: Automated batch trimming of samples to target duration
2. **Instrument Validator**: CLI tool to validate manifest.json and sample files
3. **Bundle Analyzer**: Integration with vite-bundle-analyzer for asset tracking
4. **E2E Audio Tests**: Playwright tests that verify actual audio output
