# Unified Audio Bus Architecture

> **Status:** Proposed
> **Phase:** 25A (after Volume P-Lock Fix)
> **Priority:** High - Architectural debt causing inconsistent behavior

## Problem Statement

The audio engine has five separate play methods that evolved independently, resulting in:

1. **Inconsistent audio routing** - Only `playSample` routes through per-track gain nodes
2. **Broken track-level volume** - Synths bypass `trackGains` entirely
3. **Dead code** - `track.volume` field exists but has no UI and is never applied
4. **Redundant volume logic** - Both `setTrackVolume` AND per-note volume exist
5. **Inconsistent APIs** - Different parameter orders, different pitch representations

### Evidence of the Problem

The Volume P-Lock bug (Phase 25 fix) required identical changes to 5 different code paths because there's no unified abstraction.

---

## Current State Analysis

### The Five Play Methods

| Method | Source Type | Audio Chain |
|--------|-------------|-------------|
| `playSample` | AudioBuffer (procedural drums) | source → envGain → **trackGain** → masterGain → effects |
| `playSynthNote` | Web Audio oscillators | oscillator → filter → gain → **masterGain** directly |
| `playToneSynth` | Tone.js synths (FM, AM, etc.) | synth → output → **effects** directly |
| `playAdvancedSynth` | Tone.js dual-osc | synth → output → **effects** directly |
| `playSampledInstrument` | Multi-sample instruments | source → gain → **masterGain** directly |

### Current Parameter Signatures

```typescript
// Inconsistent parameter ordering and naming
playSample(sampleId, trackId, time, duration, playbackMode, pitch, volume)
playSynthNote(noteId, preset, semitone, time, duration, volume)
playToneSynth(preset, semitone, time, duration, volume)
playAdvancedSynth(preset, semitone, time, duration, volume)
playSampledInstrument(instrumentId, noteId, midiNote, time, duration, volume)
```

### Feature Matrix (Current)

| Feature | playSample | playSynthNote | playToneSynth | playAdvancedSynth | playSampledInstrument |
|---------|------------|---------------|---------------|-------------------|----------------------|
| Track gain routing | ✅ | ❌ | ❌ | ❌ | ❌ |
| Track volume control | ✅ | ❌ | ❌ | ❌ | ❌ |
| P-lock volume | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gate/Oneshot mode | ✅ | ❌ | ❌ | ❌ | ❌ |
| Voice management | ❌ | ✅ | ❌ | ❌ | ✅ |
| Stop note | ❌ | ✅ | ❌ | ❌ | ❌ |

### Root Cause

Each audio source type was added incrementally:
1. Phase 1: `playSample` for procedural drums (with trackGains)
2. Phase 1: `playSynthNote` for real-time synths (connected directly to masterGain)
3. Phase 22: `playToneSynth` and `playAdvancedSynth` (connected to effects chain)
4. Phase 22: `playSampledInstrument` (connected to masterGain)

No one unified the routing architecture as new sources were added.

---

## Proposed Solution: Unified Audio Bus

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AUDIO SOURCES                                  │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│ playSample  │playSynthNote│playToneSynth│playAdvanced │playSampledInstr │
│ (buffers)   │(Web Audio)  │ (Tone.js)   │ (Tone.js)   │ (multi-sample)  │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────────┬────────┘
       │             │             │             │               │
       └──────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      UNIFIED TRACK BUS (NEW)                             │
│                                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐      ┌────────────┐     │
│  │ Track 1    │  │ Track 2    │  │ Track 3    │ ...  │ Track N    │     │
│  │ GainNode   │  │ GainNode   │  │ GainNode   │      │ GainNode   │     │
│  │ vol: 0.8   │  │ vol: 1.0   │  │ vol: 0.5   │      │ vol: 0.7   │     │
│  │ muted: F   │  │ muted: T   │  │ muted: F   │      │ muted: F   │     │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘      └─────┬──────┘     │
│        │               │               │                   │            │
│        └───────────────┴───────┬───────┴───────────────────┘            │
│                                │                                         │
└────────────────────────────────┼─────────────────────────────────────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │   masterGain   │
                        └───────┬────────┘
                                │
                                ▼
                        ┌────────────────┐
                        │  Effects Chain │
                        │ (reverb, delay)│
                        └───────┬────────┘
                                │
                                ▼
                        ┌────────────────┐
                        │  Compressor    │
                        └───────┬────────┘
                                │
                                ▼
                        ┌────────────────┐
                        │  Destination   │
                        │  (speakers)    │
                        └────────────────┘
```

### Key Design Decisions

#### 1. Unified Note Parameters Interface

```typescript
/**
 * Common parameters for all note playback.
 * All play methods accept this interface.
 */
interface NoteParams {
  /** Absolute AudioContext time to start playback */
  time: number;

  /** Duration in seconds */
  duration: number;

  /** Pitch offset in semitones from C4 (0 = C4, 12 = C5, -12 = C3) */
  pitch: number;

  /** Volume multiplier from P-lock (0-1, default 1) */
  volume: number;

  /** Playback mode - oneshot plays full sample, gate cuts at duration */
  playbackMode?: 'oneshot' | 'gate';

  /** Optional unique ID for voice management (stop/steal) */
  noteId?: string;
}
```

#### 2. Track Bus Manager

```typescript
/**
 * Manages per-track gain nodes for all audio sources.
 * Ensures ALL audio routes through track-level volume control.
 */
class TrackBusManager {
  private trackBuses: Map<string, TrackBus> = new Map();
  private masterGain: GainNode;

  /**
   * Get or create a track bus for routing audio.
   * All audio sources MUST route through this.
   */
  getTrackBus(trackId: string): TrackBus {
    let bus = this.trackBuses.get(trackId);
    if (!bus) {
      bus = new TrackBus(this.audioContext, this.masterGain);
      this.trackBuses.set(trackId, bus);
    }
    return bus;
  }

  /**
   * Set track volume (from UI or state).
   * Affects all audio routed through this track.
   */
  setTrackVolume(trackId: string, volume: number): void {
    const bus = this.trackBuses.get(trackId);
    if (bus) bus.setVolume(volume);
  }

  /**
   * Set track mute state.
   * When muted, gain is 0. When unmuted, restores previous volume.
   */
  setTrackMuted(trackId: string, muted: boolean): void {
    const bus = this.trackBuses.get(trackId);
    if (bus) bus.setMuted(muted);
  }
}

class TrackBus {
  private gainNode: GainNode;
  private volume: number = 1;
  private muted: boolean = false;

  constructor(context: AudioContext, destination: AudioNode) {
    this.gainNode = context.createGain();
    this.gainNode.connect(destination);
  }

  /** Get the input node for connecting audio sources */
  getInput(): GainNode {
    return this.gainNode;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (!this.muted) {
      this.gainNode.gain.value = volume;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.gainNode.gain.value = muted ? 0 : this.volume;
  }
}
```

#### 3. Updated Play Methods

Each play method will be updated to:
1. Accept `trackId` as first parameter (for routing)
2. Route through `TrackBusManager.getTrackBus(trackId)`
3. Apply per-note volume AFTER track routing

```typescript
// Example: Updated playSynthNote
playSynthNote(
  trackId: string,        // NEW: Required for track routing
  noteId: string,
  presetName: string,
  params: NoteParams
): void {
  // Get track bus for routing
  const trackBus = this.trackBusManager.getTrackBus(trackId);

  // Create voice and route through track bus
  const voice = new SynthVoice(this.audioContext, trackBus.getInput(), preset);

  // Apply per-note volume during playback
  voice.start(frequency, params.time, params.volume);
}
```

### Migration Strategy

#### Phase 1: Add Track Bus Infrastructure (Non-Breaking)

1. Create `TrackBusManager` class
2. Create `TrackBus` class
3. Add to `AudioEngine` initialization
4. Ensure Tone.js synths can connect to native Web Audio nodes

#### Phase 2: Route Synths Through Track Bus (Breaking)

1. Update `playSynthNote` to use track bus
2. Update `playToneSynth` to use track bus
3. Update `playAdvancedSynth` to use track bus
4. Update `playSampledInstrument` to use track bus

#### Phase 3: Standardize APIs

1. Create `NoteParams` interface
2. Update all play methods to accept standardized params
3. Deprecate old method signatures

#### Phase 4: Add Track Volume UI

1. Add track volume slider to TrackRow
2. Connect to `SET_TRACK_VOLUME` action
3. Sync with multiplayer

#### Phase 5: Remove Dead Code

1. Remove redundant `setTrackVolume` calls from scheduler
2. Clean up duplicate volume handling
3. Update tests

---

## Testing Strategy

### Unit Tests

#### 1. Track Bus Routing Tests (`src/audio/track-bus.test.ts`)

```typescript
describe('TrackBusManager', () => {
  describe('routing', () => {
    it('creates track bus on first access', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      const bus = manager.getTrackBus('track-1');
      expect(bus).toBeDefined();
      expect(bus.getInput()).toBeInstanceOf(GainNode);
    });

    it('returns same bus for same trackId', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      const bus1 = manager.getTrackBus('track-1');
      const bus2 = manager.getTrackBus('track-1');
      expect(bus1).toBe(bus2);
    });

    it('returns different buses for different trackIds', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      const bus1 = manager.getTrackBus('track-1');
      const bus2 = manager.getTrackBus('track-2');
      expect(bus1).not.toBe(bus2);
    });
  });

  describe('volume control', () => {
    it('setTrackVolume affects all audio on that track', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      const bus = manager.getTrackBus('track-1');
      manager.setTrackVolume('track-1', 0.5);
      expect(bus.getInput().gain.value).toBe(0.5);
    });

    it('setTrackMuted sets gain to 0', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      manager.setTrackVolume('track-1', 0.8);
      manager.setTrackMuted('track-1', true);
      expect(manager.getTrackBus('track-1').getInput().gain.value).toBe(0);
    });

    it('unmuting restores previous volume', () => {
      const manager = new TrackBusManager(audioContext, masterGain);
      manager.setTrackVolume('track-1', 0.8);
      manager.setTrackMuted('track-1', true);
      manager.setTrackMuted('track-1', false);
      expect(manager.getTrackBus('track-1').getInput().gain.value).toBe(0.8);
    });
  });
});
```

#### 2. Audio Routing Verification Tests (`src/audio/routing-verification.test.ts`)

```typescript
/**
 * These tests verify ALL audio sources route through track buses.
 * This prevents regression to the pre-unification state.
 */
describe('Audio Routing Verification', () => {
  // Mock AudioContext that tracks connections
  const connectionTracker = new ConnectionTracker();

  beforeEach(() => {
    connectionTracker.reset();
  });

  describe('all sources route through track bus', () => {
    it('playSample routes through track bus', async () => {
      await audioEngine.playSample('kick', 'track-1', now, 0.1, 'oneshot', 0, 1);
      expect(connectionTracker.hasPath('track-1-bus', 'masterGain')).toBe(true);
    });

    it('playSynthNote routes through track bus', async () => {
      await audioEngine.playSynthNote('track-2', 'note-1', 'bass', { time: now, duration: 0.1, pitch: 0, volume: 1 });
      expect(connectionTracker.hasPath('track-2-bus', 'masterGain')).toBe(true);
    });

    it('playToneSynth routes through track bus', async () => {
      await audioEngine.playToneSynth('track-3', 'fm-epiano', { time: now, duration: 0.1, pitch: 0, volume: 1 });
      expect(connectionTracker.hasPath('track-3-bus', 'masterGain')).toBe(true);
    });

    it('playAdvancedSynth routes through track bus', async () => {
      await audioEngine.playAdvancedSynth('track-4', 'supersaw', { time: now, duration: 0.1, pitch: 0, volume: 1 });
      expect(connectionTracker.hasPath('track-4-bus', 'masterGain')).toBe(true);
    });

    it('playSampledInstrument routes through track bus', async () => {
      await audioEngine.playSampledInstrument('track-5', 'piano', 'note-1', { time: now, duration: 0.1, pitch: 0, volume: 1 });
      expect(connectionTracker.hasPath('track-5-bus', 'masterGain')).toBe(true);
    });
  });

  describe('track volume affects all sources', () => {
    for (const sourceType of ['sample', 'synth', 'toneSynth', 'advancedSynth', 'sampledInstrument']) {
      it(`track volume affects ${sourceType}`, async () => {
        audioEngine.setTrackVolume('track-1', 0.5);
        const bus = audioEngine.getTrackBus('track-1');
        expect(bus.getInput().gain.value).toBe(0.5);
      });
    }
  });
});
```

#### 3. Volume Multiplication Tests (`src/audio/volume-multiplication.test.ts`)

```typescript
describe('Volume Multiplication', () => {
  it('final volume = trackVolume × pLockVolume', () => {
    // Track volume at 0.8, P-lock at 0.5
    // Expected: 0.8 × 0.5 = 0.4
    audioEngine.setTrackVolume('track-1', 0.8);
    const pLockVolume = 0.5;

    // The note should play at effective volume 0.4
    // This is verified by checking the gain node values in the audio chain
  });

  it('muted track produces no audio regardless of note volume', () => {
    audioEngine.setTrackVolume('track-1', 1.0);
    audioEngine.setTrackMuted('track-1', true);

    // Even with full note volume, muted track should output 0
    const bus = audioEngine.getTrackBus('track-1');
    expect(bus.getInput().gain.value).toBe(0);
  });
});
```

### Integration Tests

#### 1. Scheduler Integration (`test/integration/scheduler-routing.test.ts`)

```typescript
describe('Scheduler Audio Routing Integration', () => {
  it('scheduler correctly routes all track types through track bus', async () => {
    const state = createTestState([
      { id: 'track-1', sampleId: 'kick', steps: [true, false] },
      { id: 'track-2', sampleId: 'synth:bass', steps: [true, false] },
      { id: 'track-3', sampleId: 'tone:fm-epiano', steps: [true, false] },
      { id: 'track-4', sampleId: 'advanced:supersaw', steps: [true, false] },
      { id: 'track-5', sampleId: 'sampled:piano', steps: [true, false] },
    ]);

    scheduler.start(() => state);
    await waitForStep(1);
    scheduler.stop();

    // Verify all tracks used their track bus
    for (const track of state.tracks) {
      expect(audioEngine.getTrackBus(track.id)).toBeDefined();
    }
  });

  it('track volume changes affect playback immediately', async () => {
    const state = createTestState([
      { id: 'track-1', sampleId: 'kick', steps: [true, true, true, true] },
    ]);

    scheduler.start(() => state);

    // Change volume mid-playback
    await waitForStep(2);
    audioEngine.setTrackVolume('track-1', 0.3);

    // Verify volume changed
    const bus = audioEngine.getTrackBus('track-1');
    expect(bus.getInput().gain.value).toBe(0.3);

    scheduler.stop();
  });
});
```

#### 2. Multiplayer Volume Sync (`test/integration/multiplayer-volume.test.ts`)

```typescript
describe('Multiplayer Volume Sync', () => {
  it('SET_TRACK_VOLUME syncs between clients', async () => {
    const { client1, client2 } = await setupMultiplayerSession();

    // Client 1 changes track volume
    client1.dispatch({ type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: 0.6 });

    // Wait for sync
    await waitForSync();

    // Client 2 should see the change
    expect(client2.getState().tracks[0].volume).toBe(0.6);
  });

  it('volume change triggers audio engine update', async () => {
    const { client1 } = await setupMultiplayerSession();

    client1.dispatch({ type: 'SET_TRACK_VOLUME', trackId: 'track-1', volume: 0.7 });

    // Audio engine should reflect the change
    expect(audioEngine.getTrackBus('track-1').getInput().gain.value).toBe(0.7);
  });
});
```

### End-to-End Tests

#### 1. Playwright Volume Tests (`test/e2e/volume.spec.ts`)

```typescript
test.describe('Track Volume', () => {
  test('track volume slider affects playback', async ({ page }) => {
    await page.goto('/s/test-session');

    // Find track volume slider
    const volumeSlider = page.locator('[data-testid="track-1-volume-slider"]');

    // Set volume to 50%
    await volumeSlider.fill('50');

    // Play and verify (this would need audio capture or visual indicator)
    await page.click('[data-testid="play-button"]');

    // Check audio meter shows reduced volume
    const meterValue = await page.locator('[data-testid="track-1-meter"]').getAttribute('data-level');
    expect(parseFloat(meterValue!)).toBeLessThan(1);
  });

  test('mute button silences track', async ({ page }) => {
    await page.goto('/s/test-session');

    // Mute track
    await page.click('[data-testid="track-1-mute-button"]');

    // Verify visual mute indicator
    await expect(page.locator('[data-testid="track-1-muted-indicator"]')).toBeVisible();
  });
});
```

### Regression Prevention

#### 1. Automated Invariant Checks

Add to the existing bug pattern analyzer:

```typescript
// scripts/analyze-audio-routing.ts

/**
 * Scans for audio connections that bypass track bus.
 * Run as part of pre-commit hook.
 */
function detectBypassedRouting(): BugPatternResult[] {
  const violations: BugPatternResult[] = [];

  // Pattern: Direct connection to masterGain from synth
  const directMasterConnections = grep(
    /\.connect\(.*masterGain/,
    ['src/audio/synth.ts', 'src/audio/toneSynths.ts', 'src/audio/advancedSynth.ts', 'src/audio/sampled-instrument.ts']
  );

  for (const match of directMasterConnections) {
    // Whitelist: TrackBus connecting to masterGain is OK
    if (!match.context.includes('TrackBus')) {
      violations.push({
        severity: 'high',
        pattern: 'direct-master-connection',
        file: match.file,
        line: match.line,
        message: 'Audio source connected directly to masterGain, bypassing track bus',
        fix: 'Route through TrackBusManager.getTrackBus(trackId).getInput()'
      });
    }
  }

  return violations;
}
```

#### 2. Type-Level Enforcement

```typescript
// src/audio/types.ts

/**
 * All play methods MUST accept trackId.
 * This type enforces the unified routing requirement.
 */
type PlayMethodSignature<TParams extends NoteParams> = (
  trackId: string,  // Required first param
  ...args: unknown[]
) => void;

// Compile-time check that all methods match
type AssertPlaySample = PlayMethodSignature<NoteParams> extends typeof audioEngine.playSample ? true : never;
type AssertPlaySynth = PlayMethodSignature<NoteParams> extends typeof audioEngine.playSynthNote ? true : never;
// ... etc
```

---

## Tools to Build

### 1. Audio Routing Visualizer (`scripts/visualize-audio-routing.ts`)

A debug tool that outputs the current audio graph:

```typescript
/**
 * Generates a Mermaid diagram of the current audio routing.
 * Useful for debugging and documentation.
 *
 * Usage: npx tsx scripts/visualize-audio-routing.ts
 */
function generateAudioGraph(): string {
  const nodes: string[] = [];
  const edges: string[] = [];

  // Enumerate all track buses
  for (const [trackId, bus] of trackBusManager.getAllBuses()) {
    nodes.push(`  ${trackId}[Track: ${trackId}]`);
    edges.push(`  ${trackId} --> masterGain`);
  }

  // Add master chain
  nodes.push('  masterGain[Master Gain]');
  nodes.push('  effects[Effects Chain]');
  nodes.push('  compressor[Compressor]');
  nodes.push('  destination[Speakers]');

  edges.push('  masterGain --> effects');
  edges.push('  effects --> compressor');
  edges.push('  compressor --> destination');

  return `graph TD\n${nodes.join('\n')}\n${edges.join('\n')}`;
}
```

### 2. Volume Flow Inspector (`scripts/inspect-volume-flow.ts`)

Debug tool to trace volume through the chain:

```typescript
/**
 * Traces volume multiplication through the audio chain.
 *
 * Usage: npx tsx scripts/inspect-volume-flow.ts track-1
 */
function inspectVolumeFlow(trackId: string): void {
  const state = getAppState();
  const track = state.tracks.find(t => t.id === trackId);

  console.log(`Volume Flow for ${trackId}:`);
  console.log(`  Track volume (state): ${track?.volume ?? 1}`);
  console.log(`  Track bus gain: ${audioEngine.getTrackBus(trackId).getInput().gain.value}`);
  console.log(`  Master gain: ${audioEngine.getMasterGain().gain.value}`);
  console.log(`  Effective output: ${(track?.volume ?? 1) * audioEngine.getMasterGain().gain.value}`);

  // Show P-lock volumes for active steps
  if (track) {
    const pLocks = track.parameterLocks.filter(p => p?.volume !== undefined);
    if (pLocks.length > 0) {
      console.log(`  P-lock volumes: ${pLocks.map((p, i) => `step ${i}: ${p?.volume}`).join(', ')}`);
    }
  }
}
```

### 3. Track Bus Monitor Component (`src/components/debug/TrackBusMonitor.tsx`)

Development UI component for monitoring track buses in real-time:

```typescript
/**
 * Debug panel showing real-time track bus state.
 * Only rendered in development mode.
 */
function TrackBusMonitor(): JSX.Element {
  const [buses, setBuses] = useState<Map<string, BusState>>(new Map());

  useEffect(() => {
    const interval = setInterval(() => {
      const busStates = new Map();
      for (const [id, bus] of audioEngine.getAllTrackBuses()) {
        busStates.set(id, {
          volume: bus.getInput().gain.value,
          muted: bus.isMuted(),
          peakLevel: bus.getPeakLevel(),  // If we add metering
        });
      }
      setBuses(busStates);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="track-bus-monitor">
      <h3>Track Buses</h3>
      {Array.from(buses.entries()).map(([id, state]) => (
        <div key={id} className="bus-row">
          <span>{id}</span>
          <meter value={state.volume} max={1} />
          <span>{state.muted ? '🔇' : '🔊'}</span>
        </div>
      ))}
    </div>
  );
}
```

### 4. Audio Connection Linter (Pre-commit Hook)

Add to existing pre-commit:

```bash
# .husky/pre-commit
# ... existing checks ...

# Check for audio routing violations
echo "Checking audio routing patterns..."
npx tsx scripts/analyze-audio-routing.ts
if [ $? -ne 0 ]; then
  echo "❌ Audio routing violations detected!"
  exit 1
fi
```

---

## Success Criteria

### Functional Requirements

- [ ] All five play methods route through track bus
- [ ] Track volume slider controls all track audio (samples AND synths)
- [ ] Track mute affects all track audio
- [ ] P-lock volume still works (multiplied with track volume)
- [ ] No audio routing bypasses track bus

### Non-Functional Requirements

- [ ] No audible difference for existing sessions (backwards compatible)
- [ ] No increase in audio latency
- [ ] Memory usage stable (no leaked track buses)
- [ ] All existing tests pass
- [ ] New routing tests pass

### Verification Checklist

1. [ ] Create session with all 5 track types
2. [ ] Set different track volumes for each
3. [ ] Verify volume differences are audible
4. [ ] Mute each track, verify silence
5. [ ] Add P-locks, verify they multiply with track volume
6. [ ] Multiplayer: verify volume syncs between clients
7. [ ] Run full test suite (unit + integration + e2e)
8. [ ] Run audio routing analyzer (no violations)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tone.js can't connect to native GainNode | Medium | High | Test during Phase 1, have fallback plan |
| Audio latency increases | Low | Medium | Benchmark before/after, optimize if needed |
| Existing sessions sound different | Low | High | Extensive A/B testing before release |
| Breaking API changes | High | Medium | Staged rollout, deprecation warnings |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| 1. Infrastructure | 2-3 hours | None |
| 2. Route Synths | 3-4 hours | Phase 1 |
| 3. Standardize APIs | 2-3 hours | Phase 2 |
| 4. Track Volume UI | 2-3 hours | Phase 2 |
| 5. Cleanup | 1-2 hours | Phase 3 |
| Testing | 3-4 hours | All phases |
| **Total** | **13-19 hours** | |

---

## References

- [BUG-PATTERNS.md](../docs/BUG-PATTERNS.md) - Pattern #3: Computed Value Logged But Not Used
- [SYNTHESIS-ENGINE.md](./SYNTHESIS-ENGINE.md) - Current synth architecture
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - Native audio routing
- [Tone.js Connections](https://tonejs.github.io/docs/14.7.77/Tone#toDestination) - Tone.js → Web Audio bridging
