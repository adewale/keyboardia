# Audio Content & Extension Tools

This document covers all tools for creating, processing, and enhancing audio content in Keyboardia. Use these tools to add new instruments, validate audio quality, process samples, and extend the sound library.

## Quick Start

```bash
# Analyze audio sample load impact
./scripts/audio-impact.sh

# Validate a session file
npx tsx scripts/session-api.ts validate my-session.json

# Run volume verification tests
npm run test:unit -- volume-verification
```

---

## Table of Contents

1. [Adding New Instruments](#adding-new-instruments)
2. [Sample Processing Pipeline](#sample-processing-pipeline)
3. [Audio Quality Validation](#audio-quality-validation)
4. [Synthesis Tools](#synthesis-tools)
5. [Recording & Slicing](#recording--slicing)
6. [Effects System](#effects-system)
7. [Audio Loading System](#audio-loading-system)
8. [Quick Reference](#quick-reference)

---

## Adding New Instruments

### Sampled Instruments (e.g., Piano, Strings)

Sampled instruments use real audio recordings pitch-shifted to cover the full note range.

#### Step 1: Prepare Audio Files

**Source Recommendations:**
- University of Iowa Electronic Music Studios (free license)
- Philharmonia Orchestra samples
- Your own recordings

**Licensing:**
When adding new instruments, document the license in `public/instruments/LICENSE.md`. The University of Iowa samples are free for any projects without restrictions. See the existing LICENSE.md for format.

**File Requirements:**
- Format: MP3 or WAV
- Sample Rate: 44.1kHz or 48kHz
- One sample per octave (C2, C3, C4, C5) is sufficient
- Recommended duration: 5 seconds max (see [Audio Impact Analysis](#audio-impact-analysis))

**Processing from University of Iowa:**
```bash
# Example: Convert AIFF to MP3, trim to 5 seconds
ffmpeg -i "Piano.ff.C4.aiff" -t 5 -codec:a libmp3lame -qscale:a 2 C4.mp3
```

#### Step 2: Create Instrument Directory

```
public/instruments/
└── my-instrument/
    ├── manifest.json
    ├── C2.mp3
    ├── C3.mp3
    ├── C4.mp3
    └── C5.mp3
```

#### Step 3: Create Manifest File

**Location:** `public/instruments/{id}/manifest.json`

```json
{
  "id": "my-instrument",
  "name": "My Instrument",
  "type": "sampled",
  "baseNote": 60,
  "releaseTime": 0.5,
  "credits": {
    "source": "University of Iowa Electronic Music Studios",
    "url": "https://theremin.music.uiowa.edu/",
    "license": "Free for any projects"
  },
  "samples": [
    { "note": 36, "file": "C2.mp3" },
    { "note": 48, "file": "C3.mp3" },
    { "note": 60, "file": "C4.mp3" },
    { "note": 72, "file": "C5.mp3" }
  ]
}
```

**Manifest Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (lowercase, hyphens) |
| `name` | string | Display name |
| `type` | string | Always "sampled" for sample-based |
| `baseNote` | number | MIDI note for default pitch (60 = C4) |
| `releaseTime` | number | Fade-out time in seconds |
| `credits` | object | Attribution information |
| `samples` | array | Sample definitions |

**Sample Definition:**

| Field | Type | Description |
|-------|------|-------------|
| `note` | number | MIDI note number (36=C2, 48=C3, 60=C4, 72=C5) |
| `file` | string | Filename relative to instrument directory |

#### Step 4: Register the Instrument

**File:** `src/audio/sampled-instrument.ts`

```typescript
export const SAMPLED_INSTRUMENTS = [
  'piano',
  'my-instrument',  // Add your instrument here
] as const;
```

#### Step 5: Test the Instrument

```bash
# Run integration tests
npm run test:unit -- sampled-instrument

# Start dev server and test manually
npm run dev
# Navigate to your instrument in the UI
```

---

### Audio Sprite Format (Alternative)

For faster loading, combine all samples into a single file with offset markers:

```json
{
  "id": "piano-sprite",
  "name": "Piano (Sprite)",
  "type": "sampled",
  "samples": [
    { "note": 36, "file": "piano-sprite.mp3", "offset": 0, "duration": 5 },
    { "note": 48, "file": "piano-sprite.mp3", "offset": 5, "duration": 5 },
    { "note": 60, "file": "piano-sprite.mp3", "offset": 10, "duration": 5 },
    { "note": 72, "file": "piano-sprite.mp3", "offset": 15, "duration": 5 }
  ]
}
```

---

## Sample Processing Pipeline

### Audio Impact Analysis Tool

**Location:** `scripts/audio-impact.sh`

Analyzes how audio samples affect page load time and identifies optimization opportunities.

```bash
# Run analysis
./scripts/audio-impact.sh

# Preview with specific trim duration
./scripts/audio-impact.sh --trim-preview 5
```

**Output Includes:**
- Current file sizes and durations
- Useful vs. wasted audio percentages
- Load times by connection type (3G, 4G, WiFi)
- Optimization recommendations

**Example Output:**
```
=== Piano Sample Analysis ===

Sample    Duration   Size      Useful    Wasted
C2.mp3    8.2s       245KB     61%       39%
C3.mp3    7.8s       232KB     64%       36%
C4.mp3    6.5s       198KB     77%       23%
C5.mp3    5.1s       156KB     98%       2%

TOTAL: 831KB, recommended: 520KB (37% reduction)

Load Times:
  3G (750 Kbps):  8.9s → 5.5s
  4G (10 Mbps):   0.7s → 0.4s
  WiFi (50 Mbps): 0.1s → 0.1s
```

**Dependencies:**
- `ffprobe` (from FFmpeg)
- `bc` (calculator)

**Install FFmpeg:**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

---

### Sample Optimization Guidelines

Based on sequencer constraints:

| Parameter | Value | Reasoning |
|-----------|-------|-----------|
| Max Duration | 5 seconds | At 60 BPM, longest note = 4s + 0.5s release |
| Min Duration | 0.5 seconds | Shortest useful drum hit |
| Sample Rate | 44.1kHz | CD quality, no benefit from higher |
| Bit Rate | 128-192 kbps | Good quality/size balance |
| Format | MP3 | Best compression, universal support |

**Trimming Samples:**
```bash
# Trim to 5 seconds with fade-out
ffmpeg -i input.wav -t 5 -af "afade=t=out:st=4.5:d=0.5" output.mp3
```

---

## Audio Quality Validation

### Volume Verification System

**Location:** `src/audio/volume-verification.test.ts`

Comprehensive test suite ensuring all sounds are audible at appropriate levels.

```bash
# Run all volume tests
npm run test:unit -- volume-verification

# Run specific category
npm run test:unit -- volume-verification -t "drums"
```

**What It Validates:**

| Sound Type | Peak Volume | Attack Time | Sustain Level |
|------------|-------------|-------------|---------------|
| Drums | 0.85 | < 50ms | 0.85-1.0 |
| Bass | 0.85 | < 100ms | 0.75-0.9 |
| Synths | 0.85 | < 100ms | 0.65-0.85 |
| Pads | 0.85 | < 500ms | 0.5-0.7 |
| FX | 0.85 | < 50ms | varies |

**Coverage:**
- 32 Web Audio synth presets
- 11 Tone.js synth presets
- 8 Advanced synth presets
- 16 procedurally generated samples
- All sampled instruments

---

### Adding Volume Tests for New Sounds

```typescript
// In volume-verification.test.ts

describe('My New Instrument', () => {
  it('should produce audible output', async () => {
    const buffer = await generateSampleBuffer('my-instrument');
    const peak = findPeakAmplitude(buffer);
    
    expect(peak).toBeGreaterThan(0.65);
    expect(peak).toBeLessThan(0.95);
  });
  
  it('should have appropriate attack time', async () => {
    const buffer = await generateSampleBuffer('my-instrument');
    const attackTime = measureAttackTime(buffer, 0.85);
    
    expect(attackTime).toBeLessThan(0.1); // 100ms max
  });
});
```

---

## Synthesis Tools

### Creating Synth Presets (Web Audio)

**Location:** `src/audio/synth.ts`

The Web Audio synth engine supports 32 presets using subtractive synthesis.

**Preset Structure:**
```typescript
interface SynthParams {
  waveform: 'sine' | 'square' | 'sawtooth' | 'triangle';
  filter: {
    frequency: number;  // Hz, 20-20000
    Q: number;          // Resonance, 0-20
  };
  envelope: {
    attack: number;     // Seconds
    decay: number;      // Seconds
    sustain: number;    // 0-1
    release: number;    // Seconds
  };
  lfo?: {
    frequency: number;  // Hz
    amount: number;     // Modulation depth
  };
}
```

**Adding a New Preset:**

```typescript
// In src/audio/synth.ts

export const SYNTH_PRESETS: Record<string, SynthParams> = {
  // ... existing presets ...
  
  'my-synth': {
    waveform: 'sawtooth',
    filter: {
      frequency: 2000,
      Q: 3
    },
    envelope: {
      attack: 0.01,
      decay: 0.2,
      sustain: 0.7,
      release: 0.5
    },
    lfo: {
      frequency: 5,
      amount: 0
    }
  }
};
```

**Preset Categories:**

| Category | Characteristics | Examples |
|----------|----------------|----------|
| Bass | Low filter, short decay | bass, funkbass, sub |
| Lead | Mid-high filter, sustain | lead, acid, brass |
| Pad | Slow attack, long release | pad, strings, warmpad |
| Pluck | Fast attack, short decay | pluck, bell, vibes |
| Keys | Piano-like envelope | rhodes, organ, epiano |

---

### Procedurally Generated Samples

**Location:** `src/audio/samples.ts`

These 16 sounds are generated mathematically - no audio files needed.

**Current Sounds:**

**Drums:**
```typescript
kick:    // Frequency sweep 150Hz→40Hz, 0.5s
snare:   // Noise + tone mix, 0.3s
hihat:   // High-frequency noise, 0.1s
clap:    // Multiple noise bursts, 0.3s
tom:     // Frequency sweep 200Hz→80Hz, 0.4s
rim:     // High click 1200Hz/800Hz, 0.1s
cowbell: // Inharmonic 562Hz/845Hz, 0.3s
openhat: // Noise + metallic, 0.4s
```

**Bass:**
```typescript
bass:    // Sawtooth + harmonics, 0.5s
subbass: // Pure sine, 0.6s
```

**Synths:**
```typescript
lead:    // Square-ish wave, 0.6s
pluck:   // Harmonic decay, 0.4s
chord:   // A3/C4/E4 minor, 0.8s
pad:     // Detuned oscillators, 1.5s
```

**FX:**
```typescript
zap:     // Rapid frequency sweep, 0.2s
noise:   // White noise hit, 0.3s
```

**Adding New Procedural Sounds:**

```typescript
// In src/audio/samples.ts

function generateMySound(sampleRate: number): Float32Array {
  const duration = 0.5;
  const samples = new Float32Array(sampleRate * duration);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 4); // Exponential decay
    const frequency = 440; // A4
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * envelope;
  }
  
  return samples;
}

// Add to PROCEDURAL_SAMPLES map
export const PROCEDURAL_SAMPLES = {
  // ... existing ...
  'my-sound': generateMySound,
};
```

---

### Tone.js Advanced Synthesis

**Location:** `src/audio/toneSynths.ts`, `src/audio/advancedSynth.ts`

Tone.js provides more complex synthesis (FM, AM, physical modeling).

**Tone.js Presets:**
- FM: `fm-epiano`, `fm-bass`, `fm-bell`
- AM: `am-bell`, `am-tremolo`
- Physical: `membrane-kick`, `membrane-tom`, `metal-cymbal`, `metal-hihat`
- Other: `pluck-string`, `duo-lead`

**Advanced Synth Presets:**
- `supersaw` - Detuned sawtooth layers
- `sub-bass` - Sine + octave square
- `wobble-bass` - LFO filter modulation
- `warm-pad` - Slow evolving texture
- `acid-bass` - TB-303 style

**Note:** Tone.js adds ~200KB to bundle and is lazy-loaded on first use.

---

## Recording & Slicing

### Recording User Audio

**Location:** `src/audio/recorder.ts`

```typescript
import { recorder } from './audio/recorder';

// Request microphone permission
await recorder.requestMicAccess();

// Start recording
recorder.startRecording();

// Stop and get audio blob
const blob = await recorder.stopRecording();

// Convert to AudioBuffer for processing
const arrayBuffer = await recorder.blobToArrayBuffer(blob);
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

// Release microphone
recorder.releaseMicAccess();
```

---

### Auto-Slicing Recordings

**Location:** `src/audio/slicer.ts`

Automatically divides recordings into playable slices.

**Slicing Methods:**

```typescript
import { detectTransients, sliceEqual, extractSlice } from './audio/slicer';

// Method 1: Transient detection (drums, speech)
const onsets = detectTransients(audioBuffer, 0.5, 0.05);
// Returns array of onset times in seconds

// Method 2: Equal division
const slices = sliceEqual(audioBuffer, 16);
// Returns 16 equal-length slices

// Extract individual slice
const slice = extractSlice(audioContext, audioBuffer, { start: 0.5, end: 1.0 });
```

**Transient Detection Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| sensitivity | number | 0.5 | Threshold (0-1), lower = more sensitive |
| minGapSeconds | number | 0.05 | Minimum time between onsets |

**Algorithm Details:**
- Window size: 10ms
- Hop size: 5ms (50% overlap)
- RMS energy-based detection
- Maximum 16 slices

---

## Effects System

**Location:** `src/audio/toneEffects.ts`

Four-stage effects processor.

**Signal Flow:**
```
Input → Distortion → Chorus → Delay → Reverb → Output
```

**Effect Parameters:**

| Effect | Parameters | Range |
|--------|------------|-------|
| Reverb | decay, wet | 0.1-10s, 0-1 |
| Delay | time, feedback, wet | 8n-4m, 0-0.95, 0-1 |
| Chorus | frequency, depth, wet | 0.1-10Hz, 0-1, 0-1 |
| Distortion | amount, wet | 0-1, 0-1 |

**Usage:**
```typescript
import { ToneEffectsChain } from './audio/toneEffects';

const effects = new ToneEffectsChain();
await effects.initialize();

// Apply reverb
effects.setReverb({ decay: 2.5, wet: 0.3 });

// Apply delay
effects.setDelay({ time: '8n', feedback: 0.4, wet: 0.2 });
```

---

## Audio Loading System

### Lazy Loading Strategy

**Location:** `src/audio/lazyAudioLoader.ts`

Audio engine (~200KB Tone.js) loads only when user shows music intent.

**Trigger Tiers:**

| Tier | Triggers | Behavior |
|------|----------|----------|
| REQUIRE | play, record, add_to_grid | Block until ready |
| PRELOAD | step_toggle, add_track | Load in background |
| PREVIEW | hover, transpose | Only if already loaded |

**Usage:**
```typescript
import { ensureAudioLoaded, getAudioEngine } from './audio/lazyAudioLoader';

// Tier 2: Preload in background (non-blocking)
ensureAudioLoaded();

// Tier 1: Get engine (blocks until ready)
const engine = await getAudioEngine();
```

---

### Sampled Instrument Loading

**Location:** `src/audio/sampled-instrument.ts`

**Loading Strategy:**
1. C4 (middle C) loads immediately for fast playback
2. C2, C3, C5 load in background
3. Notes pitch-shift to nearest available sample

**Pitch Shifting:**
```
Target Note → Find Nearest Sample → Calculate playbackRate
playbackRate = 2^((targetNote - sampleNote) / 12)
```

---

## Quick Reference

### Adding a New Sampled Instrument

```bash
# 1. Create directory
mkdir -p public/instruments/my-instrument

# 2. Process samples (trim to 5s, convert to MP3)
ffmpeg -i source.wav -t 5 -codec:a libmp3lame -qscale:a 2 C4.mp3

# 3. Create manifest.json (see template above)

# 4. Register in src/audio/sampled-instrument.ts
# Add 'my-instrument' to SAMPLED_INSTRUMENTS array

# 5. Test
npm run test:unit -- sampled-instrument
```

### Adding a New Synth Preset

```typescript
// In src/audio/synth.ts, add to SYNTH_PRESETS:
'my-synth': {
  waveform: 'sawtooth',
  filter: { frequency: 2000, Q: 3 },
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.5 }
}
```

### Analyzing Sample Impact

```bash
# Check current samples
./scripts/audio-impact.sh

# Trim oversized samples
ffmpeg -i oversized.mp3 -t 5 -af "afade=t=out:st=4.5:d=0.5" trimmed.mp3
```

### Validating Audio Quality

```bash
# Run all volume tests
npm run test:unit -- volume-verification

# Test specific preset
npm run test:unit -- volume-verification -t "my-synth"
```

### Processing University of Iowa Samples

```bash
# 1. Download samples from https://theremin.music.uiowa.edu/

# 2. Convert AIFF to MP3 with trim
for f in *.aiff; do
  ffmpeg -i "$f" -t 5 -codec:a libmp3lame -qscale:a 2 "${f%.aiff}.mp3"
done

# 3. Rename to note names (C2.mp3, C3.mp3, etc.)

# 4. Create manifest.json with proper MIDI note numbers
```

---

## File Locations

| Tool/File | Location | Purpose |
|-----------|----------|---------|
| Audio Impact Script | `scripts/audio-impact.sh` | Analyze sample sizes |
| Sample Manifest | `public/instruments/{id}/manifest.json` | Instrument definition |
| Instrument Licenses | `public/instruments/LICENSE.md` | License documentation |
| Sampled Instrument | `src/audio/sampled-instrument.ts` | Sample loading/playback |
| Web Audio Synth | `src/audio/synth.ts` | Subtractive synthesis |
| Procedural Samples | `src/audio/samples.ts` | Generated sounds |
| Tone.js Synths | `src/audio/toneSynths.ts` | FM/AM synthesis |
| Advanced Synth | `src/audio/advancedSynth.ts` | Complex synthesis |
| Effects Chain | `src/audio/toneEffects.ts` | Audio effects |
| Recorder | `src/audio/recorder.ts` | Mic recording |
| Slicer | `src/audio/slicer.ts` | Audio slicing |
| Volume Tests | `src/audio/volume-verification.test.ts` | Quality validation |
| Lazy Loader | `src/audio/lazyAudioLoader.ts` | Deferred loading |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Audio Sources                             │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│   Sampled    │  Procedural  │  Web Audio   │     Tone.js       │
│  Instruments │   Samples    │    Synth     │  Advanced Synth   │
│  (MP3/WAV)   │  (Generated) │  (32 preset) │   (11 preset)     │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬──────────┘
       │              │              │                │
       └──────────────┴──────────────┴────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Audio Engine   │
                    │  (Scheduling)   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Effects Chain  │
                    │ Dist→Chorus→    │
                    │ Delay→Reverb    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Compressor    │
                    │   (Limiting)    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     Output      │
                    │   (Speakers)    │
                    └─────────────────┘
```
