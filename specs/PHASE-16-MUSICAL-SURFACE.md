# Phase 16: Musical Surface Expansion

> **Philosophy:** This phase consolidates all features that expand "what music can be made" — the richness, variety, and expressive range available to users. Rather than scattering these across multiple phases, we group them by their shared purpose: making Keyboardia sound as good as professional tools while remaining simple to use.

---

## Overview

### What is "Musical Surface"?

The **musical surface** is the total space of sounds, rhythms, and expressions a user can create. It has five dimensions:

| Dimension | What It Controls | Current State | Target State |
|-----------|------------------|---------------|--------------|
| **Rhythm** | When notes happen | 16 steps, fixed grid | Euclidean, probability, ratchets |
| **Melody** | Which pitches play | Chromatic grid ✅ | Scale modes, chord voicing |
| **Timbre** | What instruments sound like | 19 synth presets | Sampled instruments, dual osc, FM |
| **Space** | Depth and dimension | None | Reverb, delay, chorus |
| **Expression** | Real-time control | None | XY pad, velocity, per-track swing |

### Why Consolidate?

Previously, these features were scattered across:
- Phase 4 (Future Polyrhythm Enhancements)
- Phase 19 (Advanced Synthesis Engine)
- Implicit features never formally specified

**Benefits of consolidation:**
1. Single coherent vision for "making it sound good"
2. Audio engine work contained to one phase
3. Clear narrative: "Phase 16 makes Keyboardia professional"
4. User value delivered as unified upgrade

---

## Current Limitations

### Synthesis (`app/src/audio/synth.ts`)

| Limitation | Impact |
|------------|--------|
| Single oscillator per voice | No harmonic richness, detuning, or layering |
| Basic waveforms only | Sine, saw, square, triangle — no complex timbres |
| No sampled instruments | Can't reproduce acoustic piano, real strings |
| No effects | No reverb, delay, chorus for space/depth |
| Static filter | No filter envelope or modulation |
| No LFO | No movement, vibrato, or wobble |

### Rhythm

| Limitation | Impact |
|------------|--------|
| Manual step entry only | No algorithmic pattern generation |
| Global swing only | Can't create J Dilla-style offset grooves |
| Binary triggers | No probability or conditional triggers |
| One hit per step | No ratcheting/rolls |

### Expression

| Limitation | Impact |
|------------|--------|
| No velocity | All notes same loudness |
| No real-time control | Can't perform filter sweeps, pitch bends |
| No automation | Parameters static throughout pattern |

---

## Implementation Tiers

The phase is structured in three tiers, each delivering standalone value:

```
Phase 16: Musical Surface
│
├── Tier 1: Foundation (MVP)           ← 2-3 weeks
│   ├── Sampled piano instrument
│   ├── Global reverb effect
│   └── Euclidean rhythm generator
│
├── Tier 2: Core Synthesis             ← 3-4 weeks
│   ├── Dual oscillator engine
│   ├── LFO system with routing
│   ├── Filter envelope (dedicated)
│   ├── Per-track swing
│   └── Conditional triggers (probability)
│
└── Tier 3: Extended Expression        ← 4-6 weeks
    ├── FM synthesis
    ├── Full effects chain (delay, chorus)
    ├── XY Pad controller
    ├── Ratcheting (multiple triggers per step)
    ├── Step rotation (phase shifting)
    └── Scale modes & chord voicing
```

---

## Tier 1: Foundation (MVP)

Deliver the highest-impact features with lowest complexity.

### 1.1 Sampled Piano Instrument

**Problem:** The current synth can't produce realistic piano sounds. Piano is the most requested instrument for melodic content.

**Solution:** Add multi-sampled piano using R2 storage.

```
R2 Bucket: keyboardia-samples
└── instruments/
    └── piano/
        ├── C2.mp3    # ~50KB each
        ├── C3.mp3
        ├── C4.mp3
        ├── C5.mp3
        └── manifest.json
```

**manifest.json:**
```json
{
  "name": "Grand Piano",
  "type": "sampled",
  "samples": [
    { "note": 36, "file": "C2.mp3", "baseFreq": 65.41 },
    { "note": 48, "file": "C3.mp3", "baseFreq": 130.81 },
    { "note": 60, "file": "C4.mp3", "baseFreq": 261.63 },
    { "note": 72, "file": "C5.mp3", "baseFreq": 523.25 }
  ],
  "loopStart": null,
  "loopEnd": null,
  "release": 0.5
}
```

**Implementation:**

```typescript
// app/src/audio/sampled-instrument.ts

export class SampledInstrument {
  private samples: Map<number, AudioBuffer> = new Map();
  private manifest: InstrumentManifest;

  async load(manifestUrl: string): Promise<void> {
    this.manifest = await fetch(manifestUrl).then(r => r.json());
    await Promise.all(
      this.manifest.samples.map(async (s) => {
        const buffer = await this.loadSample(s.file);
        this.samples.set(s.note, buffer);
      })
    );
  }

  playNote(midiNote: number, time: number, duration: number): void {
    // Find nearest sample and pitch-shift
    const nearestSample = this.findNearestSample(midiNote);
    const playbackRate = this.calculatePlaybackRate(midiNote, nearestSample);

    const source = this.audioContext.createBufferSource();
    source.buffer = this.samples.get(nearestSample.note)!;
    source.playbackRate.value = playbackRate;
    source.connect(this.output);
    source.start(time);
    source.stop(time + duration + this.manifest.release);
  }

  private calculatePlaybackRate(targetNote: number, sample: Sample): number {
    const semitones = targetNote - sample.note;
    return Math.pow(2, semitones / 12);
  }
}
```

**UI Integration:**
- Add "Piano" to SamplePicker dropdown
- Lazy-load samples on first selection (~200KB total)
- Show loading indicator during fetch

**Success Criteria:**
- [ ] Piano sounds "nice and full" (comparable to Ableton Learning Music)
- [ ] Latency < 50ms on first note after load
- [ ] Works on mobile Safari/Chrome
- [ ] Graceful fallback if R2 unavailable

---

### 1.2 Global Reverb Effect

**Problem:** Dry sounds lack depth and cohesion. Even simple beats sound amateur without space.

**Solution:** Add convolution reverb with impulse response.

```typescript
// app/src/audio/effects/reverb.ts

export class ReverbEffect {
  private convolver: ConvolverNode;
  private dryGain: GainNode;
  private wetGain: GainNode;

  constructor(audioContext: AudioContext, impulseResponse: AudioBuffer) {
    this.convolver = audioContext.createConvolver();
    this.convolver.buffer = impulseResponse;

    this.dryGain = audioContext.createGain();
    this.wetGain = audioContext.createGain();

    // Default: 30% wet
    this.setMix(0.3);
  }

  setMix(wet: number): void {
    this.dryGain.gain.value = 1 - wet;
    this.wetGain.gain.value = wet;
  }

  connect(source: AudioNode, destination: AudioNode): void {
    // Dry path
    source.connect(this.dryGain);
    this.dryGain.connect(destination);

    // Wet path
    source.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(destination);
  }
}
```

**Impulse Response Options:**

| Type | Size | Character | Use Case |
|------|------|-----------|----------|
| Room | ~50KB | Tight, natural | Default |
| Hall | ~100KB | Large, lush | Pads, strings |
| Plate | ~80KB | Bright, vintage | Drums, vocals |

**UI:**
- Master reverb mix slider (0-100%)
- Preset selector (Room/Hall/Plate)
- Per-track send level (future Tier 2)

**Success Criteria:**
- [ ] Reverb adds depth without muddiness
- [ ] CPU impact < 5% on mobile
- [ ] Mix persists in session state

---

### 1.3 Euclidean Rhythm Generator

**Problem:** Creating interesting polyrhythmic patterns requires manual step-by-step entry. Users don't know Euclidean patterns exist.

**Solution:** Auto-distribute N hits across M steps using Euclidean algorithm.

**Algorithm:**
```typescript
// app/src/utils/euclidean.ts

/**
 * Generate Euclidean rhythm pattern.
 * Distributes `hits` as evenly as possible across `steps`.
 *
 * Examples:
 *   euclidean(3, 8)  → [1,0,0,1,0,0,1,0]  // Cuban tresillo
 *   euclidean(5, 8)  → [1,0,1,1,0,1,1,0]  // Cinquillo
 *   euclidean(7, 16) → [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] // West African bell
 */
export function euclidean(hits: number, steps: number): boolean[] {
  if (hits >= steps) return Array(steps).fill(true);
  if (hits === 0) return Array(steps).fill(false);

  // Bjorklund's algorithm
  const pattern: boolean[] = [];
  let remainders: number[] = [];
  let counts: number[] = [];
  let divisor = steps - hits;

  remainders.push(hits);
  let level = 0;

  while (remainders[level] > 1) {
    counts.push(Math.floor(divisor / remainders[level]));
    const newRemainder = divisor % remainders[level];
    divisor = remainders[level];
    remainders.push(newRemainder);
    level++;
  }
  counts.push(divisor);

  function build(level: number): void {
    if (level === -1) {
      pattern.push(false);
    } else if (level === -2) {
      pattern.push(true);
    } else {
      for (let i = 0; i < counts[level]; i++) {
        build(level - 1);
      }
      if (remainders[level] !== 0) {
        build(level - 2);
      }
    }
  }

  build(level);
  return pattern;
}
```

**Classic Euclidean Rhythms:**

| Hits | Steps | Pattern | Name/Origin |
|------|-------|---------|-------------|
| 2 | 5 | x.x.. | Khafif-e-ramal (Persian) |
| 3 | 8 | x..x..x. | Cuban tresillo |
| 4 | 12 | x..x..x..x.. | Fandango |
| 5 | 8 | x.xx.xx. | Cinquillo (Cuban) |
| 5 | 12 | x..x.x..x.x. | Venda clapping (South African) |
| 7 | 12 | x.x.xx.x.xx. | West African bell |
| 7 | 16 | x.x.x.x.x.x.x. | Brazilian samba |

**UI:**
- "Generate" button in track controls
- Hits slider (1 to stepCount)
- Preview before applying
- Rotation offset (phase shift)

**Implementation in TrackRow:**
```tsx
function EuclideanGenerator({ track, onApply }: Props) {
  const [hits, setHits] = useState(4);
  const [rotation, setRotation] = useState(0);

  const pattern = useMemo(() => {
    const base = euclidean(hits, track.stepCount);
    return rotate(base, rotation);
  }, [hits, track.stepCount, rotation]);

  return (
    <div className="euclidean-generator">
      <label>
        Hits: {hits}
        <input
          type="range"
          min={1}
          max={track.stepCount}
          value={hits}
          onChange={e => setHits(Number(e.target.value))}
        />
      </label>
      <label>
        Rotate: {rotation}
        <input
          type="range"
          min={0}
          max={track.stepCount - 1}
          value={rotation}
          onChange={e => setRotation(Number(e.target.value))}
        />
      </label>
      <PatternPreview pattern={pattern} />
      <button onClick={() => onApply(pattern)}>Apply</button>
    </div>
  );
}
```

**Success Criteria:**
- [ ] Euclidean patterns generate correctly for all step counts
- [ ] Rotation produces expected phase shifts
- [ ] Pattern applies without losing parameter locks
- [ ] Works with polyrhythmic track lengths (4/8/16/32/64)

---

## Tier 2: Core Synthesis

Upgrade the synth engine to match Learning Synths capabilities.

### 2.1 Dual Oscillator Engine

**Current:** Single oscillator per voice.

**Target:** Two oscillators with independent waveforms, mix, and detune.

```typescript
// Updated SynthParams in app/src/audio/synth.ts

export interface OscillatorConfig {
  waveform: WaveformType;
  level: number;           // 0-1 (mix between oscillators)
  detuneCents: number;     // -100 to +100 cents (fine tuning)
  detuneSemitones: number; // -24 to +24 semitones (coarse tuning)
  noise: number;           // 0-1 (noise mix)
}

export interface SynthParams {
  oscillator1: OscillatorConfig;
  oscillator2: OscillatorConfig;
  oscillatorMix: number;   // 0 = osc1 only, 1 = osc2 only, 0.5 = equal

  filter: FilterConfig;
  filterEnvelope: ADSREnvelope;

  amplitudeEnvelope: ADSREnvelope;

  lfo: LFOConfig;
}
```

**New Presets Enabled:**

| Preset | Config | Sound |
|--------|--------|-------|
| Supersaw | 2x saw, ±7 cents detune | Trance leads |
| Layered Pad | Sine + saw, +12 semitones | Full, rich pads |
| Thick Lead | Square + saw, ±3 cents | Fat monosynth |
| Sub + Harmonics | Sine (sub) + saw (harmonics) | Modern bass |

**Backwards Compatibility:**
```typescript
// Migration helper for old presets
function migratePreset(old: OldSynthParams): SynthParams {
  return {
    oscillator1: {
      waveform: old.waveform,
      level: 1,
      detuneCents: 0,
      detuneSemitones: 0,
      noise: 0,
    },
    oscillator2: {
      waveform: 'sine',
      level: 0,  // Silent by default
      detuneCents: 0,
      detuneSemitones: 0,
      noise: 0,
    },
    oscillatorMix: 0,  // 100% osc1
    // ... rest of migration
  };
}
```

---

### 2.2 LFO System

**Purpose:** Add movement and modulation to static sounds.

```typescript
export interface LFOConfig {
  frequency: number;       // 0.1 to 20 Hz
  waveform: WaveformType;
  destination: 'filter' | 'pitch' | 'amplitude';
  amount: number;          // 0 to 1
  sync: boolean;           // Sync to tempo (future)
}
```

**Implementation:**
```typescript
class LFO {
  private oscillator: OscillatorNode;
  private gain: GainNode;

  constructor(
    audioContext: AudioContext,
    config: LFOConfig,
    destination: AudioParam
  ) {
    this.oscillator = audioContext.createOscillator();
    this.oscillator.type = config.waveform;
    this.oscillator.frequency.value = config.frequency;

    this.gain = audioContext.createGain();
    this.gain.gain.value = config.amount * this.getScaleForDestination(config.destination);

    this.oscillator.connect(this.gain);
    this.gain.connect(destination);
    this.oscillator.start();
  }

  private getScaleForDestination(dest: LFOConfig['destination']): number {
    switch (dest) {
      case 'filter': return 2000;    // ±2000 Hz modulation
      case 'pitch': return 100;      // ±100 cents (1 semitone)
      case 'amplitude': return 0.5;  // ±50% volume
    }
  }
}
```

**Sounds Enabled:**
- Vibrato (LFO → pitch, 5-7 Hz)
- Tremolo (LFO → amplitude, 4-8 Hz)
- Filter sweeps (LFO → filter, 0.5-4 Hz)
- Wobble bass (LFO → filter, 1-4 Hz, square wave)

---

### 2.3 Filter Envelope

**Current:** Filter cutoff is static.

**Target:** Dedicated ADSR envelope modulating filter cutoff.

```typescript
export interface FilterConfig {
  frequency: number;        // 20 to 20000 Hz
  resonance: number;        // 0 to 30
  type: 'lowpass' | 'highpass' | 'bandpass';
  envelopeAmount: number;   // -1 to 1 (negative = inverted envelope)
}
```

**Sounds Enabled:**
- Plucky bass (fast decay on filter)
- Swelling pads (slow attack on filter)
- Acid squelch (high resonance + fast filter envelope)

---

### 2.4 Per-Track Swing

**Current:** Global swing affects all tracks equally.

**Target:** Each track can have independent swing amount.

```typescript
interface Track {
  // ... existing fields
  swing: number;  // 0-100%, overrides global if set
  useGlobalSwing: boolean;
}
```

**Musical Use Cases:**
- J Dilla-style beats: drums on grid, bass slightly behind
- Afrobeat: different swing per percussion layer
- Live feel: slight variations between instruments

**Implementation in Scheduler:**
```typescript
function calculateStepTime(
  globalStep: number,
  track: Track,
  globalSwing: number
): number {
  const swing = track.useGlobalSwing ? globalSwing : track.swing;
  const isOffbeat = globalStep % 2 === 1;

  if (isOffbeat && swing > 0) {
    // Delay offbeats by swing amount
    const maxDelay = stepDuration * 0.5;  // Max 50% of step
    return baseTime + (maxDelay * swing / 100);
  }
  return baseTime;
}
```

---

### 2.5 Conditional Triggers (Probability)

**Problem:** Patterns are deterministic and predictable.

**Solution:** Add per-step probability (0-100%).

```typescript
interface Step {
  active: boolean;
  probability: number;  // 0-100, default 100
  // ... existing parameterLocks
}
```

**UI:**
- Long-press step to reveal probability slider
- Visual indicator: opacity reflects probability
- 100% = solid, 50% = semi-transparent, 0% = outline only

**Scheduler Logic:**
```typescript
if (step.active && Math.random() * 100 < step.probability) {
  playStep(step);
}
```

**Musical Use Cases:**
- Ghost notes on hi-hats (30-50% probability)
- Occasional bass variations (80% probability)
- Generative ambient textures (random triggers)

---

## Tier 3: Extended Expression

Advanced features for power users and sound designers.

### 3.1 FM Synthesis

Add frequency modulation for metallic, bell-like tones.

```typescript
interface FMConfig {
  carrierWaveform: WaveformType;
  modulatorRatio: number;     // Frequency ratio (1, 2, 3, etc.)
  modulatorDepth: number;     // Modulation amount
  modulatorEnvelope: ADSREnvelope;
}
```

**Classic FM Sounds:**
- Electric piano (DX7-style)
- Bells and chimes
- Metallic percussion
- Evolving textures

---

### 3.2 Full Effects Chain

```typescript
interface EffectsChain {
  reverb: ReverbConfig;
  delay: {
    time: number;       // ms or beat-synced
    feedback: number;   // 0-0.95
    mix: number;
  };
  chorus: {
    rate: number;       // LFO speed
    depth: number;      // Modulation amount
    mix: number;
  };
  compressor: {
    threshold: number;  // dB
    ratio: number;      // 1:1 to 20:1
    attack: number;
    release: number;
  };
}
```

**Signal Flow:**
```
Track → Compressor → Chorus → Delay → Reverb → Master
                                  ↓
                              (feedback loop)
```

---

### 3.3 XY Pad Controller

Real-time parameter control via draggable pad.

```typescript
interface XYPadMapping {
  parameter: keyof SynthParams | 'lfoRate' | 'lfoAmount';
  axis: 'x' | 'y';
  min: number;
  max: number;
  curve: 'linear' | 'exponential';
}

interface XYPad {
  mappings: XYPadMapping[];
  x: number;  // 0-1
  y: number;  // 0-1
}
```

**Preset Mappings:**

| Name | X Axis | Y Axis |
|------|--------|--------|
| Filter Sweep | Cutoff (100-8000 Hz) | Resonance (0-20) |
| Wobble Control | LFO Rate (0.5-8 Hz) | LFO Amount (0-1) |
| Envelope Shape | Attack (0.01-1s) | Release (0.1-2s) |

**UI Component:**
```tsx
function XYPad({ mappings, onChange }: Props) {
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });

  const handleMove = (e: PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    setPosition({ x, y });
    onChange(applyMappings(mappings, x, y));
  };

  return (
    <div
      className="xy-pad"
      onPointerDown={handleMove}
      onPointerMove={handleMove}
    >
      <div
        className="xy-cursor"
        style={{ left: `${position.x * 100}%`, bottom: `${position.y * 100}%` }}
      />
    </div>
  );
}
```

---

### 3.4 Ratcheting

Multiple triggers per step for fills and glitchy effects.

```typescript
interface Step {
  // ... existing
  ratchet: 1 | 2 | 3 | 4 | 6 | 8;  // Subdivisions within step
}
```

**UI:** Step shows subdivision indicator (e.g., "÷2" for 2 hits per step)

---

### 3.5 Step Rotation

Rotate pattern by N steps for polyrhythmic phasing.

```typescript
function rotatePattern(steps: Step[], offset: number): Step[] {
  const len = steps.length;
  return steps.map((_, i) => steps[(i + offset) % len]);
}
```

**UI:** Rotation buttons (← →) in track controls, or drag gesture

---

### 3.6 Scale Modes & Chord Voicing

Constrain chromatic grid to musical scales.

```typescript
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

interface Track {
  // ... existing
  scale: keyof typeof SCALES | 'chromatic';
  rootNote: number;  // MIDI note (60 = C4)
}
```

**UI Changes:**
- Scale selector in track settings
- ChromaticGrid highlights in-scale notes
- Out-of-scale notes still playable but visually muted

---

## Data Model Changes

### Session State Schema v3

```typescript
interface SessionState {
  version: 3;  // Bumped from 2

  tracks: Track[];
  tempo: number;
  swing: number;

  // New in v3
  effects: {
    reverb: ReverbConfig;
    delay?: DelayConfig;
    chorus?: ChorusConfig;
  };

  // Loaded instruments (for sampled)
  loadedInstruments: string[];  // ['piano', 'strings']
}

interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: Step[];
  stepCount: StepCountOption;
  muted: boolean;
  soloed: boolean;
  volume: number;
  pan: number;

  // New in v3
  synthParams?: SynthParams;      // For synth tracks
  swing?: number;                  // Per-track swing
  useGlobalSwing: boolean;
  scale?: ScaleName;
  rootNote?: number;
  reverbSend: number;              // 0-1
}

interface Step {
  active: boolean;
  parameterLocks?: ParameterLocks;

  // New in v3
  probability: number;             // 0-100, default 100
  ratchet: RatchetValue;           // 1 = normal
}
```

### Migration Strategy

```typescript
function migrateSession(session: unknown): SessionState {
  const version = (session as { version?: number }).version ?? 1;

  if (version < 3) {
    // Add default values for new fields
    return {
      ...session,
      version: 3,
      effects: { reverb: DEFAULT_REVERB },
      tracks: session.tracks.map(t => ({
        ...t,
        useGlobalSwing: true,
        reverbSend: 0.3,
        steps: t.steps.map(s => ({
          ...s,
          probability: 100,
          ratchet: 1,
        })),
      })),
    };
  }

  return session as SessionState;
}
```

---

## File Structure

```
app/src/audio/
├── engine.ts                 # AudioContext setup
├── scheduler.ts              # Lookahead scheduling
├── synth.ts                  # SynthEngine (upgraded)
├── sampled-instrument.ts     # NEW: Sampled playback
├── effects/
│   ├── reverb.ts             # NEW: Convolution reverb
│   ├── delay.ts              # NEW: Tempo-synced delay
│   └── chorus.ts             # NEW: Chorus effect
└── lfo.ts                    # NEW: LFO oscillator

app/src/components/
├── TrackRow.tsx              # Updated with new controls
├── EuclideanGenerator.tsx    # NEW
├── XYPad.tsx                 # NEW
├── ProbabilitySlider.tsx     # NEW
└── EffectsPanel.tsx          # NEW

app/src/utils/
└── euclidean.ts              # NEW: Euclidean algorithm

public/impulse-responses/
├── room.wav                  # ~50KB
├── hall.wav                  # ~100KB
└── plate.wav                 # ~80KB
```

---

## Success Criteria

### Tier 1 Complete When:
- [ ] Piano sounds "nice and full" (comparable to Ableton Learning Music)
- [ ] Reverb adds depth without muddiness
- [ ] Euclidean generator creates valid patterns for all step counts
- [ ] Load time increase < 2 seconds on 3G

### Tier 2 Complete When:
- [ ] Dual oscillator with detune creates rich, full sounds
- [ ] LFO creates audible movement (filter sweeps, vibrato, tremolo)
- [ ] Filter envelope shapes sound over time (plucks, swells)
- [ ] Per-track swing enables J Dilla-style grooves
- [ ] Probability creates natural variation

### Tier 3 Complete When:
- [ ] FM synthesis produces bell and electric piano tones
- [ ] Effects chain adds professional polish
- [ ] XY pad allows expressive real-time control
- [ ] Ratcheting creates fills and glitch effects
- [ ] Scale modes constrain to musical keys

### Overall Phase Complete When:
- [ ] Feature parity with [Learning Synths Playground](https://learningsynths.ableton.com/en/playground) core controls
- [ ] New presets don't break existing sessions
- [ ] Works on mobile Safari/Chrome
- [ ] All unit tests pass
- [ ] Documentation updated

---

## Dependencies

### External
- Impulse response files (CC0/public domain or self-recorded)
- Piano samples (Freesound, Pianobook, or self-recorded)

### Internal
- R2 bucket configured (Phase 8 ✅)
- Lazy-loading infrastructure
- Session migration system

### Not Required
- Authentication (Phase 17)
- Shared samples (Phase 18)

---

## Open Questions

1. **Sample licensing:** CC0/public domain samples, or record our own?
2. **Bundle size budget:** What's acceptable increase for Tier 1?
3. **Preset management:** User-created synths, or curated presets only?
4. **Per-track effects:** Global effects only, or per-track sends?
5. **XY pad recording:** Should movements be recordable as automation?

---

## References

- [Ableton Learning Music](https://learningmusic.ableton.com/)
- [Ableton Learning Synths](https://learningsynths.ableton.com/)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Euclidean Rhythms - Godfried Toussaint](http://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf)
- [A Tale of Two Clocks - web.dev](https://web.dev/articles/audio-scheduling)
- Existing research: `specs/research/ABLETON-LEARNING-MUSIC-ANALYSIS.md`
