# Implementation Comparison: Old vs New Audio Architecture

## Executive Summary

This document compares the pre-Phase 21A "known good" implementation with the post-Phase 21A implementation after bug fixes. It extracts lessons learned and considers how they would inform a Tone.js-based alternative.

**Key Insight:** The transition from in-memory synthesis to network-loaded samples fundamentally changed timing assumptions, exposing latent bugs that "worked by accident" in the old code.

---

## Part 1: Architecture Comparison

### Old Implementation (Pre-Phase 21A)

```
┌─────────────────────────────────────────────────────────┐
│                    AudioEngine                          │
├─────────────────────────────────────────────────────────┤
│ initialize()                                            │
│   ├─ Create AudioContext                               │
│   ├─ Create masterGain → compressor → destination      │
│   ├─ synthEngine.initialize()                          │
│   ├─ createSynthesizedSamples() ← ~50ms (in-memory)    │
│   ├─ this.initialized = true                           │
│   └─ attachUnlockListeners()                           │
├─────────────────────────────────────────────────────────┤
│ playSynthNote(noteId, preset, semitone, time, dur)     │
│   └─ synthEngine.playNote()  ← Always uses synth       │
└─────────────────────────────────────────────────────────┘

Total init time: ~50ms (all in-memory generation)
```

**Characteristics:**
- Simple, linear initialization
- No network requests
- All sounds generated from oscillators
- No routing logic in playSynthNote()
- ~200 lines total

### New Implementation (Post-Phase 21A)

```
┌─────────────────────────────────────────────────────────┐
│                    AudioEngine                          │
├─────────────────────────────────────────────────────────┤
│ constructor(deps?)                                      │
│   ├─ Dependency injection for testability              │
│   └─ _pendingPreloads = Set<string>                    │
├─────────────────────────────────────────────────────────┤
│ initialize()                                            │
│   ├─ Guard: if (_initializePromise) return it          │
│   └─ _doInitialize()                                   │
│       ├─ Create AudioContext                           │
│       ├─ Create masterGain → compressor → destination  │
│       ├─ synthEngine.initialize()                      │
│       ├─ sampledInstrumentRegistry.initialize()        │
│       ├─ Register sampled instruments (piano, etc.)    │
│       ├─ createSynthesizedSamples() ← ~50ms            │
│       ├─ Load piano (await C4) ← ~300-500ms (NETWORK)  │
│       ├─ this.initialized = true                       │
│       ├─ attachUnlockListeners()                       │
│       └─ Load pending preloads (background)            │
├─────────────────────────────────────────────────────────┤
│ preloadInstrumentsForTracks(tracks)                    │
│   ├─ If not initialized: store in _pendingPreloads     │
│   └─ If initialized: _loadSampledInstruments()         │
├─────────────────────────────────────────────────────────┤
│ playSynthNote(noteId, preset, semitone, time, dur)     │
│   ├─ Check: is this a sampled instrument?              │
│   │   ├─ YES: use sampledInstrumentRegistry            │
│   │   │   └─ NEVER fall back to synth                  │
│   │   └─ NO: use synthEngine                           │
│   └─ Route to appropriate player                       │
└─────────────────────────────────────────────────────────┘

Total init time: ~350-550ms (network-dependent)
```

**Characteristics:**
- Complex initialization with guards
- Network requests for samples
- Mix of synthesized and sampled sounds
- Routing logic in playSynthNote()
- Dependency injection for testing
- Observable state pattern for loading
- ~740 lines total

---

## Part 2: What Changed and Why

### Change 1: Concurrent Initialization Guard

**Old Code:**
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;
  // ... rest of init
}
```

**New Code:**
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;
  if (this._initializePromise) {
    return this._initializePromise;  // Wait for in-progress init
  }
  this._initializePromise = this._doInitialize();
  // ...
}
```

**Why:** Multiple callers (Play button, preload, preview) could call initialize() simultaneously. Without the guard, each would create a new AudioContext, causing resource leaks and race conditions.

### Change 2: Pending Preloads Queue

**Old Code:** No preloading concept - everything was in-memory.

**New Code:**
```typescript
preloadInstrumentsForTracks(tracks): Promise<void> {
  if (!this.initialized) {
    // Store for later - can't load until user gesture
    this._pendingPreloads.add(presetName);
    return;
  }
  // Actually load
}
```

**Why:** useSession calls preloadInstrumentsForTracks() during page load, BEFORE user clicks anything. Web Audio requires user gesture to create AudioContext. Queue requests and fulfill after initialize().

### Change 3: Piano Awaited During Init

**Old Code:** N/A

**New Code:**
```typescript
// CRITICAL INVARIANT: After initialize() returns, piano must be ready.
this._pianoLoadPromise = this._sampledInstrumentRegistry.load('piano');
await this._pianoLoadPromise;
```

**Why:** If scheduler starts before piano loads, piano notes are silent. Must guarantee piano ready before returning from initialize().

### Change 4: No Synth Fallback for Sampled Instruments

**Old Code:** N/A (all synth)

**New Code:**
```typescript
if (instrument.isReady()) {
  instrument.playNote(...);
} else {
  // INVARIANT VIOLATION - log error, skip note
  // DO NOT fall back to synth
}
return; // Always return for sampled instruments
```

**Why:** If piano plays synth sound as "fallback," users hear wrong sound. Better to be silent (with error log) than to confuse users.

---

## Part 3: The Timing Bug Deep Dive

### The Latent Bug

Both old and new code had this bug in SamplePicker.tsx:

```typescript
const handlePreview = useCallback(async (sampleId: string) => {
  if (!audioEngine.isInitialized()) {
    await audioEngine.initialize();  // BUG: Called from mouseenter!
  }
  audioEngine.playNow(sampleId);
}, []);
```

`mouseenter` is NOT a valid user gesture for AudioContext creation.

### Why Old Code Worked Anyway

```
OLD CODE TIMELINE:
0ms:    mouseenter fires → initialize() starts
0ms:    AudioContext created (suspended)
50ms:   createSynthesizedSamples() completes (FAST)
50ms:   attachUnlockListeners() adds click handler
500ms:  User clicks Play
500ms:  Document click handler fires FIRST
500ms:  resume() SUCCEEDS (within user gesture)
500ms:  handlePlayPause runs with running context
RESULT: WORKS
```

### Why New Code Broke

```
NEW CODE TIMELINE:
0ms:    mouseenter fires → initialize() starts
0ms:    AudioContext created (suspended)
50ms:   createSynthesizedSamples() completes
50ms:   Piano loading starts (network fetch)
300ms:  User clicks Play BEFORE piano loads
300ms:  handlePlayPause awaits initialize() (blocked on piano)
500ms:  Piano loads, attachUnlockListeners() called (TOO LATE)
500ms:  handlePlayPause continues
500ms:  User gesture expired (~100-300ms timeout)
500ms:  resume() fails or context stays suspended
RESULT: SILENT
```

### Why Second Load Worked

Browser HTTP cache serves piano samples in ~10ms instead of ~450ms:
- Total init time: ~60ms (not ~500ms)
- Unlock listeners ready before user clicks
- Same timing as old code

### The Fix

Don't call initialize() from non-gesture contexts:

```typescript
const handlePreview = useCallback((sampleId: string) => {
  if (!audioEngine.isInitialized()) {
    return; // Skip preview - must click first
  }
  audioEngine.playNow(sampleId);
}, []);
```

---

## Part 4: Lessons Learned

### Lesson 1: Network Loading Changes Everything

**Old assumption:** Initialization is fast (~50ms)
**New reality:** Network requests can take 500ms+

**Impact:**
- User gesture tokens expire during long async operations
- First load ≠ second load (cache effects)
- Mobile networks are slower and less predictable

**Heuristic:** Any init that touches network should be treated as fundamentally different from in-memory init.

### Lesson 2: User Gesture Tokens Expire

**Constraint:** Browsers give ~100-300ms for async work within a gesture

**Implications:**
- Can't do long network fetches after click
- Must either:
  a) Preload before gesture
  b) Create context in gesture, load after
  c) Use progressive loading (load minimum first)

**Our Solution:** Progressive loading - load C4 first (~300ms), background load rest.

### Lesson 3: Test First Loads Specifically

**The trap:** Developer refreshes → cache warm → works
**The reality:** New user → cache cold → broken

**Testing strategy:**
- Incognito window testing
- Clear cache before test
- Network throttling to simulate slow connections
- Automated tests that mock network timing

### Lesson 4: Concurrent Initialization Guards Are Essential

**Problem:** Multiple callers (UI, preload, preview) can all trigger init
**Solution:** Promise-based guard that returns existing promise if in progress

```typescript
if (this._initializePromise) {
  return this._initializePromise;
}
this._initializePromise = this._doInitialize();
```

### Lesson 5: Queue Pre-Init Requests

**Problem:** Code wants to preload before user gesture
**Solution:** Queue requests, fulfill after init

```typescript
if (!this.initialized) {
  this._pendingPreloads.add(instrumentId);
  return; // Will load when initialize() called
}
```

### Lesson 6: Never Silently Substitute Sounds

**Problem:** What if piano samples fail to load?
**Bad solution:** Fall back to synth piano preset
**Why bad:** User selected "piano," hears sine waves
**Good solution:** Log error, skip note, be silent

Silence is better than wrong sound.

### Lesson 7: Dependency Injection Enables Testing

**Old code:** Singleton instances, hard to mock
**New code:** Constructor injection with defaults

```typescript
constructor(deps?: AudioEngineDependencies) {
  this._sampledInstrumentRegistry = deps?.sampledInstrumentRegistry ?? sampledInstrumentRegistry;
}
```

Enables unit tests without real audio hardware.

---

## Part 5: How Tone.js Would Help

If implementing from scratch, Tone.js handles many of these concerns.

### User Gesture Handling

**Our implementation:**
```typescript
// Manual unlock listeners
const events = ['touchstart', 'touchend', 'click', 'keydown'];
events.forEach(event => {
  document.addEventListener(event, unlock, { passive: true });
});
```

**Tone.js:**
```typescript
// Single call, handles all edge cases
await Tone.start();
```

Tone.js internally:
- Tracks AudioContext state
- Automatically resumes on user gesture
- Handles iOS quirks (interrupted state)
- Provides `Tone.context.state` observable

### Sample Loading

**Our implementation:**
```typescript
class SampledInstrument {
  async loadInstrument() { /* 200+ lines */ }
  findNearestSample(midiNote) { /* pitch shifting logic */ }
}
```

**Tone.js:**
```typescript
const piano = new Tone.Sampler({
  urls: { C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3' },
  baseUrl: '/instruments/piano/',
  onload: () => console.log('Piano ready'),
}).toDestination();

// Automatic pitch shifting to nearest sample
piano.triggerAttackRelease('F#4', '8n');
```

Tone.js Sampler:
- Automatic nearest-sample selection
- Built-in pitch shifting
- Attack/release with duration syntax
- Lazy loading support

### Scheduling

**Our implementation:**
```typescript
class Scheduler {
  private scheduleLoop() {
    const lookahead = 0.1;
    // Manual timing calculations
  }
}
```

**Tone.js:**
```typescript
Tone.Transport.scheduleRepeat((time) => {
  sampler.triggerAttackRelease('C4', '16n', time);
}, '16n');

Tone.Transport.start();
```

Tone.js Transport:
- Built-in BPM control
- Swing support
- Loop scheduling
- Time signature support

### Effects

**Our implementation:** Rolled back (too complex to sync)

**Tone.js:**
```typescript
const reverb = new Tone.Reverb(2).toDestination();
const delay = new Tone.FeedbackDelay('8n', 0.5).connect(reverb);
piano.connect(delay);

// Easy to serialize for sync
const effectState = { reverbDecay: 2, delayTime: '8n', feedback: 0.5 };
```

### Synth Presets

**Our implementation:**
```typescript
const SYNTH_PRESETS = {
  supersaw: {
    waveform: 'sawtooth',
    filterCutoff: 4000,
    osc2: { waveform: 'sawtooth', detune: 25, mix: 0.5 },
    // ... 20 more parameters
  }
};
```

**Tone.js:**
```typescript
const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
});
```

Built-in synth types:
- `Tone.Synth` - basic
- `Tone.FMSynth` - FM synthesis
- `Tone.AMSynth` - AM synthesis
- `Tone.PolySynth` - polyphonic wrapper
- `Tone.Sampler` - sample playback

---

## Part 6: Tone.js Implementation Considerations

### What Tone.js Would Simplify

| Concern | Our Code | Tone.js |
|---------|----------|---------|
| User gesture handling | Manual unlock listeners | `Tone.start()` |
| Sample loading | Custom SampledInstrument class | `Tone.Sampler` |
| Pitch shifting | Manual `findNearestSample()` | Automatic |
| Scheduling | Custom Scheduler class | `Tone.Transport` |
| Effects | Rolled back (too complex) | Built-in, chainable |
| Envelope/LFO | Custom SynthVoice class | Built-in modulators |
| Voice limiting | Manual implementation | `Tone.PolySynth` |

### What We'd Still Need to Build

| Concern | Why Tone.js Doesn't Help |
|---------|--------------------------|
| Multiplayer sync | Application-level concern |
| Session state | Application-level concern |
| Step sequencer UI | React components |
| WebSocket messages | Application-level concern |
| Preset management | Our preset format ≠ Tone.js format |

### Migration Path

If migrating to Tone.js:

1. **Replace AudioEngine with Tone.js context**
   ```typescript
   // Old
   this.audioContext = new AudioContext();

   // New
   // Tone.js manages context internally
   await Tone.start();
   ```

2. **Replace SampledInstrument with Tone.Sampler**
   ```typescript
   // Old
   const piano = new SampledInstrument('piano');
   await piano.ensureLoaded();
   piano.playNote(noteId, midiNote, time, duration);

   // New
   const piano = new Tone.Sampler({ /* config */ });
   await Tone.loaded();
   piano.triggerAttackRelease(Tone.Frequency(midiNote, 'midi'), duration, time);
   ```

3. **Replace SynthEngine with Tone.PolySynth**
   ```typescript
   // Old
   synthEngine.playNote(noteId, frequency, params, time, duration);

   // New
   synth.triggerAttackRelease(frequency, duration, time);
   ```

4. **Replace Scheduler with Tone.Transport**
   ```typescript
   // Old
   scheduler.start();
   scheduler.setBPM(120);

   // New
   Tone.Transport.bpm.value = 120;
   Tone.Transport.start();
   ```

### Bundle Size Consideration

| Approach | Size |
|----------|------|
| Current (custom) | ~50KB (audio code only) |
| Tone.js (full) | ~200KB minified |
| Tone.js (tree-shaken) | ~80-120KB |

Tone.js adds ~50-70KB over our custom implementation, but saves ~3000 lines of code.

---

## Part 7: Recommendations

### For Current Implementation

1. **Keep current architecture** - It works, is tested, and is well-documented
2. **Add integration tests for first-load scenario** - Mock network delays
3. **Consider extracting timing constants** - Make gesture timeout explicit
4. **Monitor for iOS edge cases** - "interrupted" state handling

### For Future Implementations

1. **Start with Tone.js** if building from scratch
2. **Use `Tone.loaded()` pattern** for sample loading
3. **Use `Tone.Transport` for scheduling** - Don't reinvent
4. **Keep multiplayer sync separate** from audio engine
5. **Test on real mobile devices** - Emulators miss gesture bugs

### Key Invariants to Preserve

Regardless of implementation:

1. **AudioContext must be created in user gesture**
2. **Samples must be loaded before playback**
3. **Never substitute sounds silently**
4. **First load must work (not just cached loads)**
5. **Concurrent init calls must be safe**

---

## Appendix: Code Metrics

### Lines of Code Comparison

| Component | Old | New | Delta |
|-----------|-----|-----|-------|
| engine.ts | 350 | 740 | +390 |
| synth.ts | 400 | 1000 | +600 |
| samples.ts | 465 | 275 | -190 |
| sampled-instrument.ts | 0 | 553 | +553 |
| **Total audio code** | **1215** | **2568** | **+1353** |

### Test Coverage

| Component | Old Tests | New Tests |
|-----------|-----------|-----------|
| engine.ts | 24 | 48 |
| synth.ts | 85 | 150 |
| sampled-instrument.ts | 0 | 70 |
| SamplePicker.tsx | 0 | 12 |
| **Total** | **109** | **280** |

### Complexity Added

- Concurrent initialization guard
- Pending preloads queue
- Observable loading state
- Strategy pattern for note playback
- Dependency injection
- Progressive sample loading

### Complexity Removed (via cleanup)

- 6 redundant sample generation functions
- 2 redundant UI categories
- Duplicate instrument concepts
