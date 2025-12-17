# Debugging Lessons Learned

This document captures debugging knowledge from fixing bugs in the Keyboardia codebase. Each entry follows a structured format to maximize reusability.

## How to Use This Document

1. **When debugging**: Search this document by symptom to find similar issues
2. **After fixing a bug**: Add a new entry using the template below
3. **During code review**: Reference relevant patterns when reviewing changes
4. **Post-fix analysis**: Run the analysis tool to check for similar issues

## Quick Reference: Common Symptoms

| Symptom | Likely Pattern | Link |
|---------|----------------|------|
| "cannot connect to AudioNode" | AudioContext Mismatch | [#001](#001-audiocontext-mismatch-hmr) |
| Logs continue after stop | Stale State | [#002](#002-stale-state-after-stop) |
| No sound from instrument | Silent Instrument | [#003](#003-silent-instrument) |
| "not ready" warnings | Play Before Ready | [#004](#004-play-before-ready) |
| Solo'd tracks not playing | Solo State Bug | [#005](#005-solo-state-not-applied) |
| Works for synth: but not sampled: | Namespace Inconsistency | [#006](#006-namespace-prefix-inconsistency) |
| Bug reappears after fix | Fix Without Tests | [#007](#007-fix-without-tests-anti-pattern) |
| Piano silent when added mid-playback | Mid-Playback Preload | [#008](#008-mid-playback-sampled-instrument-not-preloaded) |

---

## Entry Template

```markdown
## #XXX: Bug Title

**Date**: YYYY-MM-DD
**Severity**: critical | high | medium | low
**Category**: audio-context | singleton | state-management | timing | memory-leak | race-condition | routing

### Symptoms
- What the user observes
- Error messages in console
- Behavioral anomalies

### Root Cause
Explanation of why the bug occurs.

### Detection Strategy
How to identify this bug:
- Log patterns to look for
- Code patterns that indicate the bug
- Runtime checks

### Fix
Summary of the fix.

```typescript
// Code example showing the fix
```

### Prevention
- How to prevent this bug in the future
- Tests to add
- Code review checks

### Related Files
- path/to/file1.ts
- path/to/file2.ts

### Post-Fix Analysis
Run after fixing to check for similar issues:
```bash
grep -r "pattern" src/
```
```

---

## Entries

---

## #001: AudioContext Mismatch (HMR)

**Date**: 2024-12-16
**Severity**: critical
**Category**: audio-context, singleton

### Symptoms
- `InvalidAccessError: cannot connect to an AudioNode belonging to a different audio context`
- Audio stops working after Hot Module Reload
- Works after full page refresh but breaks after code changes
- Tone.js effects/synths fail to connect

### Root Cause
Singleton patterns (`getEffectsChain()`, `getAdvancedSynthEngine()`) cache Tone.js nodes at module load time. During HMR:
1. A new AudioContext is created
2. `Tone.setContext()` is called with the new context
3. Singleton returns cached instance with OLD context nodes
4. Attempting to connect new nodes to old nodes throws

The key insight: **Tone.js nodes are bound to the AudioContext that existed when they were created**, not when they're used.

### Detection Strategy

**Log patterns:**
```
cannot connect to an AudioNode
different audio context
```

**Code patterns (risky):**
```typescript
// Singleton pattern for Tone.js components
let instance: ToneComponent | null = null;
export function getInstance() {
  if (!instance) instance = new ToneComponent();
  return instance;
}
```

**Runtime check:**
```typescript
const toneContext = Tone.getContext().rawContext;
if (toneContext !== audioEngine.audioContext) {
  // MISMATCH DETECTED
}
```

### Fix

Use fresh instances instead of singletons in the main engine initialization:

```typescript
// BAD: Singleton retains stale nodes across HMR
this.advancedSynth = getAdvancedSynthEngine();

// GOOD: Fresh instance in current context
this.advancedSynth = new AdvancedSynthEngine();
await this.advancedSynth.initialize();

// SAFEGUARD: Add verification
const toneContext = Tone.getContext().rawContext;
if (toneContext !== this.audioContext) {
  throw new Error('AudioContext mismatch detected!');
}
```

### Prevention
1. **Document risk levels**: Mark singletons that create Tone.js nodes as HIGH RISK
2. **Use fresh instances**: In engine.ts, always use `new ClassName()` for Tone.js components
3. **Add safeguard**: Verify context match at initialization
4. **Add tests**: See `audio-context-safety.test.ts`

### Related Files
- `src/audio/engine.ts` (line ~193: fixed to use `new AdvancedSynthEngine()`)
- `src/audio/toneEffects.ts` (singleton at bottom)
- `src/audio/advancedSynth.ts` (singleton at bottom)
- `src/audio/toneSynths.ts` (singleton at bottom)
- `src/audio/audio-context-safety.test.ts` (regression tests)

### Post-Fix Analysis
```bash
# Find all singleton patterns for Tone.js components
grep -rn "let.*Instance.*null" src/audio/
grep -rn "export function get.*().*{" src/audio/ | grep -v test
```

---

## #002: Stale State After Stop

**Date**: 2024-12-16
**Severity**: medium
**Category**: state-management, timing

### Symptoms
- "Playing" logs continue to appear after hitting stop
- UI playhead continues moving briefly after stop
- Memory usage grows over time during play/stop cycles

### Root Cause
The scheduler uses `setTimeout` for:
1. Delayed step change notifications (UI playhead)
2. Volume reset after parameter locks

When `stop()` is called, `isRunning` is set to `false`, but timers already scheduled continue to fire. The callbacks should check `isRunning` but some don't, or they fire during the brief window between `stop()` being called and the check.

### Detection Strategy

**Log patterns:**
```
Playing.*after.*stop
step.*change.*isRunning.*false
```

**Code patterns:**
```typescript
// Timer without tracking
setTimeout(() => { /* may fire after stop */ }, delay);

// Should be:
const timer = setTimeout(() => {
  this.pendingTimers.delete(timer);
  if (!this.isRunning) return; // Guard
  // ... actual work
}, delay);
this.pendingTimers.add(timer);
```

**Runtime invariant:**
```typescript
// After stop(), these should be true:
assert(isRunning === false);
assert(timerId === null);
assert(pendingTimers.size === 0);
```

### Fix

Track all pending timers and clear them on stop:

```typescript
private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

// When creating a timer
const timer = setTimeout(() => {
  this.pendingTimers.delete(timer);
  if (!this.isRunning) return; // Additional guard
  // ... callback logic
}, delay);
this.pendingTimers.add(timer);

// In stop()
stop(): void {
  this.isRunning = false;

  if (this.timerId !== null) {
    clearTimeout(this.timerId);
    this.timerId = null;
  }

  // Clear ALL pending timers
  for (const timer of this.pendingTimers) {
    clearTimeout(timer);
  }
  this.pendingTimers.clear();
}
```

### Prevention
1. **Always track timers**: Add to Set when created, remove in callback
2. **Add isRunning guards**: Check in callbacks before doing work
3. **Add invariants**: Use `assertPlaybackStopped()` after stop
4. **Test cleanup**: Verify pendingTimers.size === 0 after stop

### Related Files
- `src/audio/scheduler.ts` (timer tracking implementation)
- `src/audio/playback-state-debug.ts` (invariant checks)
- `src/audio/playback-state-debug.test.ts` (tests)

### Post-Fix Analysis
```bash
# Find setTimeout calls without tracking
grep -rn "setTimeout(" src/audio/ | grep -v pendingTimers | grep -v test
```

---

## #003: Silent Instrument

**Date**: 2024-12-16
**Severity**: high
**Category**: routing

### Symptoms
- Scheduler logs show note being scheduled ("Playing synth X at step Y")
- No sound is heard from that instrument
- No follow-up logs from engine or synth
- Other instruments work fine

### Root Cause
Multiple possible causes:
1. **Routing gap**: Engine method isn't called (code path issue)
2. **AudioContext suspended**: Context not in "running" state
3. **Gain at zero**: Track gain or master gain is 0
4. **Not initialized**: Component hasn't completed setup
5. **Wrong solo/mute state**: Track should play but isn't

### Detection Strategy

**Symptom: Logs show scheduling but no playback confirmation**
```
// You see:
Playing synth acid at step 6

// But you DON'T see:
playSynthNote: noteId=xxx
SynthEngine.playNote: noteId=xxx
Voice started: freq=xxx
```

**Runtime checks:**
```typescript
// Check context state
console.log(audioEngine.audioContext.state); // Should be "running"

// Check gain
console.log(audioEngine.masterGain.gain.value); // Should be > 0

// Check solo state
console.log(tracks.filter(t => t.soloed)); // Which tracks are soloed?
```

### Fix

Add comprehensive logging at each level:

```typescript
// Scheduler (already exists)
logger.audio.log(`Playing synth ${preset} at step ${step}`);

// Engine (add this)
playSynthNote(...) {
  logger.audio.log(`playSynthNote: preset=${preset}, freq=${freq}`);
  synthEngine.playNote(...);
}

// SynthEngine (add this)
playNote(...) {
  logger.audio.log(`SynthEngine.playNote: noteId=${noteId}, freq=${freq}`);
  if (!this.audioContext || !this.masterGain) {
    logger.audio.error('SynthEngine not initialized!');
    return;
  }
  // ... rest of method
  logger.audio.log(`Voice created and started`);
}
```

### Prevention
1. **Add logging at every level**: Scheduler → Engine → Synth → Voice
2. **Check initialization**: Early return with warning if not ready
3. **Verify context state**: Log if not "running"
4. **Use debug tracer**: Trace note from schedule to playback

### Related Files
- `src/audio/scheduler.ts`
- `src/audio/engine.ts`
- `src/audio/synth.ts`
- `src/audio/advancedSynth.ts`

### Post-Fix Analysis
```bash
# Find playback methods without logging
grep -rn "playNote\|playSynth\|playSample" src/audio/ | grep -v logger | grep -v test
```

---

## #004: Play Before Ready

**Date**: 2024-12-16
**Severity**: high
**Category**: race-condition

### Symptoms
- First few notes are silent
- Works after waiting a moment
- Intermittent failures
- "not ready" or "skipping" warnings in logs

### Root Cause
User presses play before async initialization completes:
- Sample loading not finished
- Tone.js initialization pending
- Instrument manifest still fetching

### Detection Strategy

**Log patterns:**
```
not ready
skipping
not initialized
```

**Code pattern (vulnerable):**
```typescript
// No readiness check before playing
audioEngine.playSampledInstrument(preset, ...);
```

### Fix

Always check readiness before playing:

```typescript
// In scheduler
if (!audioEngine.isSampledInstrumentReady(preset)) {
  logger.audio.warn(`${preset} not ready, skipping at step ${step}`);
  return; // SKIP, don't fall back to different sound
}
audioEngine.playSampledInstrument(preset, ...);

// In engine initialization - preload common instruments
async initialize() {
  // ... basic init ...

  // Preload commonly-used instruments
  await this.preloadAllSampledInstruments();
}
```

### Prevention
1. **Preload during init**: Load common instruments before user can play
2. **Add isReady() checks**: At all playback entry points
3. **Never fall back**: Users expect piano to sound like piano
4. **Show loading state**: Disable play button until ready

### Related Files
- `src/audio/scheduler.ts` (readiness checks)
- `src/audio/engine.ts` (preloading)
- `src/audio/sampled-instrument.ts` (loading logic)

### Post-Fix Analysis
```bash
# Find playback calls without readiness checks
grep -rn "playSampledInstrument\|playToneSynth\|playAdvancedSynth" src/ | grep -v isReady | grep -v test
```

---

## #005: Solo State Not Applied

**Date**: 2024-12-16
**Severity**: medium
**Category**: state-management

### Symptoms
- Solo 3 instruments, only hear 1
- Wrong instruments play
- Solo button appears on but track doesn't play

### Root Cause
Potential causes:
1. **State not synced**: UI shows solo but state isn't updated
2. **Solo logic inverted**: `shouldPlay = anySoloed ? track.soloed : !track.muted` may have edge cases
3. **State stale**: Scheduler has old state reference

### Detection Strategy

Add debug logging at step 0 of each bar:
```typescript
if (globalStep === 0 && anySoloed) {
  logger.audio.log(`[SOLO DEBUG] soloedTracks:`, soloedTracks);
  for (const track of state.tracks) {
    if (!track.soloed) {
      logger.audio.log(`[SOLO DEBUG] Track "${track.sampleId}" NOT playing`);
    }
  }
}
```

### Fix

Verify state flow:
1. UI click → state update
2. State update → scheduler gets new state
3. Scheduler correctly filters tracks

```typescript
// Scheduler gets fresh state each loop
private scheduler(state: GridState): void {
  const anySoloed = state.tracks.some(t => t.soloed);

  for (const track of state.tracks) {
    const shouldPlay = anySoloed ? track.soloed : !track.muted;
    if (!shouldPlay) continue;
    // ... play track
  }
}
```

### Prevention
1. **Add debug logging**: Log solo state at bar boundaries
2. **Verify state flow**: Ensure UI updates propagate to scheduler
3. **Add integration test**: Solo 3 tracks, verify exactly 3 play

### Related Files
- `src/audio/scheduler.ts` (solo logic)
- `src/components/TrackRow.tsx` (solo button)
- `src/state/gridReducer.ts` (state updates)

---

## #006: Namespace Prefix Inconsistency

**Date**: 2024-12-17
**Severity**: high
**Category**: consistency

### Symptoms
- Feature works for some track configurations but not others
- "synth:piano works but sampled:piano doesn't"
- Preloading misses certain instrument formats
- Intermittent failures depending on how track was created

### Root Cause
Multiple places in the codebase handle instrument type prefixes (`synth:`, `sampled:`, `tone:`, `advanced:`). When logic is duplicated:
1. One place gets updated, another doesn't
2. New namespaces are added but not to all handlers
3. Edge cases are handled inconsistently

Example from Phase 23:
- `scheduler.ts` handled BOTH `synth:piano` and `sampled:piano`
- `preloadInstrumentsForTracks` only handled `synth:piano`
- Result: Piano wouldn't preload for `sampled:piano` tracks

### Detection Strategy

**Code search:**
```bash
# Count prefix handling occurrences - should be centralized
grep -rn "sampleId.startsWith" src/ | grep -v test | wc -l
# If > 5, you have duplication debt
```

**Code patterns (risky):**
```typescript
// Duplicated prefix handling (BAD)
if (sampleId.startsWith('synth:')) { ... }
// Same check in another file...
if (sampleId.startsWith('synth:')) { ... }

// Should use centralized utility (GOOD)
import { parseInstrumentId } from './instrument-types';
const info = parseInstrumentId(sampleId);
```

### Fix

Use centralized utilities in `src/audio/instrument-types.ts`:

```typescript
// Instead of raw startsWith checks
if (track.sampleId.startsWith('synth:')) {
  const preset = track.sampleId.replace('synth:', '');
  if (isSampledInstrument(preset)) { ... }
}

// Use centralized utility
import { collectSampledInstruments } from './instrument-types';
const instrumentsToLoad = collectSampledInstruments(tracks);
```

### Prevention
1. **Always use instrument-types.ts** for namespace handling
2. **Never write raw startsWith()** for instrument prefixes
3. **Add tests covering ALL namespace formats** when adding features
4. **Search codebase when adding new namespace** to find all handlers

### Related Files
- `src/audio/instrument-types.ts` (centralized utilities)
- `src/audio/instrument-types.test.ts` (comprehensive tests)
- `src/audio/engine.ts` (preloadInstrumentsForTracks)
- `src/audio/scheduler.ts` (playback routing)

### Post-Fix Analysis
```bash
# Find all raw startsWith calls for instrument prefixes
grep -rn "startsWith.*synth:\|startsWith.*sampled:\|startsWith.*tone:" src/ | grep -v test | grep -v instrument-types
# Result should be minimal - most should use centralized utilities
```

---

## #007: Fix Without Tests Anti-Pattern

**Date**: 2024-12-17
**Severity**: medium
**Category**: process

### Symptoms
- Bug is fixed but similar bugs reappear later
- Regression in functionality that was "already fixed"
- No confidence that fix actually addresses root cause

### Root Cause
Fixing a bug without first writing a test that:
1. Reproduces the bug (fails before fix)
2. Passes after the fix is applied
3. Prevents regression

### Detection Strategy

**Process check:**
- Did you write a test that fails BEFORE the fix?
- Does the test pass AFTER the fix?
- Would the test catch if the bug was reintroduced?

### Fix

**Test-first workflow for bug fixes:**

```typescript
// 1. Write test that exposes the bug (should FAIL)
it('preloads piano from sampled:piano track', () => {
  const tracks = [{ sampleId: 'sampled:piano' }];
  const result = collectSampledInstruments(tracks);
  expect(result.has('piano')).toBe(true); // FAILS with buggy code
});

// 2. Run test, confirm it fails
// 3. Apply the fix
// 4. Run test, confirm it passes
// 5. Commit test AND fix together
```

### Prevention
1. **Write failing test first** before any code changes
2. **Include edge cases** in the test (all namespace formats, boundary conditions)
3. **Commit test with fix** so they're always paired
4. **Code review check**: "Where's the test for this fix?"

### Related Files
- All test files
- CI/CD pipeline configuration

---

## #008: Mid-Playback Sampled Instrument Not Preloaded

**Date**: 2024-12-17
**Severity**: high
**Category**: race-condition

### Symptoms
- "Sampled instrument piano not ready, skipping at step X" warning repeated many times
- Piano track added during playback produces no sound
- Other instruments (synths, drums) work fine
- Issue resolves after stopping and starting playback again

### Root Cause
When a sampled instrument track (e.g., `synth:piano`, `sampled:piano`) is added **during playback**, the instrument samples are never preloaded because:

1. `preloadInstrumentsForTracks()` is only called when play starts (in `handlePlayToggle`)
2. Scheduler runs `collectSampledInstruments()` at play start - doesn't include tracks added later
3. `signalMusicIntent('add_track')` initializes audio engine but doesn't preload the specific instrument

### Detection Strategy

**Log patterns:**
```
[Audio] No sampled instruments to preload      // At play start (no piano yet)
[Audio] Sampled instrument piano not ready, skipping at step 1
[Audio] Sampled instrument piano not ready, skipping at step 4
[Audio] Sampled instrument piano not ready, skipping at step 9
// ... repeated until play is restarted
[Audio] Preloading sampled instruments: piano  // Only after restart
```

**Runtime detection:**
```javascript
// If seeing "not ready" warnings but no corresponding "Preloading" message
// The instrument was added mid-playback
```

### Fix

**In SamplePicker.tsx, preload sampled instruments immediately on selection:**

```typescript
import { getSampledInstrumentId } from '../audio/instrument-types';
import { getAudioEngine } from '../audio/audioTriggers';

const handleSelect = useCallback(async (instrumentId: string) => {
  signalMusicIntent('add_track');

  // Phase 23: Immediately preload sampled instruments
  const sampledId = getSampledInstrumentId(instrumentId);
  if (sampledId) {
    // Fire and forget - don't block UI
    getAudioEngine().then(engine => {
      engine.preloadInstrumentsForTracks([{ sampleId: instrumentId }]);
    }).catch(() => {}); // Ignore errors, scheduler will retry
  }

  const name = getInstrumentName(instrumentId);
  onSelectSample(instrumentId, name);
}, [onSelectSample]);
```

### Prevention
1. **Preload at point of selection** - Don't wait for play to start
2. **Test mid-playback scenarios** - Add tests that add tracks during playback
3. **Consider useEffect watcher** - Watch track changes and preload new sampled instruments

### Related Files
- src/components/SamplePicker.tsx - Where tracks are added
- src/components/StepSequencer.tsx - Where preload currently happens (only on play)
- src/audio/scheduler.ts - Where "not ready" warning originates
- src/audio/instrument-types.ts - getSampledInstrumentId helper

### Post-Fix Analysis
```bash
# Find other places that add tracks without preloading
grep -r "ADD_TRACK\|add_track" src/ --include="*.ts" --include="*.tsx"

# Find calls to signalMusicIntent that might need preloading
grep -r "signalMusicIntent" src/ --include="*.ts" --include="*.tsx"
```

---

## Debugging Tools Quick Reference

### Enable Debug Tracing
```javascript
window.__DEBUG_TRACE__ = true
window.__TRACE_FILTER__ = 'scheduler'  // Optional filter
```

### View Traces
```javascript
window.__getTraces__()        // All traces
window.__exportTraces__()     // JSON export
window.__getSpanStats__()     // Performance stats
window.__filterTraces__('synth')  // Filter by keyword
```

### Run Bug Detection
```javascript
window.__runBugDetection__()  // Check for known patterns
window.__searchBugPatterns__('silent')  // Search by symptom
```

### Playback State Assertions
```javascript
window.__AUDIO_DEBUG__ = true
window.__getPlaybackState__()
window.__assertPlaybackStopped__()
```

---

## Adding a New Entry

When you fix a bug:

1. **Document it immediately** while context is fresh
2. **Use the template** above
3. **Include code examples** showing before/after
4. **Add to bug-patterns.ts** if it can be detected at runtime
5. **Run post-fix analysis** to check for similar issues
6. **Add regression tests** if not already covered

### Post-Fix Analysis Workflow

After confirming a fix:

```bash
# 1. Search for similar patterns
grep -rn "PATTERN" src/

# 2. Run the analysis tool
npm run analyze:bug-patterns

# 3. Update this document

# 4. Add tests if needed
```
