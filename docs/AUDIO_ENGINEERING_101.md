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

---

## What's NOT in This Document

The following audio engineering topics were researched but **excluded** because they don't align with Keyboardia's philosophy of grid-based simplicity:

| Topic | Why Excluded |
|-------|--------------|
| EQ frequency ranges | No per-track EQ controls exposed |
| Mixing/panning techniques | No mixing interface (violates simplicity) |
| LUFS/loudness standards | Not distributing to streaming platforms |
| Reverb/delay parameters | Not yet implemented; when added, won't expose knobs |
| Compressor type selection | Use built-in DynamicsCompressorNode |
| Buffer size optimization | Browser handles this automatically |
| Stereo imaging | No panning controls |
| Mastering practices | Not a mastering tool |

These topics may become relevant if Keyboardia adds an "Advanced Synthesis Engine" (Phase 19), but any controls would follow the UI philosophy: **inline, immediate, no menus**.

---

*Filtered for Keyboardia's UI philosophy: direct manipulation, immediate feedback, grid-based simplicity.*
