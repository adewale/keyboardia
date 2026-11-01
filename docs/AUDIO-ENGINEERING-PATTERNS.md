# Audio Engineering Patterns & Pitfalls

This document captures common WebAudio and Tone.js patterns, pitfalls, and best practices learned from debugging audio issues in Keyboardia.

## Table of Contents

1. [disconnect() Does NOT Restore AudioParam Values](#1-disconnect-does-not-restore-audioparam-values)
2. [Voice Pooling vs Ephemeral Voices](#2-voice-pooling-vs-ephemeral-voices)
3. [Modulation Target Checklist](#3-modulation-target-checklist)
4. [AudioContext Lifecycle](#4-audiocontext-lifecycle)

---

## 1. disconnect() Does NOT Restore AudioParam Values

### The Problem

When you disconnect a modulation source (LFO, envelope, etc.) from an AudioParam, **the parameter retains whatever value it had at the moment of disconnection**. WebAudio does not have a concept of "restoring" the original value.

### Wrong Assumption

```typescript
// Developer expects: disconnect() restores gain to its original value
lfo.connect(gainNode.gain);  // gain is now controlled by LFO (oscillates 0.5-1.0)
lfo.disconnect();            // Developer thinks: gain is restored to 0.5
                             // Reality: gain stays at whatever the LFO left it (could be 0!)
```

### Correct Pattern

```typescript
lfo.connect(gainNode.gain);  // gain is now controlled by LFO
lfo.disconnect();            // Severs connection only
gainNode.gain.value = 0.5;   // MUST explicitly reset to expected value
```

### Real Bugs This Pattern Caused

**Bug 1: Amplitude LFO (tremolo-strings preset)**

**Issue:** Switching FROM the tremolo-strings preset (which uses `lfo.destination='amplitude'`) TO any other preset would silence the audio.

**Root cause:** The LFO connected to `output.gain` and modulated it between 0.75 and 1.0. When `lfo.disconnect()` was called, the gain was left at 0 (the value at the moment of disconnection). No explicit reset was performed.

**Bug 2: Pitch LFO (vibrato-lead, thick-lead presets)**

**Issue:** Switching FROM presets with `lfo.destination='pitch'` (vibrato-lead, thick-lead) TO presets with negative detune values (supersaw, warm-pad, etc.) would play wrong pitches.

**Root cause:** The LFO connected to `osc.detune` and when disconnected, left detune at 0 instead of the new preset's expected detune value.

**Fix:** Added explicit reset after disconnect:
```typescript
// advancedSynth.ts line 423-437
this.lfo.disconnect();

// IMPORTANT: WebAudio disconnect() does NOT restore AudioParam values!
if (this.output) {
  this.output.gain.value = 0.5;  // Reset for amplitude LFO
}
this.osc1.detune.value = preset.oscillator1.detune + ...;  // Reset for pitch LFO
this.osc2.detune.value = preset.oscillator2.detune + ...;  // Reset for pitch LFO
```

### Testing Strategy

Use auto-expanding parameterized tests that cover all preset-to-preset transitions:

```typescript
const presetNames = Object.keys(ADVANCED_SYNTH_PRESETS);
const allTransitions = presetNames.flatMap(from =>
  presetNames.filter(to => to !== from).map(to => [from, to])
);

it.each(allTransitions)('%s → %s: output.gain should be 0.5', (from, to) => {
  engine.setPreset(from);
  engine.setPreset(to);
  expect(output.gain.value).toBe(0.5);
});
```

This automatically expands when new presets are added, catching regressions.

---

## 2. Voice Pooling vs Ephemeral Voices

### Ephemeral Voices (synth.ts)

Each note creates a new voice instance that is disposed after playback:

```typescript
// Simplified pattern
const voice = new SynthVoice(params);
voice.play(frequency, duration);
// After note ends:
voice.dispose();
```

**Pros:**
- Fresh state each time - no state management bugs
- Simple mental model
- LFO/modulation config is fixed for voice lifetime

**Cons:**
- GC pressure from frequent allocations
- Higher CPU overhead for complex voices

### Pooled Voices (advancedSynth.ts)

A fixed pool of voices is created at init and reused via `applyPreset()`:

```typescript
// At init time
for (let i = 0; i < 8; i++) {
  voices.push(new AdvancedSynthVoice());
}

// At play time
const voice = allocateVoice();
voice.applyPreset(currentPreset);  // Reconfigure for new preset
voice.triggerAttackRelease(frequency, duration);
```

**Pros:**
- Better performance (no allocations during playback)
- Lower GC pressure
- Good for complex voices with many nodes

**Cons:**
- Must carefully manage state transitions
- Every reconfigurable parameter must be explicitly reset
- More complex to reason about

### Rule for Pooled Voices

> When using pooled voices, **every parameter that can be modified by modulation must be explicitly reset** in the preset application code.

Create a checklist in `applyPreset()`:

```typescript
applyPreset(preset: Preset): void {
  // Disconnect all modulation sources first
  this.lfo.disconnect();

  // Reset ALL params that could have been modulated
  this.output.gain.value = 0.5;           // Amplitude LFO target
  this.osc1.detune.value = preset.osc1.detune;  // Pitch LFO target
  // filter.frequency handled by FrequencyEnvelope (always connected)

  // Now apply new preset settings
  // ...
}
```

---

## 3. Modulation Target Checklist

When implementing modulation (LFO, envelope, XY pad) that connects to AudioParams, complete this checklist:

### Design Phase
- [ ] Document which AudioParams can be modulated
- [ ] Define default/expected value for each modulatable param
- [ ] Decide: pooled vs ephemeral voices

### Implementation Phase
- [ ] After `disconnect()`, explicitly reset param to default value
- [ ] Add dev-mode validation (see `validateVoiceState()`)
- [ ] Comment the reset with rationale: `// WebAudio disconnect() doesn't restore values`

### Testing Phase
- [ ] Add transition tests covering all source→target combinations
- [ ] Use auto-expanding test generation (new presets auto-tested)
- [ ] Meta-test verifying expected transition count

### Code Review Checklist
- [ ] Every `disconnect()` followed by explicit value reset?
- [ ] Reset values match expected defaults?
- [ ] Tests cover all modulation destinations?

---

## 4. AudioContext Lifecycle

### Singleton Anti-Pattern

**Problem:** Module-level singletons cache Tone.js nodes across HMR (Hot Module Reload), causing "cannot connect to an AudioNode belonging to a different audio context" errors.

```typescript
// WRONG: Singleton survives HMR, nodes belong to stale AudioContext
let instance: AdvancedSynthEngine | null = null;
export function getAdvancedSynthEngine(): AdvancedSynthEngine {
  if (!instance) instance = new AdvancedSynthEngine();
  return instance;
}
```

**Solution:** Always create fresh instances:

```typescript
// CORRECT: Fresh instance gets nodes in current AudioContext
const engine = new AdvancedSynthEngine();
await engine.initialize();
```

### HMR Cleanup

Register cleanup handlers to dispose audio resources during development:

```typescript
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.dispose();
  });
}
```

### AudioContext Resume

The AudioContext starts suspended in browsers due to autoplay policy. Always resume after user gesture:

```typescript
async function initializeTone(): Promise<void> {
  await Tone.start();  // Resumes AudioContext
}

// Call from click handler
button.onclick = async () => {
  await initializeTone();
  // Now audio will work
};
```

---

## Related Files

- `src/audio/advancedSynth.ts` - Pooled voice implementation with validateVoiceState()
- `src/audio/advancedSynth.test.ts` - Auto-expanding transition tests
- `src/audio/synth.ts` - Ephemeral voice implementation
- `src/audio/audio-context-safety.test.ts` - AudioContext lifecycle tests
- `docs/BUG-PATTERNS.md` - Broader bug pattern documentation

---

## Change Log

- 2024-12-30: Initial document created after fixing tremolo-strings output.gain=0 bug
