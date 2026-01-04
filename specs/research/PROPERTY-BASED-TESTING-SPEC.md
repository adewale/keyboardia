# Property-Based Testing Specification for Keyboardia

**Version:** 1.0
**Date:** 2026-01-04
**Status:** Research Complete

---

## Executive Summary

This specification documents a comprehensive analysis of where property-based testing (PBT) would have the highest impact in the Keyboardia codebase. The analysis goes beyond surface-level observations to identify subtle algorithmic edge cases, state machine invariants, and composition properties that traditional example-based testing misses.

**Key Finding:** Many of the documented bugs in Keyboardia (BUG-01 through BUG-10, plus the lessons-learned entries) share a common characteristic: they involve **invariant violations** or **edge cases in state transitions** that property-based testing is specifically designed to catch.

---

## Table of Contents

1. [What is Property-Based Testing?](#1-what-is-property-based-testing)
2. [Why Now? Technological Enablers](#2-why-now-technological-enablers)
3. [The Power of Property-Based Testing](#3-the-power-of-property-based-testing)
4. [Priority Areas for Keyboardia](#4-priority-areas-for-keyboardia)
5. [Detailed Property Specifications](#5-detailed-property-specifications)
6. [Bug Pattern Analysis](#6-bug-pattern-analysis)
7. [Mutation Testing Synergies](#7-mutation-testing-synergies)
8. [Implementation Recommendations](#8-implementation-recommendations)
9. [Appendix: Property Catalog](#appendix-property-catalog)

---

## 1. What is Property-Based Testing?

### 1.1 Definition

Property-based testing is a testing methodology where instead of specifying individual input-output pairs (example-based testing), you specify **properties** that should hold for **all possible inputs** within a domain.

```typescript
// Example-based: Test specific cases
test('rotateLeft rotates correctly', () => {
  expect(rotateLeft([1, 2, 3], 3)).toEqual([2, 3, 1]);
  expect(rotateLeft([1, 2], 2)).toEqual([2, 1]);
});

// Property-based: Test universal properties
test('rotateLeft then rotateRight is identity', () => {
  fc.assert(fc.property(
    fc.array(fc.integer()),
    fc.nat(),
    (arr, n) => {
      const stepCount = Math.max(1, n % 128);
      const rotated = rotateRight(rotateLeft(arr, stepCount), stepCount);
      expect(rotated).toEqual(arr);
    }
  ));
});
```

### 1.2 Core Concepts

| Concept | Description |
|---------|-------------|
| **Property** | An invariant that must hold for all inputs |
| **Generator** | Produces random inputs within constraints |
| **Shrinking** | When a failure is found, automatically finds the minimal failing case |
| **Seed** | Random seed for reproducibility |

### 1.3 Types of Properties

1. **Algebraic Properties**
   - Identity: `f(f⁻¹(x)) = x`
   - Commutativity: `f(a, b) = f(b, a)`
   - Associativity: `f(f(a, b), c) = f(a, f(b, c))`
   - Idempotence: `f(f(x)) = f(x)`

2. **Invariants**
   - Bounds: `0 ≤ result ≤ 127`
   - Length preservation: `output.length === input.length`
   - Type preservation: `typeof result === 'number'`

3. **Roundtrip/Symmetry**
   - Encode-decode: `decode(encode(x)) = x`
   - Serialize-deserialize: `parse(stringify(x)) ≅ x`

4. **Oracle Properties**
   - Model comparison: `fastImpl(x) = slowButCorrectImpl(x)`
   - Reference implementation: `mySort(arr) = arr.sort()`

5. **Metamorphic Properties**
   - If input changes in way X, output changes in way Y
   - `sort(reverse(arr)) = reverse(sort(arr))`

---

## 2. Why Now? Technological Enablers

### 2.1 What's Changed in the Last 25 Years

Property-based testing was introduced by QuickCheck in Haskell in 1999, but it remained niche for decades. Several technological shifts have made it viable for mainstream adoption:

#### 2.1.1 Computational Power (1999 → 2025)

| Era | Typical Test Runs | Time for 10,000 Cases |
|-----|-------------------|----------------------|
| 1999 | 100 cases | Minutes |
| 2010 | 1,000 cases | Seconds |
| 2025 | 100,000+ cases | Milliseconds |

Modern CPUs can run millions of property checks in the time a 1999 machine took for hundreds. This transforms PBT from "expensive verification technique" to "cheap sanity check."

#### 2.1.2 Shrinking Algorithms

Early PBT frameworks produced enormous failing cases that were impossible to debug. Modern frameworks like fast-check use **integrated shrinking** that automatically finds minimal counterexamples:

```
// Without shrinking (1999-era)
Failed for: [1,7,3,9,2,6,8,4,5,0,11,13,17,19,23,29,31,37...]

// With integrated shrinking (modern)
Failed for: [0, 1]  // Minimal counterexample
```

#### 2.1.3 Type System Integration

TypeScript and modern typed languages allow:
- **Type-driven generation**: Generate valid inputs from type definitions
- **Compile-time property verification**: Some properties can be checked statically
- **Better tooling**: IDEs understand property test structures

#### 2.1.4 Ecosystem Maturity

| Library | Language | Stars | Key Innovation |
|---------|----------|-------|----------------|
| fast-check | TypeScript | 4.5k+ | Integrated shrinking, async support |
| Hypothesis | Python | 7k+ | Stateful testing, database of examples |
| PropEr | Erlang | 900+ | Concurrent system testing |
| jqwik | Java | 600+ | JUnit 5 integration |

### 2.2 What's Changed in the Last 10 Years

#### 2.2.1 Stateful/Model-Based Testing

Modern PBT frameworks can test **sequences of operations**, not just pure functions:

```typescript
// Test that ANY sequence of grid operations maintains invariants
fc.assert(fc.property(
  fc.array(fc.oneof(
    fc.record({ type: fc.constant('TOGGLE_STEP'), step: fc.nat(127) }),
    fc.record({ type: fc.constant('ROTATE_LEFT') }),
    fc.record({ type: fc.constant('SET_TEMPO'), tempo: fc.integer(60, 180) }),
  )),
  (actions) => {
    let state = initialState();
    for (const action of actions) {
      state = reducer(state, action);
      // Invariant must hold after EVERY action
      expect(state.tracks[0].steps.length).toBe(128);
    }
  }
));
```

#### 2.2.2 Async/Concurrent Testing

Modern frameworks handle promises, race conditions, and concurrent operations:

```typescript
fc.assert(fc.asyncProperty(
  fc.array(fc.nat()),
  async (values) => {
    const results = await Promise.all(values.map(asyncOperation));
    // Properties about concurrent behavior
  }
));
```

#### 2.2.3 CI/CD Integration

- **Seed persistence**: Failing seeds are saved and replayed
- **Deterministic replay**: Same seed = same test run
- **Incremental testing**: Only re-test affected properties

---

## 3. The Power of Property-Based Testing

### 3.1 Why Properties Find Bugs Examples Miss

#### 3.1.1 Combinatorial Explosion

Example-based tests cover a tiny fraction of the input space:

```
Domain size for toggleStep(trackId, step):
- trackId: 16 possible tracks
- step: 128 possible steps
- Current state: 2^128 possible step configurations per track

Total: 16 × 128 × 2^128 ≈ 10^41 possible inputs

Example tests might cover: 10-20 cases
Coverage: ~10^-40 of input space
```

Property tests explore randomly across this space, finding edge cases humans don't think to test.

#### 3.1.2 Adversarial Search

Shrinking acts as an **adversarial search** for minimal failing cases. It's like having an attacker trying to break your code:

```typescript
// Shrinking found this minimal case that breaks Euclidean:
euclidean(steps=1, hits=0)  // Edge case: what's a 1-step pattern with 0 hits?
```

#### 3.1.3 Specification as Documentation

Properties serve as **executable specifications** that document intended behavior:

```typescript
// This IS the specification for snapToScale
describe('snapToScale specification', () => {
  it('always returns a pitch that is in the scale', ...);
  it('returns the closest scale pitch to the input', ...);
  it('preserves octave when possible', ...);
  it('handles negative pitches correctly', ...);
});
```

### 3.2 The Psychology of Property Discovery

Finding good properties requires thinking differently:

| Example-Based Thinking | Property-Based Thinking |
|------------------------|-------------------------|
| "What should f(5) return?" | "What should be true for ALL f(x)?" |
| "Test the happy path" | "What can never happen?" |
| "Cover edge cases I know about" | "What invariants must always hold?" |
| "This specific sequence works" | "Any sequence of operations is safe" |

### 3.3 The Shrinking Superpower

When a property fails, shrinking finds the **simplest failing case**:

```
Original failure:
  state = { tracks: [{ steps: [T,F,T,F,T,F,T,F,T,T,T,T,F,F,F,F], stepCount: 16, ... }] }
  actions = [ROTATE, TOGGLE(3), ROTATE, SET_TEMPO(147), TOGGLE(7), ROTATE, ...]

After shrinking:
  state = { tracks: [{ steps: [T,F,...], stepCount: 2 }] }
  actions = [ROTATE, TOGGLE(1)]

// Now the bug is obvious: rotation with stepCount=2 has an off-by-one error
```

---

## 4. Priority Areas for Keyboardia

### 4.1 Tier 1: Critical (Start Here)

These areas have **known bugs** or **high complexity** where PBT will immediately find issues:

#### 4.1.1 Tied Note Duration Across Loop Boundaries

**Location:** `app/src/audio/scheduler.ts:464-486`

**The Bug:** When a tied note spans from the last step to the first step of a loop, the duration calculation fails because the modulo wrap breaks the while-loop condition.

```typescript
// Current (buggy) code:
while (nextStep > startStep && nextStep < trackStepCount) {
  // When startStep=15 and nextStep wraps to 0:
  // 0 > 15 is FALSE → loop exits immediately
}
```

**Property:**
```typescript
fc.assert(fc.property(
  fc.integer(0, 127),  // startStep
  fc.integer(1, 16),   // tieLength
  fc.integer(3, 128),  // stepCount
  (start, tieLength, stepCount) => {
    const track = createTrackWithTies(start, tieLength, stepCount);
    const duration = calculateTiedDuration(track, start, stepCount, 0.125);
    // Invariant: Duration equals sum of tied steps (including wrap-around)
    expect(duration).toBeCloseTo(tieLength * 0.125 * 0.9);
  }
));
```

#### 4.1.2 Polyrhythm LCM Synchronization

**Location:** `app/src/audio/scheduler.ts:270`

**The Bug:** Tracks with step counts whose LCM exceeds 128 never realign within the pattern length.

| Track Combo | LCM | Behavior |
|-------------|-----|----------|
| 12 + 16 | 48 | ✓ Syncs at step 48 |
| 48 + 64 | 192 | ✗ Never syncs (MAX_STEPS=128) |

**Property:**
```typescript
fc.assert(fc.property(
  fc.constantFrom(...VALID_STEP_COUNTS),
  fc.constantFrom(...VALID_STEP_COUNTS),
  (countA, countB) => {
    const lcm = calculateLCM(countA, countB);
    // Property: Either LCM ≤ MAX_STEPS, or system warns about non-sync
    if (lcm > MAX_STEPS) {
      // Document that this combination never syncs
      expect(lcm).toBeGreaterThan(MAX_STEPS);
    }
  }
));
```

#### 4.1.3 Mutation Tracker State Machine

**Location:** `app/src/sync/mutation-tracker.ts`

**Critical Invariants:**
1. A mutation can only be in ONE state at a time
2. State transitions: `pending → confirmed → cleared` OR `pending → superseded` OR `pending → lost`
3. `confirmedAtServerSeq ≤ snapshotServerSeq` for cleared mutations

**Property:**
```typescript
fc.assert(fc.property(
  fc.array(arbitraryMutation()),
  fc.array(fc.nat()),  // confirmation sequence
  fc.array(fc.nat()),  // snapshot sequence
  (mutations, confirmations, snapshots) => {
    const tracker = new MutationTracker();

    mutations.forEach(m => tracker.trackMutation(m));
    confirmations.forEach(seq => tracker.confirmMutation(seq));
    snapshots.forEach(seq => tracker.clearOnSnapshot(seq));

    // Invariant: Stats sum correctly
    const stats = tracker.getStats();
    const all = tracker.getAllMutations();

    expect(all.filter(m => m.state === 'pending').length).toBe(stats.pending);
    expect(all.filter(m => m.state === 'confirmed').length).toBe(stats.confirmed);
  }
));
```

#### 4.1.4 Canonical Hash Determinism

**Location:** `app/src/sync/canonicalHash.ts`

**The Bug:** Line 654 has `hash = hash & hash` which is a no-op (should be `hash | 0`).

**Properties:**
```typescript
// Determinism
fc.assert(fc.property(
  arbitrarySessionState(),
  (state) => {
    const h1 = hashState(canonicalizeForHash(state));
    const h2 = hashState(canonicalizeForHash(state));
    expect(h1).toBe(h2);
  }
));

// Local-only exclusion
fc.assert(fc.property(
  arbitrarySessionState(),
  fc.boolean(),
  fc.boolean(),
  (state, muted, soloed) => {
    const s1 = withMutedSoloed(state, false, false);
    const s2 = withMutedSoloed(state, muted, soloed);
    // muted/soloed should NOT affect hash
    expect(hashState(canonicalizeForHash(s1))).toBe(hashState(canonicalizeForHash(s2)));
  }
));
```

### 4.2 Tier 2: High Value

#### 4.2.1 Parameter Lock Partial Failure

**Location:** `app/src/worker/invariants.ts:66-110`

**The Bug:** If a lock has `{ pitch: NaN, volume: 0.5 }`, the **entire lock is rejected**, even though volume is valid.

**Property:**
```typescript
fc.assert(fc.property(
  fc.record({
    pitch: fc.oneof(fc.integer(-24, 24), fc.constant(NaN)),
    volume: fc.oneof(fc.float(0, 1), fc.constant(NaN)),
  }),
  (lock) => {
    const validated = validateParameterLock(lock);

    // Valid fields should be preserved
    if (typeof lock.pitch === 'number' && isFinite(lock.pitch)) {
      expect(validated?.pitch).toBeDefined();
    }
    if (typeof lock.volume === 'number' && isFinite(lock.volume)) {
      expect(validated?.volume).toBeDefined();
    }
  }
));
```

#### 4.2.2 Swing Timing Algebraic Properties

**Location:** `app/src/audio/scheduler.ts:316-326`

**The Formula:** `swingAmount = global + track - (global * track)`

**Properties:**
```typescript
// Commutativity
fc.assert(fc.property(
  fc.float(0, 1),
  fc.float(0, 1),
  (g, t) => {
    const blend1 = g + t - (g * t);
    const blend2 = t + g - (t * g);
    expect(blend1).toBeCloseTo(blend2);
  }
));

// Identity
fc.assert(fc.property(
  fc.float(0, 1),
  (swing) => {
    const blend = 0 + swing - (0 * swing);
    expect(blend).toBeCloseTo(swing);
  }
));

// Monotonicity
fc.assert(fc.property(
  fc.float(0, 0.9),
  fc.integer(60, 180),
  (swing, tempo) => {
    const delay1 = calculateSwingDelay(swing, tempo);
    const delay2 = calculateSwingDelay(swing + 0.1, tempo);
    expect(delay2).toBeGreaterThan(delay1);
  }
));
```

#### 4.2.3 Loop Region Boundary Conditions

**Location:** `app/src/audio/scheduler.ts:258-271`

**Edge Cases:**
- `start === end`: Infinite loop on single step
- `start > end`: Undefined behavior
- `end > MAX_STEPS`: Loop never triggers

**Property:**
```typescript
fc.assert(fc.property(
  fc.integer(0, 127),
  fc.integer(0, 127),
  fc.integer(0, 1000),
  (start, end, stepsToRun) => {
    fc.pre(start < end);  // Valid loop region

    const visited = new Set<number>();
    let currentStep = start;

    for (let i = 0; i < stepsToRun; i++) {
      visited.add(currentStep);
      currentStep = advanceStep(currentStep, { start, end });
    }

    // Invariant: Only steps in [start, end) are ever visited
    for (const step of visited) {
      expect(step).toBeGreaterThanOrEqual(start);
      expect(step).toBeLessThan(end);
    }
  }
));
```

### 4.3 Tier 3: Medium Value

#### 4.3.1 Euclidean Rhythm Distribution

**Location:** `app/src/utils/patternOps.ts:107-165`

**Properties:**
```typescript
// Exact hit count
fc.assert(fc.property(
  fc.integer(1, 128),
  fc.integer(0, 128),
  (steps, hits) => {
    const k = Math.min(hits, steps);
    const pattern = euclidean(steps, k);
    expect(pattern.filter(Boolean).length).toBe(k);
  }
));

// Maximal evenness
fc.assert(fc.property(
  fc.integer(1, 64),
  fc.integer(1, 64),
  (steps, hits) => {
    fc.pre(hits <= steps);
    const pattern = euclidean(steps, hits);
    const gaps = computeGaps(pattern);

    if (gaps.length >= 2) {
      const maxGap = Math.max(...gaps);
      const minGap = Math.min(...gaps);
      expect(maxGap - minGap).toBeLessThanOrEqual(1);
    }
  }
));
```

#### 4.3.2 Scale Snapping Correctness

**Location:** `app/src/music/music-theory.ts:260-295`

**Properties:**
```typescript
// Result is always in scale
fc.assert(fc.property(
  fc.integer(-60, 60),
  fc.constantFrom(...NOTE_NAMES),
  fc.constantFrom(...SCALE_IDS),
  (pitch, root, scaleId) => {
    const snapped = snapToScale(pitch, root, scaleId);
    expect(isInScale(snapped, root, scaleId)).toBe(true);
  }
));

// Result is closest in scale
fc.assert(fc.property(
  fc.integer(-60, 60),
  fc.constantFrom(...NOTE_NAMES),
  fc.constantFrom(...SCALE_IDS),
  (pitch, root, scaleId) => {
    const snapped = snapToScale(pitch, root, scaleId);
    const scaleNotes = getAllScaleNotesInRange(root, scaleId, pitch - 12, pitch + 12);

    for (const note of scaleNotes) {
      expect(Math.abs(snapped - pitch)).toBeLessThanOrEqual(Math.abs(note - pitch) + 0.001);
    }
  }
));
```

#### 4.3.3 Pattern Operations Composition

**Location:** `app/src/utils/patternOps.ts`

**Properties:**
```typescript
// Rotate left then right = identity
fc.assert(fc.property(
  fc.array(fc.boolean(), { minLength: 1, maxLength: 128 }),
  (pattern) => {
    const stepCount = pattern.length;
    const result = rotateRight(rotateLeft(pattern, stepCount), stepCount);
    expect(result).toEqual(pattern);
  }
));

// Double invert = identity
fc.assert(fc.property(
  fc.array(fc.boolean()),
  (pattern) => {
    const result = invertPattern(invertPattern(pattern));
    expect(result).toEqual(pattern);
  }
));

// Reverse of reverse = identity
fc.assert(fc.property(
  fc.array(fc.boolean()),
  (pattern) => {
    expect(reversePattern(reversePattern(pattern))).toEqual(pattern);
  }
));
```

---

## 5. Detailed Property Specifications

### 5.1 Music Theory Module

**File:** `app/src/music/music-theory.ts`

| Function | Property | Formal Statement |
|----------|----------|------------------|
| `getScaleNotes` | All in range | ∀ note ∈ result: 0 ≤ note < 12 |
| `isInScale` | Consistent with getScaleNotes | isInScale(p, r, s) ⟺ (p mod 12) ∈ getScaleNotes(r, s) |
| `snapToScale` | Result in scale | isInScale(snapToScale(p, r, s), r, s) = true |
| `snapToScale` | Minimal distance | ∀ q ∈ scale: \|snap(p) - p\| ≤ \|q - p\| |
| `getScaleDegree` | Inverse of index | getScaleNotes(r, s)[getScaleDegree(p, r, s)] = p mod 12 |

### 5.2 Sync Module

**File:** `app/src/sync/mutation-tracker.ts`

| Property | Formal Statement |
|----------|------------------|
| State exclusivity | ∀ m: m.state ∈ {pending, confirmed, superseded, lost} |
| Transition validity | pending → {confirmed, superseded, lost}, confirmed → {cleared} |
| Stats consistency | stats.pending = \|{m : m.state = pending}\| |
| Sequence monotonicity | serverSeq never decreases |

### 5.3 Audio Module

**File:** `app/src/audio/scheduler.ts`

| Property | Formal Statement |
|----------|------------------|
| Timing monotonicity | step₁ < step₂ ⟹ time(step₁) ≤ time(step₂) |
| Swing on odd steps | step mod 2 = 0 ⟹ swingDelay(step) = 0 |
| Loop containment | loopRegion ⟹ ∀ t: currentStep ∈ [start, end) |
| Tied duration | tiedDuration(start, n) = n × stepDuration × 0.9 |

---

## 6. Bug Pattern Analysis

### 6.1 How PBT Would Have Caught Known Bugs

#### BUG-001: AudioContext Mismatch

**Category:** Singleton/State
**How PBT Helps:** Model-based testing with state machine

```typescript
// Property: After any sequence of init/HMR/dispose, contexts match
fc.assert(fc.property(
  fc.array(fc.constantFrom('init', 'hmr', 'dispose')),
  (events) => {
    const engine = new MockEngine();
    for (const event of events) {
      engine.handleEvent(event);
      // Invariant: Tone context always matches engine context
      expect(engine.getToneContext()).toBe(engine.getAudioContext());
    }
  }
));
```

#### BUG-002: Stale State After Stop

**Category:** Timer/State
**How PBT Helps:** State machine invariants

```typescript
// Property: After stop, no pending timers
fc.assert(fc.property(
  fc.array(fc.constantFrom('play', 'stop', 'scheduleNote')),
  (events) => {
    const scheduler = new MockScheduler();
    for (const event of events) {
      scheduler.handleEvent(event);
    }
    if (events[events.length - 1] === 'stop') {
      expect(scheduler.getPendingTimers().size).toBe(0);
    }
  }
));
```

#### BUG-004: Play Before Ready

**Category:** Race Condition
**How PBT Helps:** Temporal property testing

```typescript
// Property: Playing before ready logs warning, doesn't crash
fc.assert(fc.asyncProperty(
  fc.array(fc.constantFrom('play', 'load', 'addTrack')),
  async (events) => {
    const engine = new MockEngine();
    for (const event of events) {
      await engine.handleEvent(event);
      // Invariant: System never crashes regardless of order
    }
  }
));
```

#### BUG-008: Mid-Playback Instrument Not Preloaded

**Category:** Race Condition
**How PBT Helps:** Sequence testing

```typescript
// Property: Any track added is eventually playable
fc.assert(fc.asyncProperty(
  fc.array(fc.oneof(
    fc.constant({ type: 'play' }),
    fc.constant({ type: 'stop' }),
    fc.record({ type: fc.constant('addTrack'), instrument: fc.constantFrom(...INSTRUMENTS) }),
  )),
  async (events) => {
    const engine = new MockEngine();
    const addedInstruments = new Set<string>();

    for (const event of events) {
      await engine.handleEvent(event);
      if (event.type === 'addTrack') {
        addedInstruments.add(event.instrument);
      }
    }

    // After all events, all added instruments should be ready
    await engine.waitForQuiescence();
    for (const inst of addedInstruments) {
      expect(engine.isReady(inst)).toBe(true);
    }
  }
));
```

### 6.2 Bug Categories and PBT Strategies

| Bug Category | PBT Strategy | Example Property |
|--------------|--------------|------------------|
| Audio Context | State machine | Context consistency across events |
| State Management | Invariants | Array lengths always MAX_STEPS |
| Race Conditions | Temporal | Eventually consistent after operations |
| Routing | Metamorphic | Same input → same output path |
| Consistency | Equivalence | Different representations hash same |
| Multiplayer Sync | State machine | Mutation states transition correctly |
| Memory Leaks | Resource bounds | Timer count bounded |

---

## 7. Mutation Testing Synergies

### 7.1 What is Mutation Testing?

Mutation testing evaluates test quality by introducing small changes (mutations) to the code and checking if tests detect them:

```typescript
// Original code
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Mutations
function clamp_mutant1(value, min, max) {
  return Math.max(min, Math.min(max, value)) + 1;  // +1 added
}

function clamp_mutant2(value, min, max) {
  return Math.min(min, Math.min(max, value));  // max→min
}

function clamp_mutant3(value, min, max) {
  return Math.max(min, Math.max(max, value));  // min→max in inner
}
```

A **killed mutant** means tests detected the change. A **surviving mutant** means tests are insufficient.

### 7.2 How PBT Improves Mutation Score

Example-based tests often miss mutants because they test specific cases:

```typescript
// Example-based test
test('clamp works', () => {
  expect(clamp(5, 0, 10)).toBe(5);  // Kills mutant1 (+1)
  expect(clamp(15, 0, 10)).toBe(10); // Doesn't kill mutant3!
});
```

Property-based tests explore the space:

```typescript
// Property-based test
fc.assert(fc.property(
  fc.integer(),
  fc.integer(),
  fc.integer(),
  (value, min, max) => {
    fc.pre(min <= max);
    const result = clamp(value, min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThanOrEqual(max);
    if (value >= min && value <= max) {
      expect(result).toBe(value);  // Kills mutant3!
    }
  }
));
```

### 7.3 Mutation-Guided Property Discovery

Surviving mutants suggest missing properties:

| Surviving Mutant | Suggested Property |
|------------------|-------------------|
| `Math.max → Math.min` | Bounds are respected |
| `< → <=` | Boundary behavior is correct |
| `+1 → +0` | Exact values are preserved |
| `&& → \|\|` | Both conditions are necessary |

### 7.4 The Feedback Loop

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   1. Write properties → 2. Run mutation testing        │
│         ↑                       ↓                       │
│         │               3. Find surviving mutants       │
│         │                       ↓                       │
│   5. Add new properties ← 4. Analyze why they survived │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.5 Practical Integration

```typescript
// Use Stryker for mutation testing
// stryker.conf.js
module.exports = {
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  testRunner: 'vitest',
  reporters: ['html', 'clear-text'],
  thresholds: {
    high: 80,
    low: 60,
    break: 50
  }
};
```

Run mutation testing on property tests:

```bash
npx stryker run --testRunner vitest --testRunnerNodeArgs "--test-name-pattern property"
```

---

## 8. Implementation Recommendations

### 8.1 Getting Started

1. **Install fast-check:**
   ```bash
   npm install -D fast-check
   ```

2. **Create property test file:**
   ```typescript
   // src/utils/patternOps.property.test.ts
   import fc from 'fast-check';
   import { describe, it, expect } from 'vitest';
   import { rotateLeft, rotateRight, euclidean } from './patternOps';
   ```

3. **Start with algebraic properties** (easiest to discover):
   ```typescript
   it('rotate left then right is identity', () => {
     fc.assert(fc.property(
       fc.array(fc.boolean(), { minLength: 1, maxLength: 128 }),
       (arr) => {
         const n = arr.length;
         expect(rotateRight(rotateLeft(arr, n), n)).toEqual(arr);
       }
     ));
   });
   ```

### 8.2 Custom Arbitraries

Create reusable generators for domain types:

```typescript
// src/test/arbitraries.ts
import fc from 'fast-check';
import { VALID_STEP_COUNTS, NOTE_NAMES, SCALE_IDS } from '../types';

export const arbStepCount = fc.constantFrom(...VALID_STEP_COUNTS);
export const arbNoteName = fc.constantFrom(...NOTE_NAMES);
export const arbScaleId = fc.constantFrom(...SCALE_IDS);
export const arbPitch = fc.integer({ min: -60, max: 72 });

export const arbTrack = fc.record({
  id: fc.uuid(),
  sampleId: fc.constantFrom('synth:kick', 'synth:snare', 'sampled:piano'),
  steps: fc.array(fc.boolean(), { minLength: 128, maxLength: 128 }),
  parameterLocks: fc.array(
    fc.option(fc.record({
      pitch: fc.option(fc.integer(-24, 24)),
      volume: fc.option(fc.float(0, 1)),
      tie: fc.option(fc.boolean()),
    })),
    { minLength: 128, maxLength: 128 }
  ),
  stepCount: arbStepCount,
  volume: fc.float(0, 2),
  muted: fc.boolean(),
  soloed: fc.boolean(),
});

export const arbSessionState = fc.record({
  tracks: fc.array(arbTrack, { minLength: 0, maxLength: 16 }),
  tempo: fc.integer(60, 180),
  swing: fc.integer(0, 100),
});
```

### 8.3 Test Organization

```
src/
├── audio/
│   ├── scheduler.ts
│   ├── scheduler.test.ts           # Example-based tests
│   └── scheduler.property.test.ts  # Property-based tests
├── music/
│   ├── music-theory.ts
│   ├── music-theory.test.ts
│   └── music-theory.property.test.ts
├── sync/
│   ├── mutation-tracker.ts
│   ├── mutation-tracker.test.ts
│   └── mutation-tracker.property.test.ts
└── test/
    ├── arbitraries.ts              # Shared generators
    └── properties.ts               # Shared property helpers
```

### 8.4 CI Integration

```yaml
# .github/workflows/test.yml
- name: Run property tests
  run: npm test -- --testNamePattern="property"
  env:
    FC_SEED: ${{ github.run_id }}  # Reproducible across CI runs
```

### 8.5 Debugging Failures

When a property fails:

1. **Note the seed:** fast-check prints the failing seed
2. **Replay the failure:**
   ```typescript
   fc.assert(fc.property(...), { seed: 1234567890 });
   ```
3. **Examine the shrunk case:** This is the minimal failing input
4. **Write an example test:** Capture the case for regression

---

## Appendix: Property Catalog

### A.1 Pattern Operations (`patternOps.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| PO-001 | rotateLeft/Right identity | `rotateRight(rotateLeft(p)) = p` |
| PO-002 | Double invert identity | `invert(invert(p)) = p` |
| PO-003 | Double reverse identity | `reverse(reverse(p)) = p` |
| PO-004 | Euclidean exact count | `euclidean(n,k).filter(x).length = k` |
| PO-005 | Euclidean maximal evenness | Gap sizes differ by ≤ 1 |
| PO-006 | Length preservation | `op(p).length = p.length` |

### A.2 Music Theory (`music-theory.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| MT-001 | Scale notes in range | `∀ n ∈ getScaleNotes(): 0 ≤ n < 12` |
| MT-002 | isInScale consistency | Matches getScaleNotes membership |
| MT-003 | snapToScale in scale | Result satisfies isInScale |
| MT-004 | snapToScale minimal | No closer scale note exists |
| MT-005 | Negative pitch handling | Correct modulo for negatives |

### A.3 Sync Module (`mutation-tracker.ts`, `canonicalHash.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| SY-001 | Hash determinism | Same state → same hash |
| SY-002 | Local-only exclusion | muted/soloed don't affect hash |
| SY-003 | Mutation state exclusivity | One state at a time |
| SY-004 | Stats consistency | Counts match actual states |
| SY-005 | Sequence monotonicity | serverSeq never decreases |

### A.4 Audio Module (`scheduler.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| AU-001 | Timing monotonicity | Later steps have later times |
| AU-002 | Swing odd-step only | Even steps have zero delay |
| AU-003 | Loop containment | Steps stay in region |
| AU-004 | Tied duration correct | Equals sum of tied steps |
| AU-005 | Voice count bounded | ≤ MAX_VOICES active |

### A.5 Validation (`validators.ts`, `invariants.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| VA-001 | Clamp within bounds | Result in [min, max] |
| VA-002 | Validation idempotence | `validate(validate(x)) = validate(x)` |
| VA-003 | Array length invariant | `steps.length = 128` always |
| VA-004 | Parameter lock partial | Valid fields preserved |

---

## References

1. Claessen, K., & Hughes, J. (2000). QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs.
2. Hughes, J. (2007). QuickCheck Testing for Fun and Profit.
3. Papadakis, M., et al. (2019). Mutation Testing Advances: An Analysis and Survey.
4. fast-check documentation: https://github.com/dubzzz/fast-check
5. Hypothesis documentation: https://hypothesis.readthedocs.io/
6. Keyboardia Bug Pattern Registry: `app/src/utils/bug-patterns.ts`
7. Keyboardia Debugging Lessons: `docs/DEBUGGING-LESSONS-LEARNED.md`
