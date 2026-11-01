# Playback Modes Research

Research on how professional samplers handle samples of varying durations.

## The Problem

At 120 BPM, each 16th-note step is ~0.125 seconds. But samples vary wildly:
- Kick drum: 0.2-0.5 seconds
- Snare: 0.3-0.8 seconds
- Hi-hat: 0.1-0.3 seconds
- User recordings: 0.5-10+ seconds

How should the sequencer handle a 2-second recording triggered on a 0.125-second step?

## Industry Solutions

### Teenage Engineering (PO-33, OP-1, OP-Z)
- **Default: One-shot** - samples play to completion
- Gate mode available but rarely used
- "Trig" mode for rhythmic chopping

### Elektron (Digitakt, Octatrack)
- **Default: One-shot** for most sample slots
- Amplitude envelope with hold/release for shaping
- "Trig length" parameter for gate-style behavior (optional)

### Ableton Live (Simpler, Drum Rack)
- **Default: One-shot** ("Trigger" mode)
- "Gate" mode plays only while note held
- Most drum kits use one-shot

### Roland (TR-8S, SP-404)
- **Default: One-shot** for drums
- Chromatic samples may use gate
- "Voice" mode for polyphony control

### Akai (MPC series)
- **Default: One-shot**
- "Note Off" option for gate behavior
- Pad modes: one-shot, note-on, toggle

## Consensus

**One-shot is the universal default** for drum machines and samplers because:
1. Drums are designed as complete sounds
2. Users expect the full sample to play
3. Gate mode cuts off transients unnaturally
4. Recordings are intentionally captured at their full length

Gate mode is reserved for:
- Sustained synth pads
- Drone sounds
- Samples where note-off behavior is desired

## Implementation Decision

Keyboardia uses **one-shot as the default** for all samples:

```typescript
type PlaybackMode = 'oneshot' | 'gate';

// In Track interface:
playbackMode: PlaybackMode; // Default: 'oneshot'
```

- **One-shot**: `source.start()` only - sample plays to completion
- **Gate**: `source.start()` + `source.stop(time + stepDuration)` - cuts at step boundary

## Future Considerations

### Choke Groups (Phase 3+)
Hi-hats typically "choke" each other - an open hi-hat is cut off when a closed hi-hat plays. This requires:
- Tracking active sources per choke group
- Stopping previous source when new one triggers

### Per-Track Toggle
UI could allow toggling playback mode per track for edge cases where gate behavior is desired.

### Envelope Shaping
More advanced: amplitude envelope (attack/decay/sustain/release) for fine-grained control over sample playback shape.

## References

- [Teenage Engineering PO-33 Guide](https://teenage.engineering/guides/po-33)
- [Elektron Digitakt Manual](https://www.elektron.se/support/?connection=digitakt)
- [Ableton Simpler Reference](https://www.ableton.com/en/manual/simpler/)
- [Akai MPC Manual](https://www.akaipro.com/support)
