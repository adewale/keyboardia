# Property-Based Testing Specification for Keyboardia

**Version:** 2.2
**Date:** 2026-01-04
**Status:** Infrastructure Audit Complete

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
9. [Architectural Changes for Testability](#9-architectural-changes-for-testability)
10. [Cross-Component Invariant Assertions](#10-cross-component-invariant-assertions)
11. [Success Metrics and Measurement](#11-success-metrics-and-measurement)
12. [CI/CD Integration](#12-cicd-integration)
13. [Race Condition Testing](#13-race-condition-testing)
14. [Model-Based Testing](#14-model-based-testing)
15. [Lessons Learned and Retrospective](#15-lessons-learned-and-retrospective)
16. [Abstraction Fixes Implemented](#16-abstraction-fixes-implemented)
17. [Infrastructure Retrospective](#17-infrastructure-retrospective-testing-real-code)
18. [Appendix: Property Catalog](#appendix-property-catalog)

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

### A.6 Race Condition Testing (`scheduler.ts`, `engine.ts`)

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| RC-001 | Play/stop race safety | Concurrent play/stop never crashes |
| RC-002 | Instrument load race | Adding tracks during playback eventually loads |
| RC-003 | WebSocket reconnect | Messages ordered after reconnection |

### A.7 Cross-Component Properties

| Property ID | Description | Implementation |
|------------|-------------|----------------|
| XC-001 | Hash after mutations | State hash consistent after mutation sequence |
| XC-002 | Scheduler uses validated state | Scheduler only receives validated tempo/swing |
| XC-003 | Sync respects audio constraints | Multiplayer sync respects MAX_STEPS, MAX_TRACKS |

---

## 9. Architectural Changes for Testability

### 9.1 Problem: Private Methods Block Testing

The scheduler has critical calculation logic in private methods:

```typescript
// Current: Can't test directly
private calculateTiedDuration(...) { ... }
private advanceStep(...) { ... }
private getStepDuration(...) { ... }
```

**Solution: Extract Pure Calculation Modules**

```typescript
// app/src/audio/timing-calculations.ts
export function getStepDuration(tempo: number): number {
  const beatsPerSecond = tempo / 60;
  return 1 / (beatsPerSecond * STEPS_PER_BEAT);
}

export function calculateTiedDuration(
  track: TiedNoteTrack,
  startStep: number,
  trackStepCount: number,
  stepDuration: number
): number {
  // Pure calculation, easily testable
}

export function advanceStep(
  currentStep: number,
  loopRegion: LoopRegion | null,
  maxSteps: number
): number {
  // Pure calculation
}
```

### 9.2 State Machine Abstractions

**Problem:** State transitions are implicit in the scheduler and mutation tracker.

**Solution: Extract Explicit State Machines**

```typescript
// app/src/audio/scheduler-state-machine.ts
export type SchedulerState = 'stopped' | 'starting' | 'playing' | 'stopping';

export type SchedulerEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'AUDIO_READY' }
  | { type: 'AUDIO_FAILED' };

export interface SchedulerStateMachine {
  state: SchedulerState;
  transition(event: SchedulerEvent): SchedulerState;
  canTransition(event: SchedulerEvent): boolean;
}

// Valid transitions
const TRANSITIONS: Record<SchedulerState, Partial<Record<SchedulerEvent['type'], SchedulerState>>> = {
  stopped: { START: 'starting' },
  starting: { AUDIO_READY: 'playing', AUDIO_FAILED: 'stopped' },
  playing: { STOP: 'stopping' },
  stopping: { /* automatic to stopped */ },
};
```

**Property Test for State Machine:**

```typescript
it('RC-SM-001: scheduler state machine has no invalid transitions', () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom('START', 'STOP', 'AUDIO_READY', 'AUDIO_FAILED')),
    (events) => {
      const sm = createSchedulerStateMachine();
      for (const eventType of events) {
        const event = { type: eventType };
        if (sm.canTransition(event)) {
          sm.transition(event);
        }
        // Invariant: State is always valid
        expect(['stopped', 'starting', 'playing', 'stopping']).toContain(sm.state);
      }
    }
  ));
});
```

### 9.3 Missing Abstractions to Create

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| `SchedulerStateMachine` | `audio/scheduler-state-machine.ts` | Explicit play/stop transitions |
| `MutationStateMachine` | `sync/mutation-state-machine.ts` | Explicit mutation lifecycle |
| `AudioContextManager` | `audio/context-manager.ts` | Singleton with testable interface |
| `TimingCalculations` | `audio/timing-calculations.ts` | Pure timing math |
| `InvariantChecker` | `worker/invariant-checker.ts` | Runtime invariant assertions |

### 9.4 Dependency Injection for Mocking

**Problem:** Audio engine is a singleton, hard to mock.

**Solution: Inject Dependencies**

```typescript
// Before: Tight coupling
export class Scheduler {
  constructor() {
    this.engine = audioEngine; // Global singleton
  }
}

// After: Dependency injection
export interface AudioEngineInterface {
  getCurrentTime(): number;
  isInitialized(): boolean;
  playSample(...): void;
}

export class Scheduler {
  constructor(private engine: AudioEngineInterface = audioEngine) {}
}

// In tests:
const mockEngine = createMockAudioEngine();
const scheduler = new Scheduler(mockEngine);
```

---

## 10. Cross-Component Invariant Assertions

### 10.1 The Problem

Components make assumptions about each other:
- Scheduler assumes tracks have `stepCount ≤ MAX_STEPS`
- Sync assumes hash is deterministic
- Audio assumes instruments are loaded before playing

These assumptions are implicit and can break silently.

### 10.2 Solution: Assertion Boundaries

Create explicit assertion points at component boundaries:

```typescript
// app/src/utils/invariant-assertions.ts

export function assertValidTrackForScheduler(track: Track): asserts track is ValidTrack {
  if (track.steps.length !== MAX_STEPS) {
    throw new InvariantViolation('Track steps must be MAX_STEPS', {
      actual: track.steps.length,
      expected: MAX_STEPS
    });
  }
  if (track.stepCount < 1 || track.stepCount > MAX_STEPS) {
    throw new InvariantViolation('Track stepCount out of range', {
      stepCount: track.stepCount
    });
  }
}

export function assertValidStateForHash(state: SessionState): asserts state is HashableState {
  if (state.tracks.some(t => t.id === undefined)) {
    throw new InvariantViolation('All tracks must have IDs for hashing');
  }
}

export function assertValidMutationTransition(
  from: MutationState,
  to: MutationState
): void {
  const validTransitions: Record<MutationState, MutationState[]> = {
    pending: ['confirmed', 'superseded', 'lost'],
    confirmed: ['cleared'],
    superseded: [],
    lost: [],
    cleared: [],
  };

  if (!validTransitions[from].includes(to)) {
    throw new InvariantViolation(`Invalid mutation transition: ${from} → ${to}`);
  }
}
```

### 10.3 Layer Invariant Matrix

| From Layer | To Layer | Invariant | Assertion Location |
|------------|----------|-----------|-------------------|
| Worker → Scheduler | Track validity | `steps.length === 128` | `scheduleStep()` entry |
| Sync → Hash | State completeness | All tracks have IDs | `canonicalizeForHash()` entry |
| UI → Worker | Message validity | Tempo in [60, 180] | `handleMessage()` entry |
| Scheduler → Audio | Instrument readiness | Instrument loaded | `playSample()` entry |

### 10.4 Runtime vs Test-Time Assertions

```typescript
// app/src/utils/assertions.ts

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';
const ASSERTIONS_ENABLED = IS_DEVELOPMENT || process.env.ENABLE_ASSERTIONS;

export function assertInvariant(
  condition: boolean,
  message: string,
  context?: object
): asserts condition {
  if (!ASSERTIONS_ENABLED) return;

  if (!condition) {
    console.error('[INVARIANT VIOLATION]', message, context);
    if (IS_DEVELOPMENT) {
      throw new InvariantViolation(message, context);
    }
    // In production, log but don't crash
    reportToErrorTracking({ type: 'invariant_violation', message, context });
  }
}
```

### 10.5 Property Test for Cross-Component Invariants

```typescript
// XC-001: Hash after mutations
it('XC-001: state hash is consistent after any mutation sequence', () => {
  fc.assert(fc.property(
    arbSessionState,
    fc.array(arbMutation, { maxLength: 50 }),
    (initialState, mutations) => {
      let state = initialState;

      for (const mutation of mutations) {
        state = applyMutation(state, mutation);

        // Cross-component invariant: state is always hashable
        const hash1 = hashState(canonicalizeForHash(state));
        const hash2 = hashState(canonicalizeForHash(state));
        expect(hash1).toBe(hash2);

        // Cross-component invariant: state satisfies scheduler requirements
        for (const track of state.tracks) {
          expect(track.steps.length).toBe(MAX_STEPS);
          expect(track.stepCount).toBeLessThanOrEqual(MAX_STEPS);
        }
      }
    }
  ), { numRuns: 200 });
});
```

---

## 11. Success Metrics and Measurement

### 11.1 Key Performance Indicators

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Property Coverage** | 100% of Tier 1, 80% of Tier 2 | Checklist in Appendix |
| **Mutation Score** | ≥80% for property-tested modules | Stryker mutation testing |
| **Bug Detection Rate** | 50% of bugs found by PBT before manual testing | Track in bug reports |
| **Shrink Quality** | Counterexamples ≤10 elements | Manual review of failures |
| **Test Speed** | ≤30 seconds for full property suite | CI metrics |
| **Regression Prevention** | Zero regressions in property-tested code | Track in postmortems |

### 11.2 Measurement Dashboard

```typescript
// scripts/pbt-metrics.ts
interface PBTMetrics {
  totalProperties: number;
  propertiesByTier: Record<'tier1' | 'tier2' | 'tier3', number>;
  implementedProperties: number;
  averageNumRuns: number;
  lastMutationScore: number;
  bugsFoundByPBT: number;
  totalBugs: number;
}

async function collectMetrics(): Promise<PBTMetrics> {
  const propertyFiles = await glob('**/*.property.test.ts');
  // Parse and count properties
  // Compare against spec
}
```

### 11.3 Scoring Rubric

| Score | Description | Criteria |
|-------|-------------|----------|
| **A** | Excellent | All Tier 1+2 properties, mutation score ≥85%, no surviving mutants in critical code |
| **B** | Good | All Tier 1 properties, mutation score ≥75%, <5 surviving critical mutants |
| **C** | Adequate | 80% Tier 1 properties, mutation score ≥60%, <10 surviving critical mutants |
| **D** | Needs Work | <80% Tier 1 properties, mutation score <60% |
| **F** | Failing | No property tests or mutation testing |

**Current Score: B** (All Tier 1 implemented, mutation testing not yet integrated)

### 11.4 Continuous Improvement Process

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Weekly: Review shrunk counterexamples from failed CI runs  │
│                            ↓                                    │
│  2. Bi-weekly: Run mutation testing, identify surviving mutants │
│                            ↓                                    │
│  3. Monthly: Review metrics, update Tier priorities             │
│                            ↓                                    │
│  4. Quarterly: Update spec with new properties discovered       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. CI/CD Integration

### 12.1 Seed Persistence Strategy

```yaml
# .github/workflows/test.yml
jobs:
  property-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run property tests
        run: npm test -- --testNamePattern="property"
        env:
          FC_SEED: ${{ github.run_number }}  # Reproducible per CI run

      - name: Save failing seeds
        if: failure()
        run: |
          echo "${{ github.run_number }}" >> .fast-check-seeds
          git add .fast-check-seeds
          git commit -m "chore: save failing seed ${{ github.run_number }}"
          git push
```

### 12.2 numRuns Configuration by Environment

```typescript
// vitest.setup.ts
import fc from 'fast-check';

const environment = process.env.CI
  ? (process.env.GITHUB_REF === 'refs/heads/main' ? 'main' : 'pr')
  : 'local';

const numRunsConfig: Record<string, number> = {
  local: 100,      // Fast feedback
  pr: 200,         // Thorough for PRs
  main: 500,       // Most thorough for main
  nightly: 5000,   // Exhaustive nightly run
};

fc.configureGlobal({
  numRuns: numRunsConfig[environment] ?? 100,
  interruptAfterTimeLimit: environment === 'nightly' ? 60000 : 10000,
  markInterruptAsFailure: true,
  reporter: (log) => {
    if (log.failed) {
      console.error(`Property failed with seed: ${log.seed}`);
      console.error(`Counterexample: ${JSON.stringify(log.counterexample)}`);
    }
  }
});
```

### 12.3 Nightly Deep Testing

```yaml
# .github/workflows/nightly-pbt.yml
name: Nightly Property Testing
on:
  schedule:
    - cron: '0 3 * * *'  # 3 AM UTC daily
  workflow_dispatch:

jobs:
  deep-property-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Deep property test run
        run: npm test -- --testNamePattern="property"
        env:
          FC_NUM_RUNS: 10000
          FC_SEED: ${{ github.run_id }}
        timeout-minutes: 30

      - name: Run mutation testing
        run: npx stryker run
        timeout-minutes: 60

      - name: Upload mutation report
        uses: actions/upload-artifact@v4
        with:
          name: mutation-report
          path: reports/mutation/
```

### 12.4 Failure Alerting

```typescript
// scripts/pbt-failure-alert.ts
interface FailureReport {
  property: string;
  seed: number;
  counterexample: unknown;
  shrinkPath: string;
}

async function alertOnFailure(report: FailureReport): Promise<void> {
  // Post to Slack/Discord
  await fetch(process.env.ALERT_WEBHOOK, {
    method: 'POST',
    body: JSON.stringify({
      text: `🚨 Property test failed: ${report.property}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Seed:* ${report.seed}` }},
        { type: 'section', text: { type: 'mrkdwn', text: `*Counterexample:* \`${JSON.stringify(report.counterexample)}\`` }},
      ]
    })
  });
}
```

---

## 13. Race Condition Testing

### 13.1 Using fast-check's Scheduler

fast-check provides `fc.scheduler()` for testing race conditions:

```typescript
import fc from 'fast-check';

describe('Race Condition Properties', () => {
  it('RC-001: concurrent play/stop never crashes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        const scheduler = new MockScheduler();

        // Wrap async operations with scheduler control
        const wrappedPlay = s.scheduleFunction(async () => {
          await scheduler.start();
        });
        const wrappedStop = s.scheduleFunction(async () => {
          await scheduler.stop();
        });

        // Fire both concurrently
        const playPromise = wrappedPlay();
        const stopPromise = wrappedStop();

        // Let scheduler explore interleavings
        await s.waitAll();
        await Promise.allSettled([playPromise, stopPromise]);

        // Invariant: System is in a consistent state
        expect(scheduler.isConsistent()).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('RC-002: adding instruments during playback eventually loads them', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.constantFrom(...INSTRUMENT_IDS), { minLength: 1, maxLength: 5 }),
        async (s, instruments) => {
          const engine = new MockAudioEngine();
          engine.startPlayback();

          const wrappedAddInstrument = s.scheduleFunction(
            async (id: string) => engine.addInstrument(id)
          );

          // Add instruments during playback
          const addPromises = instruments.map(id => wrappedAddInstrument(id));
          await s.waitAll();
          await Promise.allSettled(addPromises);

          // Wait for loading to complete
          await engine.waitForQuiescence();

          // Invariant: All instruments eventually loaded
          for (const id of instruments) {
            expect(engine.isInstrumentReady(id)).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
```

### 13.2 Mock Infrastructure Required

```typescript
// app/src/test/mocks/mock-scheduler.ts
export class MockScheduler {
  private state: 'stopped' | 'starting' | 'playing' | 'stopping' = 'stopped';
  private pendingTimers = new Set<number>();

  async start(): Promise<void> {
    if (this.state !== 'stopped') return;
    this.state = 'starting';
    await this.simulateAsyncOperation();
    this.state = 'playing';
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    this.state = 'stopping';
    this.clearAllTimers();
    await this.simulateAsyncOperation();
    this.state = 'stopped';
  }

  isConsistent(): boolean {
    if (this.state === 'stopped') {
      return this.pendingTimers.size === 0;
    }
    return true;
  }

  private async simulateAsyncOperation(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  private clearAllTimers(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}
```

### 13.3 Race Condition Properties Catalog

| Property ID | Description | Coverage |
|------------|-------------|----------|
| RC-001 | Play/stop race safety | Scheduler |
| RC-002 | Instrument loading during playback | Audio Engine |
| RC-003 | WebSocket message ordering | Sync |
| RC-004 | HMR during playback | Hot reloading |
| RC-005 | State update during render | React reconciliation |

---

## 14. Model-Based Testing

### 14.1 When to Use Model-Based Testing

Use model-based testing when:
- System has complex state transitions
- Multiple operations can be applied in any order
- State machine has many valid paths

### 14.2 Mutation Tracker Model

```typescript
// app/src/sync/mutation-tracker.model.test.ts
import fc from 'fast-check';

// Simplified model of the mutation tracker
class MutationTrackerModel {
  private mutations = new Map<number, 'pending' | 'confirmed'>();

  track(seq: number): void {
    this.mutations.set(seq, 'pending');
  }

  confirm(seq: number): boolean {
    if (this.mutations.get(seq) === 'pending') {
      this.mutations.set(seq, 'confirmed');
      return true;
    }
    return false;
  }

  getPendingCount(): number {
    return [...this.mutations.values()].filter(s => s === 'pending').length;
  }

  getConfirmedCount(): number {
    return [...this.mutations.values()].filter(s => s === 'confirmed').length;
  }
}

// Commands that operate on both model and real system
class TrackCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  constructor(readonly seq: number) {}

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true; // Always valid
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const input = { seq: this.seq, type: 'toggle_step', trackId: 'test', sentAt: Date.now() };
    model.track(this.seq);
    real.trackMutation(input);

    // Invariant check
    expect(real.getPendingCount()).toBe(model.getPendingCount());
  }

  toString(): string {
    return `track(${this.seq})`;
  }
}

class ConfirmCommand implements fc.Command<MutationTrackerModel, MutationTracker> {
  constructor(readonly seq: number) {}

  check(_model: Readonly<MutationTrackerModel>): boolean {
    return true;
  }

  run(model: MutationTrackerModel, real: MutationTracker): void {
    const modelResult = model.confirm(this.seq);
    const realResult = real.confirmMutation(this.seq);

    expect(realResult).toBe(modelResult);
    expect(real.getConfirmedCount()).toBe(model.getConfirmedCount());
  }

  toString(): string {
    return `confirm(${this.seq})`;
  }
}

// Property test using commands
describe('Model-Based Mutation Tracker Tests', () => {
  it('MB-001: mutation tracker matches model for any command sequence', () => {
    fc.assert(
      fc.property(
        fc.commands([
          fc.nat({ max: 100 }).map(seq => new TrackCommand(seq)),
          fc.nat({ max: 100 }).map(seq => new ConfirmCommand(seq)),
        ], { maxCommands: 50 }),
        (commands) => {
          const setup = () => ({
            model: new MutationTrackerModel(),
            real: new MutationTracker({ enableLogging: false }),
          });

          fc.modelRun(setup, commands);
        }
      ),
      { numRuns: 200 }
    );
  });
});
```

### 14.3 Scheduler State Machine Model

```typescript
// app/src/audio/scheduler.model.test.ts

type SchedulerModelState = 'stopped' | 'playing';

class SchedulerModel {
  state: SchedulerModelState = 'stopped';
  currentStep = 0;

  start(): void {
    if (this.state === 'stopped') {
      this.state = 'playing';
    }
  }

  stop(): void {
    if (this.state === 'playing') {
      this.state = 'stopped';
      this.currentStep = 0;
    }
  }

  advanceStep(loopEnd: number): void {
    if (this.state === 'playing') {
      this.currentStep = (this.currentStep + 1) % loopEnd;
    }
  }
}

class StartCommand implements fc.Command<SchedulerModel, MockScheduler> {
  check(model: Readonly<SchedulerModel>): boolean {
    return model.state === 'stopped';
  }

  run(model: SchedulerModel, real: MockScheduler): void {
    model.start();
    real.start();
    expect(real.isPlaying()).toBe(model.state === 'playing');
  }

  toString(): string { return 'start()'; }
}

class StopCommand implements fc.Command<SchedulerModel, MockScheduler> {
  check(model: Readonly<SchedulerModel>): boolean {
    return model.state === 'playing';
  }

  run(model: SchedulerModel, real: MockScheduler): void {
    model.stop();
    real.stop();
    expect(real.isPlaying()).toBe(false);
    expect(real.getCurrentStep()).toBe(0);
  }

  toString(): string { return 'stop()'; }
}
```

### 14.4 Model-Based Testing Guidelines

1. **Keep models simple**: The model should be obviously correct, even if slow
2. **Test equivalence, not implementation**: Model and real should have same observable behavior
3. **Use `check()` to constrain valid commands**: Prevent invalid state transitions
4. **Log command sequences**: Makes debugging failures easier

---

## 15. Lessons Learned and Retrospective

### 15.1 What We Learned

#### The Spec-First Approach Forced Clarity
Writing the spec before implementation revealed that we didn't fully understand our own invariants. Questions like "What exactly should `snapToScale` guarantee?" forced us to formalize implicit assumptions.

#### Domain Modeling is Everything
The arbitraries (`arbStepCount`, `arbPitch`, `arbTrackForHash`) are the real intellectual work. A `fc.integer()` isn't useful; an `arbStepCount` that only generates valid polyrhythmic step counts *is*.

#### Algebraic Properties Are Abundant in Music Software
Music has deep mathematical structure:
- Rotation identity (shifting a loop returns to start)
- Scale membership (pitch class equivalence mod 12)
- Swing commutativity (global + track blending)
- Hash determinism (same state → same sync)

#### Bug Hunting Revealed Architectural Issues
Finding `hash = hash & hash` (a no-op) and the tied note wrap-around bug revealed that the codebase lacks defensive invariant checks.

### 15.2 What We'd Do Differently

| Change | Rationale |
|--------|-----------|
| Embed invariants in types | `steps.length === 128` should be a branded type, not a test |
| Design for testability | Extract pure functions from private methods |
| Write properties before implementation | TDD with properties |
| Integrate mutation testing from day 1 | Know if properties are strong enough |
| Seed persistence in CI | Make failures reproducible |

### 15.3 What We Missed/Deferred

| Gap | Impact | Priority |
|-----|--------|----------|
| Async testing for race conditions | Audio bugs undetected | High |
| Integration testing across components | Cross-layer bugs | Medium |
| Model-based testing for state machines | State transition bugs | Medium |
| Error path testing with invalid inputs | Validation gaps | Low |
| AU-005 voice counting (needs mock) | Voice limit bugs | Medium |

### 15.4 What's Still Missing from the Spec

1. **Property discovery process**: How should developers identify new properties?
2. **Invariant documentation**: Where should invariants live in code?
3. **Test maintenance**: What happens when requirements change?
4. **Custom shrinking strategies**: When to write custom shrinkers?

### 15.5 What We Learned About Keyboardia

1. **The audio scheduler is a hidden state machine** with implicit transitions
2. **Multiplayer sync has fragile invariants** that nothing enforces
3. **Validation is inconsistent** (some clamp, some reject)
4. **Polyrhythms create combinatorial complexity** (LCM > MAX_STEPS)
5. **The codebase has latent bugs** documented by our property tests

### 15.6 Industry Best Practices Applied

Based on research of successful TypeScript PBT adoption:

| Practice | Implementation |
|----------|----------------|
| Centralized arbitraries | `app/src/test/arbitraries.ts` |
| Property IDs for traceability | PO-001, SY-003, etc. |
| Separate property test files | `*.property.test.ts` |
| numRuns by environment | CI vs local vs nightly |
| Combine with example tests | Property + example for full coverage |

---

## 16. Abstraction Fixes Implemented

This section documents the missing or incorrect abstractions that PBT revealed and the fixes applied.

### 16.1 Stats Corruption: Derived vs Cached Values (MB-006)

**Bug Found:** Model-based testing discovered that `MutationTracker` maintained cached stats (`pending`, `confirmed` counters) that could diverge from the actual map state when re-tracking a confirmed seq.

**Root Cause:** `trackMutation()` unconditionally incremented `stats.pending` even when overwriting an existing entry.

**Fix Applied:**
```typescript
// Before: Cached stats (could diverge)
private stats: MutationStats = { pending: 0, confirmed: 0, ... };
trackMutation(m) { this.pendingMutations.set(m.seq, ...); this.stats.pending++; }

// After: Derived stats (always accurate)
getStats(): MutationStats {
  return {
    pending: this.getPendingCount(),     // Derived from map iteration
    confirmed: this.getConfirmedCount(), // Derived from map iteration
    superseded: this.supersededCount,    // Counter for removed items
    lost: this.lostCount,                // Counter for removed items
  };
}
```

**Lesson:** When state can be derived, deriving it eliminates consistency bugs. The model's simplicity exposed the real code's optimization-induced bug.

### 16.2 All-or-Nothing Validation: Field-Level Preservation (VA-004)

**Bug Found:** `validateParameterLock` rejected the entire lock when one field was invalid, losing valid data.

**Root Cause:** Early-return pattern that checked each field and returned null on first failure.

**Fix Applied:**
```typescript
// Before: All-or-nothing rejection
if (!isFinite(input.pitch)) return null; // Loses valid volume!

// After: Field-level validation with partial preservation
if (typeof input.pitch === 'number' && isFinite(input.pitch)) {
  result.pitch = clamp(input.pitch, ...);
  hasValidField = true;
}
// Invalid pitch is silently dropped, preserving other valid fields
```

**Lesson:** Validation should preserve valid fields. Use `ValidationResult<T>` patterns with separate `valid` and `errors` fields.

### 16.3 Loop Boundary: Step Count vs Index Comparison (AU-004d)

**Bug Found:** `calculateTiedDuration` failed at loop boundaries because `while (nextStep > startStep)` is false when step wraps to 0.

**Root Cause:** Linear loop condition on circular data.

**Fix Applied:**
```typescript
// Before: Index comparison (fails at wrap-around)
while (nextStep > startStep && nextStep < trackStepCount) { ... }

// After: Step count iteration (handles wrap-around)
let stepsChecked = 0;
while (stepsChecked < trackStepCount - 1) {
  const nextStep = (startStep + 1 + stepsChecked) % trackStepCount;
  if (track.steps[nextStep] && nextPLock?.tie === true) {
    tieCount++;
    stepsChecked++;
  } else break;
}
```

**Lesson:** Circular sequences are fundamentally different from linear sequences. Use step counting instead of index comparison.

### 16.4 Pure Timing Calculations: Extracted Module

**Gap Identified:** Scheduler mixed pure timing calculations with side-effectful Web Audio API calls, making testing difficult.

**Fix Applied:** Created `app/src/audio/timing-calculations.ts` with pure functions:
- `getStepDuration(tempo)` - Step duration calculation
- `calculateSwingDelay(step, globalSwing, trackSwing, stepDuration)` - Swing delay
- `calculateTiedDuration(track, startStep, trackStepCount, stepDuration)` - Tied note duration
- `advanceStep(currentStep, loopRegion)` - Step advancement with loop handling

**Lesson:** Extract pure functions from classes with side effects. Pure functions are trivially testable with PBT.

### 16.5 Abstraction Patterns Catalog

| Bug | Root Cause | Correct Abstraction |
|-----|-----------|---------------------|
| Stats corruption | Cached stats diverge from source | Derived values (compute from map) |
| Partial lock rejection | All-or-nothing validation | Field-level validation result |
| Tied note wrap | Linear loop on circular data | Circular range iterator / step counting |
| Untestable timing | Pure/impure coupling | Extracted pure timing module |
| Local state overwrite | Implicit field ownership | Field ownership metadata (future) |
| Type parity drift | Independent type evolution | Schema-derived types (future) |
| Invalid transitions | Implicit state machine | Explicit FSM with transitions (future) |

### 16.6 Implementation Status

| Fix | Status | Files Modified |
|-----|--------|----------------|
| Derived stats (MB-006) | ✅ Complete | `mutation-tracker.ts` |
| Partial lock preservation (VA-004) | ✅ Complete | `invariants.ts` |
| Loop boundary fix (AU-004d) | ✅ Complete | `scheduler.ts` |
| Pure timing module | ✅ Complete | `timing-calculations.ts` (new) |
| Field ownership metadata | 🔜 Future | - |
| Schema-derived types | 🔜 Future | - |
| Explicit state machine | 🔜 Future | - |

---

## References

### Academic Papers
1. Claessen, K., & Hughes, J. (2000). QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs.
2. Hughes, J. (2007). QuickCheck Testing for Fun and Profit.
3. Papadakis, M., et al. (2019). Mutation Testing Advances: An Analysis and Survey.
4. ACM Study (2024). Empirical Evaluation of Property-Based Testing - Each PBT finds ~50x more mutations than average unit test.

### Tools and Documentation
5. fast-check documentation: https://fast-check.dev/
6. fast-check GitHub: https://github.com/dubzzz/fast-check
7. fast-check Model-Based Testing: https://fast-check.dev/docs/advanced/model-based-testing/
8. fast-check Race Condition Detection: https://fast-check.dev/docs/tutorials/detect-race-conditions/
9. Stryker Mutation Testing: https://stryker-mutator.io/
10. Hypothesis documentation: https://hypothesis.readthedocs.io/

### Industry Resources
11. Nicolas Dubien - Introduction to Property Based Testing: https://medium.com/criteo-engineering/introduction-to-property-based-testing-f5236229d237
12. James Sinclair - Getting Started with PBT in JavaScript: https://jrsinclair.com/articles/2021/how-to-get-started-with-property-based-testing-in-javascript-with-fast-check/
13. Andrea Leopardi - Example and Property Tests Are Best Friends: https://andrealeopardi.com/posts/example-based-tests-and-property-based-tests-are-best-friends/
14. F# for Fun and Profit - Choosing Properties: https://swlaschin.gitbooks.io/fsharpforfunandprofit/content/posts/property-based-testing-2.html

### Keyboardia-Specific
15. Keyboardia Bug Pattern Registry: `app/src/utils/bug-patterns.ts`
16. Keyboardia Debugging Lessons: `docs/DEBUGGING-LESSONS-LEARNED.md`

---

## 17. Infrastructure Retrospective: Testing Real Code

This section documents critical lessons learned during a deep audit of the PBT implementation.

### 17.1 Critical Finding: Testing Duplicates vs Real Code

**Discovery:** During the retrospective, we found that `scheduler.property.test.ts` contained **80 lines of duplicated function definitions** instead of importing from `timing-calculations.ts`.

| Test File | Was Testing Real Code? |
|-----------|------------------------|
| `timing-calculations.property.test.ts` | ✅ YES |
| `scheduler.property.test.ts` | ❌ **NO** - had inline duplicates |
| `canonicalHash.property.test.ts` | ✅ YES |
| `mutation-tracker.property.test.ts` | ✅ YES |
| `mutation-tracker.model.test.ts` | ✅ YES |
| `validators.property.test.ts` | ✅ YES |
| `music-theory.property.test.ts` | ✅ YES |
| `patternOps.property.test.ts` | ✅ YES |

**Root Cause:** When extracting pure functions for testability, the test file defined its own copies with comments like "same logic as Scheduler" instead of importing from the extracted module.

**Impact:** Tests could pass even if the real Scheduler had bugs. The duplicates might drift from the real implementation.

**Fix Applied:**
```typescript
// Before: 80 lines of duplicated logic
function getStepDuration(tempo) { ... }  // "same logic as Scheduler"
function calculateSwingDelay(...) { ... } // "same logic as Scheduler"

// After: Import real implementation
import {
  getStepDuration,
  calculateSwingDelay,
  calculateTiedDuration,
  calculateStepTime,
  advanceStep,
  MAX_STEPS,
} from './timing-calculations';
```

### 17.2 Why Verification Sub-Agents Missed This

The sub-agent that rated the implementation 95/100 couldn't detect this issue because:

1. **Tests ran and passed** - The duplicated logic happened to be correct
2. **Code looked structurally correct** - Files, tests, and patterns were well-organized
3. **Comments claimed equivalence** - "same logic as Scheduler" isn't verifiable

**Lesson:** Verification agents see "tests pass" but not "tests aren't testing the right thing." Human review of import statements is still essential.

### 17.3 Infrastructure Issues Found

| Issue | Category | Fix Applied |
|-------|----------|-------------|
| Build failing (TypeScript errors) | Build | Fixed unused imports, property syntax |
| `createTrackWithTies` returned `{locks}` not `{parameterLocks}` | Type | Fixed return type |
| Unused imports in property tests | Lint | Removed unused imports |
| `erasableSyntaxOnly` errors in model tests | Syntax | Converted parameter properties |
| Missing preconditions in hash test | Logic | Added `stepToToggle < stepCount` check |
| Pre-existing test failures (reorder_tracks) | Test | Added new message type to all test lists |

### 17.4 New Checklist for PBT Implementation

Before claiming PBT implementation is complete:

- [ ] **Import Audit**: Every property test file imports from production modules
- [ ] **No "same logic as" comments**: If you see this, you're testing duplicates
- [ ] **Build passes**: `tsc` and `npm run build` succeed
- [ ] **All tests pass**: Not just property tests, but the full suite
- [ ] **Arbitraries return correct types**: Field names match production types
- [ ] **Preconditions match domain**: Generated values stay within valid ranges

### 17.5 Recommended CI/CD Changes

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - name: Type Check (MUST pass before tests)
        run: tsc --noEmit

      - name: Build (MUST pass before tests)
        run: npm run build

      - name: Import Audit (prevent testing duplicates)
        run: |
          # Fail if any property test defines functions instead of importing
          if grep -r "function getStepDuration\|function calculateSwingDelay" src/**/*.property.test.ts; then
            echo "ERROR: Property tests must import, not redefine functions"
            exit 1
          fi

      - name: Run Tests
        run: npm test
```

### 17.6 If Starting Again

| What We'd Keep | What We'd Change |
|----------------|------------------|
| Comprehensive spec first | Start with import audit checklist |
| Model-based testing for state | Extract-then-test, not test-then-extract |
| fast-check arbitraries | CI must include `tsc` before tests |
| Property IDs for traceability | Add import assertions to spec |
| Centralized arbitraries file | Review all "same logic as X" comments |

---

## Changelog

### Version 2.2 (2026-01-04)
- **Critical infrastructure fixes** from retrospective audit:
  - Fixed `scheduler.property.test.ts` to import from `timing-calculations.ts` (was testing duplicates!)
  - Fixed `createTrackWithTies` return type (`parameterLocks` not `locks`)
  - Fixed unused TypeScript imports across property test files
  - Fixed `erasableSyntaxOnly` errors in model-based tests
  - Fixed hash test precondition for `stepToToggle`
  - Fixed pre-existing test failures (added `reorder_tracks` message type)
- Added Section 17: Infrastructure Retrospective
- All 2896 tests now pass (174 property tests, 7 model tests)
- Updated version to 2.2

### Version 2.1 (2026-01-04)
- **Implemented abstraction fixes** revealed by PBT analysis:
  - Fixed stats corruption in MutationTracker (derived values)
  - Fixed VA-004 partial lock validation (field-level preservation)
  - Fixed AU-004d tied note duration at loop boundary (step counting)
  - Created pure timing calculations module for testability
- Added Section 16: Abstraction Fixes Implemented
- Updated to 181 passing property tests across 8 test files
- Updated status to "Abstraction Fixes Implemented"

### Version 2.0 (2026-01-04)
- Added sections 9-15 covering architectural changes, cross-component invariants, metrics, CI/CD, race condition testing, model-based testing, and retrospective
- Added property IDs for race conditions (RC-001 to RC-005) and cross-component (XC-001 to XC-003)
- Updated status to "Implementation Complete + Retrospective"
- Added industry research findings on TypeScript PBT adoption
- Added current score assessment (B) and improvement roadmap

### Version 1.0 (2026-01-04)
- Initial specification covering PBT fundamentals, priority areas, property specifications
- Property catalog for pattern operations, music theory, sync, audio, and validation modules
