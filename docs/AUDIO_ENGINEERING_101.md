# Audio Engineering 101: Keyboardia Reference

Applicable audio engineering principles for the Keyboardia step sequencer. This document is filtered to concepts that align with our UI philosophy: **grid-based simplicity, immediate feedback, and no musical knowledge required**.

---

## 1. Sound Fundamentals

### Frequency & Pitch

- **Frequency** = pitch. Measured in Hertz (Hz)
- Human hearing: 20 Hz to 20,000 Hz
- Standard reference: **A4 = 440 Hz**
- Higher Hz = higher pitch

### MIDI Note to Frequency

```javascript
frequency = 440 * Math.pow(2, (midiNote - 69) / 12)
```

This formula is used in chromatic mode for pitch transposition.

### Amplitude & Volume

- Amplitude = perceived loudness
- Digital audio uses **dBFS** (decibels Full Scale)
- **0 dBFS = maximum level** (clipping threshold)
- All levels are negative, approaching 0

---

## 2. Clipping Prevention

**Digital clipping** occurs when signal exceeds 0 dBFS, causing harsh distortion. This is the primary audio quality concern for Keyboardia.

### How We Prevent Clipping

| Technique | Keyboardia Implementation |
|-----------|---------------------------|
| Envelope peak limit | `ENVELOPE_PEAK = 0.85` (below 1.0) |
| Master compressor | Threshold: -6 dB, Ratio: 4:1 |
| Voice limiting | `MAX_VOICES = 16` |
| Click prevention | `FADE_TIME = 0.003` (3ms ramps) |

### Compressor Settings (Current Implementation)

```javascript
threshold: -6    // Start compressing at -6 dBFS
knee: 12         // Soft knee for natural response
ratio: 4         // 4:1 compression ratio
attack: 0.003    // 3ms attack (fast)
release: 0.25    // 250ms release
```

**Why 4:1 ratio?** Moderate compression that prevents peaks without squashing dynamics. Matches the "immediate feedback" philosophy — notes still feel punchy.

---

## 3. Timing & Latency

### Latency Thresholds

| Latency | Perception |
|---------|------------|
| < 10 ms | Imperceptible |
| 10-20 ms | Acceptable for live play |
| > 20 ms | Noticeably delayed |

**Keyboardia target: < 20ms** for step triggers to feel responsive.

### Tempo Calculations

```javascript
// Quarter note duration
quarterNoteMs = 60000 / BPM

// 16th note (one step) duration
stepMs = 60000 / BPM / 4

// Example: 120 BPM
// Quarter = 500ms, Step = 125ms
```

### Look-ahead Scheduling

The step sequencer uses **look-ahead scheduling** to ensure precise timing despite JavaScript's unreliable timers:

```javascript
const LOOK_AHEAD = 0.025;      // Check every 25ms
const SCHEDULE_AHEAD = 0.1;    // Schedule 100ms ahead

function scheduler() {
  while (nextStepTime < audioContext.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(nextStepTime);
    advanceStep();
  }
  setTimeout(scheduler, LOOK_AHEAD * 1000);
}
```

**Why this matters:** `setTimeout` can drift 10-50ms. Scheduling on `AudioContext.currentTime` is sample-accurate.

---

## 4. Web Audio API Essentials

### AudioContext

- One per document (expensive resource)
- States: `suspended`, `running`, `closed`
- Must resume on user gesture (browser policy)

```javascript
// iOS Safari compatibility
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
```

### Audio Nodes We Use

| Node | Purpose | Keyboardia Usage |
|------|---------|------------------|
| `OscillatorNode` | Generate waveforms | Synth instruments |
| `AudioBufferSourceNode` | Play samples | Drum samples, recordings |
| `GainNode` | Volume control | Per-voice, per-track, master |
| `BiquadFilterNode` | Low-pass filter | Synth tone shaping |
| `DynamicsCompressorNode` | Prevent clipping | Master bus |

### Oscillator Waveforms

| Waveform | Sound Character |
|----------|-----------------|
| `sine` | Pure, smooth |
| `square` | Hollow, retro |
| `sawtooth` | Rich, bright |
| `triangle` | Soft, mellow |

### Browser Autoplay Policy

Audio cannot start without user interaction:

```javascript
document.addEventListener('click', async () => {
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
});
```

**iOS Safari specifics:**
- Uses `webkitAudioContext` (older versions)
- May enter `interrupted` state during calls
- Requires touch event on some versions

---

## 5. Voice Management

### Voice Limiting

```javascript
const MAX_VOICES = 16;
```

**Why 16?** Balances polyphony with mobile performance. Prevents CPU overload when many steps trigger simultaneously.

### Voice Stealing

When at max voices, stop oldest voice to make room for new one. Implemented via:

```javascript
source.onended = () => {
  source.disconnect();
  gainNode.disconnect();
};
```

### Click Prevention

Abrupt volume changes cause audible clicks. Solution: **3ms fade ramps**

```javascript
const FADE_TIME = 0.003;
const MIN_GAIN_VALUE = 0.0001;

// Instead of instant gain change:
gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN_VALUE, audioContext.currentTime + FADE_TIME);
```

---

## 6. Filter Basics

The synth engine uses a **low-pass filter** controlled by cutoff frequency.

### Filter Behavior

- **Low cutoff** (200-500 Hz): Muffled, dark tone
- **High cutoff** (2000+ Hz): Bright, full tone
- **Resonance (Q)**: Peak at cutoff frequency for emphasis

### Web Audio Filter Types

| Type | Effect |
|------|--------|
| `lowpass` | Removes highs (currently used) |
| `highpass` | Removes lows |
| `bandpass` | Keeps only a frequency range |

---

## 7. ADSR Envelope

The synth uses ADSR (Attack, Decay, Sustain, Release) to shape volume over time:

```
     Decay
      /\
     /  \______ Sustain
    /          \
   /            \ Release
Attack           \___
```

### Current Implementation

| Parameter | Typical Value | Effect |
|-----------|---------------|--------|
| Attack | 0.01s | Time to reach peak |
| Decay | 0.1s | Time to fall to sustain |
| Sustain | 0.7 | Held level (0-1) |
| Release | 0.3s | Fade after note off |

### Preset Characters

| Preset | Attack | Decay | Sustain | Release | Sound |
|--------|--------|-------|---------|---------|-------|
| Bass | 0.01 | 0.1 | 0.8 | 0.2 | Punchy, sustained |
| Pluck | 0.001 | 0.2 | 0 | 0.1 | Sharp, no sustain |
| Pad | 0.3 | 0.2 | 0.7 | 0.5 | Slow swell, ambient |

---

## 8. Key Constants Reference

### Time Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `FADE_TIME` | 3 ms | Click prevention |
| Latency target | < 20 ms | Responsive feel |
| Look-ahead | 25 ms | Scheduler check interval |
| Schedule ahead | 100 ms | Audio scheduling buffer |

### Level Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `ENVELOPE_PEAK` | 0.85 | Below clipping |
| `MIN_GAIN_VALUE` | 0.0001 | For exponential ramps |
| Compressor threshold | -6 dB | Start gain reduction |

### Limits

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_VOICES` | 16 | Polyphony limit |
| `MAX_STEPS` | 64 | Maximum pattern length |
| Tempo range | 60-180 BPM | Musical range |
| Swing range | 0-66% | Groove feel |

---

## 9. Internal Reference: Frequency Guide for Preset Design

Not exposed to users, but essential for designing synth presets that sound good.

### Frequency Spectrum Cheat Sheet

| Range | Frequencies | Character | Preset Implications |
|-------|-------------|-----------|---------------------|
| **Sub-bass** | 20-60 Hz | Feel, rumble | `sub` preset lives here |
| **Bass** | 60-250 Hz | Warmth, body | `bass`, `discobass` fundamentals |
| **Low-mids** | 250-500 Hz | **Muddy zone** | Cut here to add clarity |
| **Midrange** | 500-2000 Hz | Presence, note definition | Where melodies live |
| **Upper-mids** | 2-4 kHz | Clarity, cut-through | Boost for `lead` to stand out |
| **Presence** | 4-6 kHz | Attack, definition | Percussive synths need this |
| **Brilliance** | 6-20 kHz | Air, sparkle | `shimmer`, `bell` presets |

### Filter Cutoff Guidelines for Presets

| Cutoff | Sound | Use For |
|--------|-------|---------|
| 200-400 Hz | Very dark, subby | `sub` (200 Hz) |
| 500-800 Hz | Muffled, warm | `acid` (600 Hz) — squelchy |
| 900-1500 Hz | Full but controlled | `bass` (900 Hz), `funkbass` (1200 Hz) |
| 2000-3500 Hz | Present, clear | `lead` (2500 Hz), `pluck` (3500 Hz) |
| 4000-6000 Hz | Bright, open | `clavinet` (4000 Hz), `organ` (4000 Hz) |
| 6000+ Hz | Airy, shimmery | `shimmer` (6000 Hz), `bell` (8000 Hz) |

### Why Our `acid` Preset Sounds Squelchy

```javascript
acid: {
  filterCutoff: 600,      // Low cutoff = dark starting point
  filterResonance: 16,    // High resonance = peak at cutoff
  // ...
}
```

The 600 Hz cutoff with resonance 16 creates a resonant peak in the low-mids. This is the classic TB-303 sound. In Phase 19, adding a filter *envelope* would let this sweep upward on each note.

---

## 10. Internal Reference: Compression Tuning

Our current compressor settings prioritize safety over punch. Here's the theory if we want to experiment.

### Attack Time Trade-offs

| Attack | Effect | Our Setting |
|--------|--------|-------------|
| < 5 ms | Catches all transients, can sound "flat" | |
| **3 ms** | Fast, safe, slight punch reduction | **Current** |
| 10-30 ms | Lets transients through, then compresses | More punchy |
| > 50 ms | Transients fully pass, only sustain compressed | Maximum punch |

**Consideration:** Our 3ms attack is very fast. Drums might sound punchier with 10-20ms attack, allowing the initial transient to pass before compression kicks in.

### Release Time Trade-offs

| Release | Effect | Our Setting |
|---------|--------|-------------|
| < 100 ms | Fast recovery, can cause "pumping" | |
| **250 ms** | Medium, smooth | **Current** |
| > 500 ms | Slow, "glues" sounds together | |

### Ratio Guidelines

| Ratio | Use Case | Our Setting |
|-------|----------|-------------|
| 2:1 | Gentle, transparent | |
| **4:1** | Moderate, safe | **Current** |
| 8:1+ | Heavy limiting | |

**Our choice (4:1):** Safe for preventing clipping when 8+ tracks play simultaneously. More aggressive than transparent, less squashed than limiting.

### Potential Experiment

If drums feel "flat," try:
```javascript
attack: 0.015,   // 15ms - let transient through
release: 0.25,   // Keep current
ratio: 4,        // Keep current
```

---

## 11. Internal Reference: Phase 19 Formulas

For when we implement reverb and delay effects.

### Delay Time Sync to Tempo

```javascript
// Delay time in milliseconds, synced to BPM
function delayTimeMs(bpm, division) {
  const quarterNote = 60000 / bpm;

  // Division: 1 = quarter, 2 = eighth, 4 = sixteenth, 0.5 = half
  return quarterNote / division;
}

// Examples at 120 BPM:
// Quarter note delay: 500ms
// Eighth note delay:  250ms
// Dotted eighth:      375ms (quarterNote * 0.75)
// Sixteenth:          125ms
```

**Why sync matters:** Unsynced delays sound messy. Synced delays create rhythmic echoes that reinforce the beat.

### Reverb Parameter Guidelines

| Parameter | Small Room | Large Hall | Notes |
|-----------|------------|------------|-------|
| Pre-delay | 10-20 ms | 40-80 ms | Separation from dry signal |
| Decay | 0.3-0.6s | 1.5-3s | RT60 time |
| Damping | High | Low | High = darker tail |
| Mix | 15-25% | 10-20% | Less for larger spaces |

**Pre-delay insight:** Without pre-delay, reverb smears the attack. 20-50ms pre-delay keeps the initial transient clear, then adds space.

### Filter Envelope (Phase 19)

Currently our filter cutoff is static. A filter envelope would modulate it over time:

```javascript
// Conceptual - not yet implemented
filterEnvelope: {
  attack: 0.01,      // Time to reach peak cutoff
  decay: 0.2,        // Time to fall to sustain
  sustain: 0.3,      // Sustain level (0-1, multiplied by cutoff range)
  release: 0.1,      // Release time
  amount: 4000,      // Hz range to sweep (e.g., 600 → 4600 Hz)
}
```

This would make `acid` preset sweep from 600 Hz up to 4600 Hz on each note attack, creating the classic "wow" sound.

---

## 12. Internal Reference: Debugging Audio Issues

### Latency Debugging

If users report "lag," understand the sources:

```
Total Latency = Buffer Latency + Scheduling Latency + Network Latency (multiplayer)

Buffer Latency = Buffer Size / Sample Rate × 1000
               = 256 / 44100 × 1000
               = 5.8 ms (minimum, browser-controlled)

Scheduling Latency = How far ahead we schedule
                   = ~100 ms (our SCHEDULE_AHEAD)

Network Latency = RTT / 2 (multiplayer only)
                = Variable, typically 20-100 ms
```

**Key insight:** Our 100ms scheduling look-ahead is the dominant source of latency for local playback. This is necessary for timing accuracy but means there's always ~100ms between "step should play" and "audio starts."

### Audio Artifacts Checklist

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Clicks/pops | Missing fade ramps | Ensure FADE_TIME on start/stop |
| Distortion | Clipping | Check compressor is connected |
| Silence | AudioContext suspended | Call resume() on user gesture |
| Timing drift | Using setTimeout directly | Use AudioContext.currentTime |
| Memory growth | Nodes not disconnected | Add onended cleanup |

### Sample Rate / Aliasing

If recorded samples sound "metallic" or have artifacts:

```
Nyquist frequency = Sample Rate / 2
                  = 44100 / 2
                  = 22050 Hz

Frequencies above 22050 Hz will "fold back" and create artifacts.
```

Most recordings are fine, but very high-pitched sounds on low-quality devices could alias.

---

## 13. Internal Reference: Mono Compatibility

Even without stereo features, this matters for playback quality.

### Why Mono Matters

| Playback System | Behavior |
|-----------------|----------|
| Phone speakers | Mono (single driver) |
| Bluetooth speakers | Often mono or narrow stereo |
| Club PA systems | Bass is summed to mono |
| Laptop speakers | Narrow stereo, nearly mono |

### Current Implementation (Correct)

Our samples and synths output **mono**, which is actually ideal:
- No phase cancellation when summed
- Consistent on all playback systems
- Lower CPU usage

### Future Consideration: If We Add Stereo

If Phase 19 adds stereo samples or stereo effects:

```javascript
// Keep bass frequencies mono (< 150 Hz)
// Only spread higher frequencies in stereo

// Bad: Full stereo bass (disappears on phone speakers)
// Good: Mono bass, stereo highs (sounds good everywhere)
```

---

## Sources

### Web Audio API
- [MDN - Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MDN - Autoplay Guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN - Web Audio API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)

### Synthesis & Envelopes
- [Native Instruments - ADSR Explained](https://blog.native-instruments.com/adsr-explained/)
- [EDMProd - ADSR Envelopes](https://www.edmprod.com/adsr-envelopes/)

### Timing & Scheduling
- [Boris Smus - Web Audio API Book](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch01.html)

### Compression & Dynamics
- [iZotope - Audio Dynamics 101](https://www.izotope.com/en/learn/audio-dynamics-101-compressors-limiters-expanders-and-gates.html)
- [Universal Audio - Audio Compression Basics](https://www.uaudio.com/blogs/ua/audio-compression-basics)

### Frequency & EQ
- [iZotope - EQ Fundamentals](https://www.izotope.com/en/learn/eq-101-everything-you-need-to-know-about-eq.html)

---

*Filtered for Keyboardia's UI philosophy: direct manipulation, immediate feedback, grid-based simplicity. Internal reference sections included for preset design, debugging, and future phase planning.*
