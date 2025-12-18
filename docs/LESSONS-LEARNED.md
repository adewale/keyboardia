# Lessons Learned

Debugging war stories and insights from building Keyboardia.

---

## Table of Contents

### Audio Engineering
- [Gain Staging: The Tinny Sound Problem](#gain-staging-the-tinny-sound-problem)
- [Memory Leaks in Web Audio](#memory-leaks-in-web-audio)
- [Voice Limiting and Polyphony](#voice-limiting-and-polyphony)
- [Click Prevention with Micro-Fades](#click-prevention-with-micro-fades)
- [Exponential vs Linear Envelopes](#exponential-vs-linear-envelopes)
- [Duplicate Bug = Missing Abstraction: Tone.js Time Conversion](#duplicate-bug--missing-abstraction-tonejs-time-conversion)
- [Sampled Instrument Race Condition: Preload at Init](#sampled-instrument-race-condition-preload-at-init)
- [Concurrent Initialization Guards](#concurrent-initialization-guards)
- [Never Silently Substitute Sounds](#never-silently-substitute-sounds)
- [Dependency Injection for Audio Testing](#dependency-injection-for-audio-testing)

### Frontend / Mobile
- [The Ghost Click Bug (Mobile Toggle Revert)](#2024-12-11-the-ghost-click-bug-mobile-toggle-revert)
- [AudioContext and mouseenter: The Hidden User Gesture Trap](#audiocontext-and-mouseenter-the-hidden-user-gesture-trap)
- [iOS Audio: No Sound Despite Animation](#ios-audio-no-sound-despite-animation)

### Multiplayer / Backend
- [Lesson 1: Duplicate Track IDs Cause Corruption](#lesson-1-duplicate-track-ids-cause-corruption)
- [Lesson 2: KV and DO State Can Diverge](#lesson-2-kv-and-do-state-can-diverge)
- [Lesson 3: DO Hibernation Breaks setTimeout](#lesson-3-do-hibernation-breaks-settimeout)
- [Lesson 4: Browser Must Refresh to See KV Updates](#lesson-4-browser-must-refresh-to-see-kv-updates)
- [Lesson 5: The DELETE Operation Pitfall](#lesson-5-the-delete-operation-pitfall)
- [Lesson 6: Reconnection Needs Jitter](#lesson-6-reconnection-needs-jitter)
- [Lesson 7: Offline Queues Need Limits](#lesson-7-offline-queues-need-limits)
- [Lesson 8: Connection Status Must Be Visible](#lesson-8-connection-status-must-be-visible)
- [Lesson 9: Validate Requests Before Routing to Durable Objects](#lesson-9-validate-requests-before-routing-to-durable-objects)
- [Lesson 10: Recreate DO Stubs on Retryable Errors](#lesson-10-recreate-do-stubs-on-retryable-errors)
- [Lesson 11: Client-Side Timeouts Prevent Hung Connections](#lesson-11-client-side-timeouts-prevent-hung-connections)
- [Lesson 12: XSS Prevention in User-Controlled Fields](#lesson-12-xss-prevention-in-user-controlled-fields)
- [Lesson 13: WebSocket Connection Storm (Production-Only)](#lesson-13-websocket-connection-storm-production-only)
- [Lesson 14: State Hash Mismatch (Production-Only)](#lesson-14-state-hash-mismatch-production-only)

### Reference
- [Cloudflare Component Interactions](#cloudflare-component-interactions)
- [Testing Multiplayer Systems](#testing-multiplayer-systems)

### Architectural
- [Lesson: The Three Surfaces Must Align](#lesson-the-three-surfaces-must-align)
- [Lesson: Local-Only Audio Features Are a Category Risk](#lesson-local-only-audio-features-are-a-category-risk)
- [Lesson: Historical Layering Creates Hidden Duplication](#lesson-historical-layering-creates-hidden-duplication)
- [Lesson: Read the Spec Before Implementing](#lesson-read-the-spec-before-implementing)
- [Lesson: Test the Spec, Not Your Mental Model](#lesson-test-the-spec-not-your-mental-model)

### Process
- [Process: Spec-First Development Checklist](#process-spec-first-development-checklist)
- [Process: Spec-Test Alignment Audit](#process-spec-test-alignment-audit)

### E2E Testing
- [Lesson 15: E2E Tests Must Use Correct API Response Structure](#lesson-15-e2e-tests-must-use-correct-api-response-structure)
- [Lesson 16: CI Tests Need Retry Logic for API Resilience](#lesson-16-ci-tests-need-retry-logic-for-api-resilience)
- [Lesson 17: Test Scripts Must Match Server Message Structure](#lesson-17-test-scripts-must-match-server-message-structure)
- [Lesson 18: KV Save Debouncing Can Cause Test Timing Issues](#lesson-18-kv-save-debouncing-can-cause-test-timing-issues)

### Future Work
- [Future: Publish Provenance (Forward References)](#future-publish-provenance-forward-references)

---

# Architectural Lessons

---

## Lesson: The Three Surfaces Must Align

**Date:** 2024-12 (Phase 20: Musical Foundations)

### The Mistake

We implemented reverb and delay effects as client-side audio processing without considering the full integration requirements. The implementation existed only in the audio engine API, with no:
- Session state persistence
- Multiplayer synchronization
- UI controls

This created a divergence between three surfaces that must always align in Keyboardia:

| Surface | Purpose | Example |
|---------|---------|---------|
| **API** | What the code can do | `audioEngine.setReverbEnabled(true)` |
| **UI** | What users can control | Swing slider in Transport |
| **Session State** | What persists and syncs | `{ tempo, swing, tracks }` |

### Why It Matters

Keyboardia's core principle is: **"Everyone hears the same music."**

Features that exist only in the API violate this principle:
- Player A enables reverb → only Player A hears it
- Session is saved → effect settings are lost
- New player joins → they hear different audio

This breaks the fundamental promise of the product.

### The Test

Before implementing any feature, ask:

1. **Does it sync?** Will all players experience the same thing?
2. **Does it persist?** Will it survive a page reload?
3. **Does it have UI?** Can users discover and control it?

If any answer is "no," the feature is incomplete and risks product coherence.

### The Fix

We rolled back the effects implementation. The triplet grids and extended pitch range remained because they pass all three tests:
- `stepCount` syncs via WebSocket ✓
- `stepCount` persists in SessionState ✓
- Step count selector exists in TrackRow UI ✓

### Key Lessons

1. **API, UI, and State must align** — A feature isn't done until all three support it
2. **"Everyone hears the same music"** — Any audio-affecting feature must sync
3. **Partial implementations break trust** — Users expect features to work completely

---

## Lesson: Local-Only Audio Features Are a Category Risk

**Date:** 2024-12 (Phase 20: Musical Foundations)

### The Pattern

Some features are tempting to implement as "local-only" because they're easier:
- Audio effects (reverb, delay, EQ)
- Visual preferences (theme, zoom level)
- Playback modifiers (but wait — solo and mute DO sync)

The danger is that "local-only" in a multiplayer context means "breaks the shared experience."

### The Heuristic

**Audio-affecting features must sync.** If it changes what you hear, everyone must hear the same change.

**Visual-only features may be local.** Theme preferences, cursor smoothing, UI density — these don't affect the shared audio and can safely differ between players.

### Effects as End-of-Project Work

Audio effects (reverb, delay, filters, etc.) represent a category of work that should be **deferred to the end of the project** because:

1. **High integration cost**: They touch session state, WebSocket protocol, server validation, and UI
2. **High coherence risk**: Partial implementation breaks the core product promise
3. **Low isolation**: Unlike a new synth preset, effects change how ALL audio sounds
4. **Scope creep potential**: "Just add reverb" becomes per-track sends, effect presets, automation...

When the core product is stable and all other features are complete, effects can be implemented properly with full state integration.

### The Requirements for Proper Effects Implementation

When we're ready to add effects correctly, we need:

```typescript
// 1. Session State (worker/types.ts)
interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
  reverbMix: number;  // 0 = off, 1-100 = wet amount
  delayMix: number;   // 0 = off, 1-100 = wet amount
}

// 2. WebSocket Messages (worker/types.ts)
| { type: 'set_reverb_mix'; mix: number }
| { type: 'set_delay_mix'; mix: number }
| { type: 'reverb_mix_changed'; mix: number; playerId: string }
| { type: 'delay_mix_changed'; mix: number; playerId: string }

// 3. Server Validation (worker/validation.ts)
export const MIN_REVERB_MIX = 0;
export const MAX_REVERB_MIX = 100;

// 4. UI Controls (Transport.tsx)
// Two sliders matching the BPM/Swing pattern
```

### Key Lessons

1. **API surface should not exceed UI surface** — Don't ship capabilities users can't access
2. **Defer high-integration features** — Effects touch too many systems for early implementation
3. **Document the requirements** — When we defer, capture what "done" looks like

### Files Changed (Rollback)

- `src/audio/effects.ts` — Deleted (reverb/delay implementation)
- `src/audio/engine.ts` — Reverted signal chain, removed effects API
- `scripts/create-demo-sessions.ts` — Deleted
- `specs/MUSICAL-FOUNDATIONS-SUMMARY.md` — Updated to reflect actual delivery

---

## Lesson: Historical Layering Creates Hidden Duplication

**Date:** 2024-12 (Phase 21A Cleanup)

### The Problem

Code review revealed that 6 instruments existed in TWO separate systems:

| Name | System 1: Synthesized Samples | System 2: Synth Presets |
|------|------------------------------|------------------------|
| Bass | `bass` in SAMPLE_CATEGORIES | `synth:bass` in SYNTH_PRESETS |
| Sub Bass | `subbass` in SAMPLE_CATEGORIES | `synth:sub` in SYNTH_PRESETS |
| Lead | `lead` in SAMPLE_CATEGORIES | `synth:lead` in SYNTH_PRESETS |
| Pluck | `pluck` in SAMPLE_CATEGORIES | `synth:pluck` in SYNTH_PRESETS |
| Chord | `chord` in SAMPLE_CATEGORIES | (similar to `synth:stab`) |
| Pad | `pad` in SAMPLE_CATEGORIES | `synth:pad` in SYNTH_PRESETS |

### How This Happened: Historical Layering

**Phase 1-2 (Original Implementation):**
- Created "synthesized samples" — one-shot AudioBuffers generated at startup
- These were the only melodic sounds available
- `samples.ts` contained 16 sounds including bass, lead, pluck, chord, pad

**Phase 4+ (Synth Engine Added):**
- Added real-time synthesis with oscillators, filters, envelopes
- Created `SYNTH_PRESETS` with the same conceptual names: bass, lead, pad, pluck
- Used `synth:` prefix to differentiate IDs
- **Did not remove the original samples**

**Result:**
- Two "Bass" sounds accessible from different UI categories
- Users confused about which to use
- 6 functions generating samples that were never used (dead code)
- Slower initialization (generating unused buffers)

### The Technical Difference

| Aspect | Synthesized Samples | Synth Presets |
|--------|---------------------|---------------|
| **Generation** | Pre-generated AudioBuffer at init | Real-time oscillators |
| **Pitch Control** | PlaybackRate only (sounds bad at extremes) | True pitch via frequency |
| **ADSR** | Fixed envelope baked into buffer | Full ADSR control |
| **Enhanced Features** | None | Osc2, filterEnv, LFO |
| **Memory** | ~1KB per sample (in RAM always) | On-demand (no persistent memory) |
| **Chromatic Grid** | Poor pitch quality | Designed for chromatic playback |

**Conclusion:** Synth presets are strictly superior for melodic sounds.

### Why Nobody Noticed

1. **Different UI sections:** Samples in "Bass" / "Samples" categories, presets in "Core" / "Keys" etc.
2. **Different ID formats:** `bass` vs `synth:bass` — no collision
3. **Both worked:** Users who picked either got a working sound
4. **No tests for uniqueness:** Tests checked that each system was internally consistent, not that they didn't overlap
5. **Incremental development:** Each phase built on previous without holistic review

### The Heuristic

**When adding a new system, audit what it replaces.**

Questions to ask:
1. Does the new system make an old system redundant?
2. Are there overlapping names or concepts?
3. Can users access the same functionality two different ways?
4. Is the old system still needed, or just legacy?

### Key Lessons

1. **Feature additions can create hidden duplication** — New systems may obsolete old ones without explicit removal
2. **UI structure can hide duplication** — Same concept in different categories goes unnoticed
3. **ID prefixes enable parallel systems** — `synth:bass` vs `bass` allowed both to coexist
4. **Periodic audits catch drift** — Code review specifically asking "why do we have both?" found this
5. **Strictly superior systems should replace** — When new > old in all dimensions, remove old

### Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Total samples generated | 16 | 10 | -37.5% init work |
| Sample generation functions | 14 | 8 | -6 functions |
| UI sample categories | 4 | 2 | Clearer UI |
| Lines of dead code | ~140 | 0 | Cleaner codebase |

---

## Lesson: Read the Spec Before Implementing

**Date:** 2024-12 (Phase 24: Publishing)

### The Bug

We implemented "Publish" to mutate the current session in-place, setting `immutable: true` and trapping the user on a read-only session.

The spec (SHARING-AND-PUBLISHING.md) clearly said to **create a new immutable copy** while the user **stays on their editable session**.

### What the Spec Said (lines 103-108)

```
1. User clicks [Publish]
2. POST /api/sessions/{id}/publish
3. Server creates new session with immutable: true  ← NEW session
4. Copy new URL to clipboard
5. User stays on current (editable) session         ← User stays
6. Toast: "Published! Link copied."
```

### What We Implemented

```
1. User clicks [Publish]
2. POST /api/sessions/{id}/publish
3. Server sets existing session.immutable = true    ← WRONG: mutates in place
4. Copy current URL to clipboard
5. User is now trapped on read-only session         ← WRONG: user can't edit
6. Toast: "Published! Link copied."
```

### Why We Missed It

**We didn't read the spec before implementing.**

The word "publish" is semantically ambiguous:
- We interpreted it as "make this public" (mutate in-place)
- The spec meant "create a published copy" (fork with immutable flag)

Line 54 of the spec explicitly says: *"You cannot convert an editable session to published. You can only create a published copy."*

We would have known this if we had read the spec first.

### Additional Bugs Found During Audit

Once we read the spec, we found more violations:

| Bug | Spec Reference | Status |
|-----|----------------|--------|
| Publish mutates in-place | Lines 103-108 | Fixed |
| Invite visible on published | Line 298 | Fixed |
| Session name editable on published | Implicit | Fixed |
| Lineage links are clickable | Lines 472-479 | Fixed |
| Click interception modal | Lines 451-465 | Not implemented |
| Educational prompt | Lines 443-449 | Not implemented |

### Key Lessons

1. **Natural language descriptions are ambiguous** — "Publish" could mean many things. The spec resolves ambiguity.

2. **Intuition is not specification** — Our mental model of "publish" differed from the spec. The spec wins.

3. **The spec is the source of truth** — Not the implementation, not the tests, not the conversation. The spec.

4. **Read proactively, not reactively** — We only consulted the spec during the audit, after implementation was "complete."

### Files Changed

- `src/worker/sessions.ts` — Rewrote `publishSession()` to create new session
- `src/worker/index.ts` — Changed response code to 201, added error handling
- `src/hooks/useSession.ts` — Removed `setIsPublished(true)` after publish
- `src/App.tsx` — Hide Invite on published, disable SessionName, text-only lineage

---

## Lesson: Test the Spec, Not Your Mental Model

**Date:** 2024-12 (Phase 24: Publishing)

### The Problem

Our unit tests passed. Every single one. And yet the implementation was fundamentally wrong.

**Why?** Because our tests verified that our implementation worked correctly, not that it matched the spec.

### Tests That Passed (But Shouldn't Have Existed)

```typescript
// These tests passed - and were WRONG
test('publishSession sets immutable to true', () => {
  const result = await publishSession(env, sessionId);
  expect(result.data.immutable).toBe(true);  // ✅ Passes
});

test('published session rejects mutations', () => {
  // ✅ Passes, but the whole premise is wrong
});
```

### Tests We Should Have Written (From the Spec)

```typescript
// Spec line 105: "Server creates new session"
test('publish creates NEW session, not mutating source', async () => {
  const sourceId = await createSession();
  const result = await publishSession(sourceId);

  expect(result.id).not.toBe(sourceId);  // NEW ID
});

// Spec line 107: "User stays on current (editable) session"
test('source session remains editable after publish', async () => {
  const sourceId = await createSession();
  await publishSession(sourceId);

  const source = await getSession(sourceId);
  expect(source.immutable).toBe(false);  // Still editable
});

// Spec lines 584-601: API contract
test('publish returns 201 with new session ID and remixedFrom', async () => {
  const response = await POST(`/api/sessions/${sourceId}/publish`);

  expect(response.status).toBe(201);  // Created, not 200
  expect(response.body.id).not.toBe(sourceId);  // New ID
  expect(response.body.remixedFrom).toBe(sourceId);  // Points back
});
```

### The Pattern

| Approach | What It Tests | Catches Spec Violations? |
|----------|---------------|--------------------------|
| Implementation-driven tests | "Does my code work?" | No |
| Spec-driven tests | "Does behavior match spec?" | Yes |

### How to Derive Tests from Spec

1. **Find action verbs:** "creates", "stays", "copies", "navigates"
2. **Turn each into an assertion:** "creates new session" → `expect(result.id).not.toBe(sourceId)`
3. **Reference spec line numbers:** `// Spec line 105`
4. **Write the test BEFORE implementation**

### Key Lessons

1. **100% test coverage doesn't mean correctness** — You can test the wrong behavior with 100% coverage

2. **Tests should reference the spec** — `// Spec line 105: Server creates new session`

3. **Write spec tests before implementation** — This forces you to read the spec first

4. **Acceptance tests ≠ Unit tests** — Unit tests verify implementation; acceptance tests verify spec conformance

### Recommended Test Structure

```
tests/
├── unit/           # Implementation tests (mocked dependencies)
│   └── sessions.test.ts
└── acceptance/     # Spec conformance tests (derived from spec)
    └── SHARING-AND-PUBLISHING.spec.ts   # Named after spec file
```

---

# Process

---

## Process: Spec-First Development Checklist

Based on the Phase 24 experience, use this checklist for any feature with a spec.

### Pre-Implementation

- [ ] **Read the entire spec section** — Not just the parts you think are relevant
- [ ] **Identify all action verbs** — "creates", "copies", "navigates", "stays"
- [ ] **List ambiguous terms** — "Publish", "Share", "Save" can mean different things
- [ ] **Find spec clarifications** — The spec likely resolves the ambiguity
- [ ] **Create acceptance test skeleton** — One test per spec behavior
- [ ] **Review with stakeholder** — "Is this what the spec means?"

### Implementation

- [ ] **Keep spec open while coding** — Reference it for each decision
- [ ] **Comment spec line numbers** — `// Spec line 105: creates new session`
- [ ] **Check each UI state** — What buttons are visible? What's disabled?
- [ ] **Verify error states** — Spec often defines error responses

### Post-Implementation

- [ ] **Run acceptance tests** — All spec behaviors verified?
- [ ] **Manual UAT checklist** — Walk through spec scenarios by hand
- [ ] **Audit for undocumented behavior** — Did you add anything not in spec?

### UAT Checklist Template

For each feature, create a checklist from the spec:

```markdown
## Publish Feature UAT Checklist

From SHARING-AND-PUBLISHING.md:

### Publish Flow (lines 98-115)
- [ ] Clicking Publish calls POST /api/sessions/{id}/publish
- [ ] Response contains new session ID (different from source)
- [ ] Response contains URL to new session
- [ ] Clipboard contains URL to published session (not current)
- [ ] User remains on original session URL
- [ ] Original session is still editable
- [ ] Toast says "Published! Link copied."

### Published Session UI (lines 277-309)
- [ ] "📢 Published" badge is visible
- [ ] No Publish button shown
- [ ] No Invite button shown
- [ ] Remix is primary action
- [ ] Educational prompt is visible
- [ ] Grid cells don't respond to clicks
- [ ] "not-allowed" cursor on hover
```

---

## Process: Spec-Test Alignment Audit

**Date:** 2024-12 (Phase 21.5 Stabilization)

### The Incident

During a codebase audit, integration tests for the Publish feature failed. The response was to "fix" the implementation to match the tests. This was wrong — the **tests** were incorrect, and the implementation was right.

**Timeline:**
1. Phase 21: Publish feature implemented correctly (creates new immutable session)
2. Tests written encoding wrong behavior (same session becomes immutable)
3. Tests presumably never run, or passed due to different test setup
4. Phase 21.5: Rate limiter added, integration tests run
5. Tests fail on publish behavior
6. Implementation "fixed" to match tests ← **THE MISTAKE**
7. User catches error: "Make sure we didn't break publish"
8. Root cause identified: tests were wrong, not implementation

### Why This Happened

#### 1. Tests Treated as Source of Truth

When tests fail, the instinct is:
```
Test = Specification
Implementation ≠ Test
Therefore: Fix Implementation
```

This is backwards. The correct hierarchy:
```
Specification Document > Implementation Comments > Tests
```

Tests are code. Code has bugs. Tests can encode the wrong behavior.

#### 2. The Audit Didn't Include Test Correctness

The codebase audit checked:
- ✅ Code quality (no `any` types, consistent logging)
- ✅ Potential bugs (missing await, race conditions)
- ✅ Security (XSS, input validation)
- ✅ Performance (memoization, memory leaks)
- ✅ Test coverage gaps

But **NOT**:
- ❌ Do tests correctly encode the intended behavior?
- ❌ Do test expectations align with specs?

This is a completely separate audit dimension.

#### 3. Implementation Comments Were Overwritten

The original code had explicit documentation:
```typescript
/**
 * Publishing creates a NEW permanent, frozen snapshot that cannot be edited.
 * The source session remains editable - user stays on their working copy.
 */
```

When tests contradicted this comment, the response was to **delete the comment and rewrite the function** rather than question the tests.

**Red flag:** Changing well-documented code to match tests should trigger extra scrutiny.

#### 4. No Three-Way Alignment Check

```
Spec (SHARING-AND-PUBLISHING.md)  →  Create NEW session  ✓
Implementation (sessions.ts)       →  Create NEW session  ✓
Tests (live-session.test.ts)       →  Modify SAME session ✗
```

Two out of three agreed. The odd one out was **the tests**. This pattern should have been recognized.

#### 5. "Fix Mode" vs "Investigate Mode"

When tests failed, the response was immediate "fix mode":
- See failure → Find discrepancy → Change code → Tests pass → Done

The correct response is "investigate mode":
- See failure → Check spec → Check implementation → Check tests → Determine which is wrong → Fix the right thing

---

### The Spec-Test Alignment Audit Framework

Add this as a mandatory step in any codebase audit:

#### Phase 1: Inventory

For each feature with a spec document:

| Feature | Spec File | Test File(s) | Implementation File(s) |
|---------|-----------|--------------|------------------------|
| Publish | SHARING-AND-PUBLISHING.md | live-session.test.ts | sessions.ts, index.ts |
| Session lifecycle | SESSION-LIFECYCLE.md | session.test.ts | session.ts, useSession.ts |
| ... | ... | ... | ... |

#### Phase 2: Extract Key Behaviors from Spec

For each feature, extract the **action verbs** and **expected outcomes**:

```markdown
## Publish Feature (from spec lines 103-108)

| # | Action | Expected Outcome |
|---|--------|------------------|
| 1 | User clicks Publish | POST request sent |
| 2 | Server handles request | NEW session created |
| 3 | Response returned | Contains NEW session ID |
| 4 | User's URL | Unchanged (stays on editable) |
| 5 | Source session | Remains editable (immutable: false) |
| 6 | Published session | Is immutable (immutable: true) |
```

#### Phase 3: Extract Test Expectations

For each key behavior, find the corresponding test assertions:

```markdown
## Publish Tests (from live-session.test.ts)

| Spec Behavior | Test Assertion | Line | Aligned? |
|---------------|----------------|------|----------|
| NEW session created | `expect(data.id).toBe(sourceId)` | 633 | ❌ NO |
| Response has new ID | `expect(data.id).toBe(sourceId)` | 633 | ❌ NO |
| Source stays editable | (no test) | - | ⚠️ MISSING |
| Published is immutable | `expect(session.immutable).toBe(true)` | 640 | ✓ |
```

#### Phase 4: Flag Misalignments

Create a misalignment report:

```markdown
## Spec-Test Misalignment Report

### CRITICAL: Publish creates wrong session type

**Spec says (line 105):** "Server creates new session"
**Test expects (line 633):** Same session ID returned
**Implementation does:** Creates new session (correct)

**Verdict:** TEST IS WRONG, not implementation

### WARNING: Missing test for source editability

**Spec says (line 107):** "User stays on current (editable) session"
**Test coverage:** None
**Risk:** Regression could go undetected

**Recommendation:** Add test asserting source.immutable === false after publish
```

#### Phase 5: Resolve

For each misalignment:

| Resolution | When to Use |
|------------|-------------|
| Fix the test | Test encodes wrong behavior |
| Fix the implementation | Implementation doesn't match spec |
| Update the spec | Spec is outdated, implementation is intentionally different |
| Ask stakeholder | Ambiguous which is correct |

---

### Checklist for Test Failure Response

When tests fail on "completed" features, follow this checklist BEFORE changing code:

#### Investigation Phase
- [ ] **Read the spec section** for this feature
- [ ] **Read implementation comments** — do they describe expected behavior?
- [ ] **Read test assertions** — what exactly do they expect?
- [ ] **Three-way comparison:**
  - What does the spec say?
  - What does the implementation do?
  - What do tests expect?
- [ ] **Identify the odd one out** — which disagrees with the other two?

#### Decision Phase
- [ ] **If tests are wrong:** Fix tests, document why
- [ ] **If implementation is wrong:** Fix implementation, update comments
- [ ] **If spec is outdated:** Update spec, confirm with stakeholder
- [ ] **If unclear:** Ask before changing anything

#### Red Flags (Pause and Verify)
- [ ] About to delete/change implementation comments
- [ ] About to change behavior that implementation comments describe
- [ ] Tests and implementation comments directly contradict
- [ ] Changing "working" code to match failing tests
- [ ] No spec reference for the test assertions

---

### Template: Spec-Test Alignment Audit Section

Add this to CODEBASE-AUDIT documents:

```markdown
## Spec-Test Alignment Audit

### Methodology
For each feature with a specification document:
1. Extract key behaviors from spec
2. Find corresponding test assertions
3. Flag misalignments
4. Determine which is correct (spec, implementation, or test)

### Features Audited

#### Feature: [Name]
- Spec: [filename.md, lines X-Y]
- Tests: [test-file.ts, lines X-Y]
- Implementation: [file.ts, lines X-Y]

| Spec Behavior | Test Assertion | Aligned? |
|---------------|----------------|----------|
| ... | ... | ✓/❌/⚠️ |

**Misalignments Found:** [count]
**Resolution:** [Fixed tests / Fixed implementation / Updated spec / N/A]

### Summary

| Feature | Behaviors | Tests | Aligned | Misaligned | Missing |
|---------|-----------|-------|---------|------------|---------|
| Publish | 6 | 4 | 2 | 2 | 2 |
| ... | ... | ... | ... | ... | ... |

### Action Items
1. [ ] Fix test X in file Y (encodes wrong behavior)
2. [ ] Add test for behavior Z (missing coverage)
3. [ ] Update spec section W (outdated)
```

---

### Key Lessons

1. **Tests can be wrong** — Don't blindly trust test expectations. Verify against specs.

2. **Implementation comments are documentation** — Detailed comment blocks explaining behavior should be respected. If tests contradict them, question the tests first.

3. **Three-way alignment is mandatory** — Spec, implementation, and tests must all agree. When they don't, find the odd one out.

4. **"Investigate mode" before "fix mode"** — When tests fail on completed features, investigate which is wrong before changing anything.

5. **Add spec-test alignment to audits** — Test coverage audits check IF tests exist. Spec-test alignment audits check if tests encode CORRECT behavior.

6. **Red flag: changing code to match tests** — Especially when implementation has descriptive comments. This should trigger a spec check.

---

### Files Changed (This Incident)

- `src/worker/sessions.ts` — Incorrectly changed, then reverted
- `src/worker/index.ts` — Incorrectly changed, then reverted
- `test/integration/live-session.test.ts` — Fixed to match spec (correct behavior)
- `docs/lessons-learned.md` — Added this section

---

# Future Work

---

## Future: Publish Provenance (Forward References)

**Status:** Captured for future implementation (Session Provenance phase)

### The Problem

When a user publishes their session:
1. A new immutable session is created
2. The published session has `remixedFrom: sourceId` pointing BACK to the source
3. But the source session has **no reference to its published children**

This means:
- User publishes v1, v2, v3 of their work
- They have no way to find those published versions later
- They must manually save/remember each published URL
- There's no "version history" or "my published sessions" view

### The Data Model Gap

```typescript
// Current: One-way reference (child → parent)
interface Session {
  remixedFrom: string | null;  // Published session points to source
  // ... no reference the other direction
}

// What we need: Bidirectional (or queryable)
// Option A: Store on source
interface Session {
  remixedFrom: string | null;
  publishedVersions?: string[];  // Source knows its published children
}

// Option B: Query-time resolution
// GET /api/sessions/{id}/published-versions
// Returns all sessions where remixedFrom === id && immutable === true
```

### User Scenarios Affected

| Scenario | Current State | Desired State |
|----------|---------------|---------------|
| "Where's my published v1?" | User must remember URL | List of published versions on source session |
| "Show me all my published work" | Impossible | Profile page with published sessions |
| "Link to specific version" | Possible if URL saved | Browse versions, pick one |
| "Unpublish v2" | Find URL, delete manually | Delete from version list |

### Implementation Considerations

1. **Option A: Store `publishedVersions[]` on source**
   - Pro: Fast lookup, no query needed
   - Con: Array grows unbounded, eventual consistency issues

2. **Option B: Query at read time**
   - Pro: No denormalization, always consistent
   - Con: Requires KV list operation or secondary index

3. **Option C: Separate provenance index**
   - Pro: Clean separation, supports complex queries
   - Con: Another data store to maintain

### Tie-in with Authentication

This feature naturally pairs with authentication (Phase 22+):
- "My published sessions" requires knowing who "I" am
- Version management requires ownership verification
- Profile pages need session ownership

### Recommended Approach

Defer to Session Provenance phase and implement with authentication:

```typescript
// When auth exists:
interface Session {
  ownerId: string;           // Who created this
  remixedFrom: string | null;
  // No publishedVersions - query instead
}

// API endpoint
GET /api/users/{userId}/sessions?immutable=true
// Returns all published sessions by this user

// Or from a source session
GET /api/sessions/{sessionId}/versions
// Returns all sessions where remixedFrom === sessionId
```

### Key Insight

The current one-way `remixedFrom` reference is sufficient for the published session to show its lineage. But for the **publisher** to manage their published work, we need either:
- Bidirectional references (denormalized)
- Query capability (secondary index)
- Both (denormalized with query as source of truth)

### Files to Change (Future)

- `src/worker/types.ts` — Add `ownerId` when auth lands
- `src/worker/index.ts` — Add `/versions` endpoint
- `src/App.tsx` — Add "Published Versions" UI
- `specs/SESSION-LIFECYCLE.md` — Document provenance model

---

# Audio Engineering Lessons

These lessons address foundational audio engineering concepts that, when missing, cause quality issues that won't be caught by normal feature development.

---

## Gain Staging: The Tinny Sound Problem

**Date:** 2024-12 (Audio Quality Audit)

### The Bug
Users reported that all default instruments sounded "crappy" or "tinny" - lacking fullness, punch, and presence.

### Root Cause: Compounding Conservatism

The codebase had gain reduction at three independent stages:

```
Signal Flow (BEFORE):
Sample (0.25-0.5) → Synth Envelope (0.5) → Track (1.0) → Master (0.8)

Worst case: 0.25 × 0.5 × 1.0 × 0.8 = 0.10 (10% of available headroom!)
```

Each component author independently chose "safe" conservative values. Multiplied together, they wasted 90% of dynamic range.

### The Fix

| Stage | Before | After | Rationale |
|-------|--------|-------|-----------|
| Sample amplitudes | 0.25-0.5 | 0.65-0.95 | Use available headroom |
| Synth envelope peak | 0.5 | 0.85 | Near-full amplitude |
| Master gain | 0.8 | 1.0 | Let compressor handle peaks |

Also added `DynamicsCompressorNode` on master bus to handle clipping when multiple sources play.

### Key Lessons

1. **Gain staging must be explicit** - Document target levels at each stage
2. **"Headroom" at every stage = no headroom** - Reserve it at ONE place (master compressor)
3. **This wouldn't surface in tests** - Audio quality issues need dedicated audits

### Files Changed
- `src/audio/engine.ts` - Master gain, compressor
- `src/audio/synth.ts` - Envelope peak, preset sustain values
- `src/audio/samples.ts` - Sample amplitude multipliers

---

## Memory Leaks in Web Audio

**Date:** 2024-12 (Audio Quality Audit)

### The Bug
After extended sessions, audio would glitch and performance would degrade.

### Root Cause: Orphaned AudioNodes

Every `playSample()` call created a `BufferSourceNode` that was never disconnected:

```typescript
// BEFORE - Memory leak
const source = audioContext.createBufferSource();
source.connect(trackGain);
source.start(time);
// Source stays connected forever after playback ends!
```

At 120 BPM with 4 active tracks: ~32 nodes/second × 600 seconds = ~19,200 orphaned nodes.

### The Fix

```typescript
// AFTER - Proper cleanup
source.onended = () => {
  source.disconnect();
  envGain.disconnect();
};
```

Same pattern for `SynthVoice`:

```typescript
private cleanup(): void {
  this.oscillator.disconnect();
  this.filter.disconnect();
  this.gainNode.disconnect();
}
```

### Key Lessons

1. **AudioNodes must be disconnected** - Unlike DOM elements, they don't auto-cleanup
2. **Use `onended` callback** - Fires when BufferSourceNode finishes
3. **Track cleanup state** - Prevent double-disconnect errors

---

## Voice Limiting and Polyphony

**Date:** 2024-12 (Audio Quality Audit)

### The Bug
On mobile devices, CPU could spike when many synth notes played simultaneously.

### Root Cause: Unlimited Voices

Each synth note creates: oscillator + filter + gain node. Without limits:
- 64 simultaneous notes = 192 active audio nodes
- Can overwhelm mobile CPUs
- Causes glitching and dropped frames

### The Fix

Voice stealing with oldest-voice priority:

```typescript
private readonly MAX_VOICES = 16;

playNote(...): void {
  if (this.activeVoices.size >= MAX_VOICES) {
    const oldestNoteId = this.voiceOrder.shift();
    if (oldestNoteId) this.stopNote(oldestNoteId);
  }
  // ... create new voice
}
```

### Key Lessons

1. **Professional synths limit voices** - 8-32 is typical
2. **Oldest-first stealing** - Least disruptive to current sound
3. **Track voice order** - Array maintains creation sequence

---

## Click Prevention with Micro-Fades

**Date:** 2024-12 (Audio Quality Audit)

### The Bug
Audible clicks/pops when samples started or stopped, especially in "gate" mode.

### Root Cause: Abrupt Signal Changes

Starting or stopping audio at non-zero amplitude creates a discontinuity that speakers reproduce as a click:

```
Waveform without fade:     Waveform with fade:
   ___/\___                    ╱\___
  |        |                  /     \
  |________|                 /       \_____
  ^click!   ^click!
```

### The Fix

3ms micro-fades on start and stop:

```typescript
const FADE_TIME = 0.003; // 3ms

// Fade in
envGain.gain.setValueAtTime(0, time);
envGain.gain.linearRampToValueAtTime(1, time + FADE_TIME);

// Fade out (for gate mode)
envGain.gain.setValueAtTime(1, stopTime - FADE_TIME);
envGain.gain.linearRampToValueAtTime(0, stopTime);
```

### Key Lessons

1. **3ms is imperceptible** - Fast enough to not affect transients
2. **Always fade in/out** - Even for drum samples
3. **Gate mode especially needs fades** - Cuts mid-waveform

---

## Exponential vs Linear Envelopes

**Date:** 2024-12 (Audio Quality Audit)

### The Bug
Synth sounds felt "artificial" or "unnatural" compared to hardware synths.

### Root Cause: Linear Volume Changes

Human hearing is logarithmic. Linear amplitude changes sound unnatural:

```
Linear:      |‾‾‾‾‾‾‾\______     (sounds like "slow start, sudden drop")
Exponential: |‾‾‾‾\_________     (sounds natural)
```

### The Fix

Use exponential ramps for attack/decay, `setTargetAtTime` for release:

```typescript
// Attack (exponential for punch)
gainNode.gain.setValueAtTime(0.0001, time);  // Can't start at 0
gainNode.gain.exponentialRampToValueAtTime(0.85, time + attack);

// Release (smooth decay)
gainNode.gain.setTargetAtTime(0.0001, time, release / 4);
```

### Key Lessons

1. **exponentialRamp can't target 0** - Use small value like 0.0001
2. **setTargetAtTime for release** - Avoids discontinuities at small values
3. **Time constant = release/4** - Gives ~98% decay after release time

---

## Duplicate Bug = Missing Abstraction: Tone.js Time Conversion

**Date:** 2024-12 (Phase 21A / Phase 25)

### The Bug

```
Uncaught Error: Start time must be strictly greater than previous start time
    at ToneSynthManager.playNote (toneSynths.ts:368)
```

Tone.js synths were failing when multiple notes were scheduled at the same step, or when the scheduler's timing calculation resulted in a zero or negative offset.

### The First Fix (Wrong Approach)

We found the bug in `toneSynths.ts` and fixed it:

```typescript
// toneSynths.ts - Fixed
const safeTime = Math.max(0.001, time);
const startTime = Tone.now() + safeTime;
```

Then we found **the exact same bug** in `advancedSynth.ts`:

```typescript
// advancedSynth.ts - Also needed fixing
const safeTime = Math.max(0.001, time ?? 0);
const startTime = Tone.now() + safeTime;
```

Then we found a **third instance** in `toneSampler.ts` (not yet integrated, but waiting to break).

### The Code Smell

**Finding the same bug in multiple places is evidence of:**
1. **Duplicated logic** that should be centralized
2. **Missing abstraction** at an architectural boundary
3. **Inconsistent interfaces** that force each consumer to handle the same problem

### Root Cause Analysis

The scheduler was handling different audio backends inconsistently:

| Method | What Scheduler Passed | Problem |
|--------|----------------------|---------|
| `playSample()` | Absolute Web Audio time | ✓ Consistent |
| `playSynthNote()` | Absolute Web Audio time | ✓ Consistent |
| `playToneSynth()` | Relative offset (scheduler did conversion) | ✗ Inconsistent |
| `playAdvancedSynth()` | Relative offset (scheduler did conversion) | ✗ Inconsistent |

The time conversion was **split between two components:**
1. Scheduler: `time - audioEngine.getCurrentTime()` (convert to relative)
2. Each Tone.js consumer: `time + Tone.now()` (convert back to absolute)

This meant:
- Each Tone.js consumer had to know about time conversion
- Each could (and did) have the same bug
- Adding a new Tone.js consumer would require remembering this pattern

### The Architectural Fix

**Centralize the conversion at the boundary** — the `audioEngine` is the natural place because it's where Web Audio meets Tone.js.

#### 1. Add helper method in audioEngine

```typescript
// engine.ts
private toToneRelativeTime(webAudioTime: number): number {
  const relativeTime = webAudioTime - this.getCurrentTime();
  // Safety guard in ONE place
  return Math.max(0.001, relativeTime);
}
```

#### 2. Update Tone.js methods to convert internally

```typescript
// engine.ts
playToneSynth(presetName, semitone, time, duration): void {
  // Accept absolute Web Audio time (consistent with other methods)
  const toneTime = this.toToneRelativeTime(time);
  this.toneSynths.playNote(presetName, noteName, duration, toneTime);
}
```

#### 3. Update scheduler to pass consistent time format

```typescript
// scheduler.ts - BEFORE (inconsistent)
audioEngine.playToneSynth(preset, pitch, time - audioEngine.getCurrentTime(), duration);
audioEngine.playSample(sampleId, trackId, time, duration); // Different!

// scheduler.ts - AFTER (consistent)
audioEngine.playToneSynth(preset, pitch, time, duration);
audioEngine.playSample(sampleId, trackId, time, duration); // Same format
```

### The Heuristic

**When you find the same bug in 2+ places, STOP and ask:**

1. **Why does this code exist in multiple places?**
   - Is there duplicated logic?
   - Is there a missing abstraction?

2. **Where should this logic live?**
   - At the boundary between systems (here: audioEngine)
   - In a shared utility
   - In a base class/interface

3. **How can we prevent this class of bug?**
   - Centralize the logic
   - Make the interface consistent
   - Add tests that would catch variations

### Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| Time conversion | Split between scheduler + each consumer | Centralized in audioEngine |
| Safety guard | In each consumer (duplicated) | In toToneRelativeTime() (once) |
| Interface | Inconsistent (some absolute, some relative) | Consistent (always absolute) |
| Adding new Tone.js feature | Must remember time conversion | Just use audioEngine API |

### Key Lessons

1. **Duplicate bug = missing abstraction** — Don't just fix both places; ask why the duplication exists

2. **Centralize at boundaries** — Time conversion belongs where Web Audio meets Tone.js, not scattered in consumers

3. **Consistent interfaces prevent bugs** — If all methods accept the same time format, there's no confusion

4. **The second bug is a gift** — It reveals an architectural issue you might have missed

5. **Fix the architecture, not just the symptom** — Patching each file leaves the next one vulnerable

### Code Review Red Flags

```typescript
// RED FLAG: Same pattern in multiple files
// File A:
const startTime = time + Tone.now();

// File B:
const startTime = time + Tone.now();

// File C:
const startTime = time + Tone.now();
// → This is a missing abstraction

// GREEN FLAG: Centralized helper
// audioEngine.ts:
private toToneRelativeTime(time: number): number {
  return Math.max(0.001, time - this.getCurrentTime());
}

// All consumers just call the helper
```

### Files Changed

- `src/audio/engine.ts` — Added `toToneRelativeTime()`, updated `playToneSynth()` and `playAdvancedSynth()`
- `src/audio/scheduler.ts` — Removed manual time conversion, passes absolute time consistently
- `src/audio/toneSynths.ts` — Simplified (still has safety guard as defense-in-depth)
- `src/audio/advancedSynth.ts` — Simplified (still has safety guard as defense-in-depth)
- `src/audio/toneSampler.ts` — Fixed for when it gets integrated

---

## Sampled Instrument Race Condition: Preload at Init

**Date:** 2024-12 (Phase 21A: Piano Integration)

### The Bug

User adds a piano track while the sequencer is already playing. The piano never makes sound:

```
[Audio] Preloaded sampled instruments:         // ← EMPTY! Nothing loaded
[Audio] Scheduler starting with tracks: []    // ← Started with no tracks
[Audio] [AudioTrigger] Music intent: add_track
[Audio] Sampled instrument piano not ready, skipping at step 0
[Audio] Sampled instrument piano not ready, skipping at step 1
[Audio] Sampled instrument piano not ready, skipping at step 2
... (forever)
```

### The Race Condition

```
Timeline:
1. User clicks Play (empty grid)
2. preloadInstrumentsForTracks([]) runs → nothing to preload
3. Scheduler starts with empty tracks
4. User adds piano track
5. Scheduler tries to play piano
6. Piano not loaded! (preload already ran)
7. "piano not ready, skipping" forever
```

The key insight: **preload happened before the track existed**, and nothing ever triggered loading after the track was added.

### The Fix

Two options:

**Option A: Eager preload at init (chosen)**
```typescript
// engine.ts - During AudioEngine.initialize()
this.preloadAllSampledInstruments(); // Fire-and-forget background load
```

**Option B: Load on track add**
```typescript
// When handleAddTrack is called with 'synth:piano'
if (isSampledInstrument(preset)) {
  await audioEngine.loadSampledInstrument(preset);
}
```

We chose Option A because:
- Piano is small (~200KB total for 4 octave samples)
- It's the only sampled instrument currently
- Eliminates the race entirely—piano is always ready
- Simpler to implement and reason about

### The Pattern

**Lazy loading requires careful coordination with dynamic additions.**

If resources can be added while the system is running, you must either:
1. **Eager load** everything at init (simple, predictable)
2. **Load on add** with proper waiting (more complex)
3. **Load on first use** with graceful degradation (skips notes, bad UX)

The documentation in `sampled-instrument.ts` said:
```
* - Piano preloads during AudioEngine.initialize() to be ready before first note
```

But the implementation didn't match the design! The lesson: **verify your implementation matches your documented design**.

### Files Changed

- `src/audio/engine.ts` — Added `preloadAllSampledInstruments()`, called during `initialize()`

---

## Concurrent Initialization Guards

**Date:** 2024-12 (Phase 21A: Piano Integration)

### The Problem

Multiple callers (Play button, preload requests, sample preview) can call `audioEngine.initialize()` simultaneously:

```typescript
// BUGGY CODE
async initialize(): Promise<void> {
  if (this.initialized) return;  // Check before async work

  this.audioContext = new AudioContext();
  // ... 50 lines of async operations ...
  this.initialized = true;  // Set flag at end
}
```

**Race Condition:**
```
Call A: Check initialized (false) ✓
Call B: Check initialized (false) ✓  // A hasn't set flag yet!
Call A: Start creating AudioContext
Call B: Start creating AudioContext  // Duplicate!
Call A: Load piano samples
Call B: Load piano samples           // Duplicate!
```

Result: Multiple AudioContexts, wasted memory, potential resource leaks.

### The Fix

Use a promise-based guard that returns the existing promise if initialization is in progress:

```typescript
private _initializePromise: Promise<void> | null = null;

async initialize(): Promise<void> {
  if (this.initialized) return;
  if (this._initializePromise) {
    return this._initializePromise;  // Wait for in-progress init
  }

  this._initializePromise = this._doInitialize();
  await this._initializePromise;
  this._initializePromise = null;
}
```

### The Pattern

**Any async initialization that can be called from multiple places needs a promise guard.**

This applies to:
- Audio engine initialization
- WebSocket connection setup
- Database connection pools
- Service workers
- Any singleton with async setup

---

## Never Silently Substitute Sounds

**Date:** 2024-12 (Phase 21A: Piano Integration)

### The Temptation

When piano samples fail to load (network error, slow connection), it's tempting to fall back to a synth sound:

```typescript
// WRONG - tempting but harmful
if (pianoInstrument.isReady()) {
  pianoInstrument.playNote(...);
} else {
  synthEngine.playNote('piano', ...);  // Synth fallback
}
```

### Why It's Wrong

1. **User selected "piano"** — they expect piano sound, not sine waves
2. **Breaks expectations** — experienced users notice the wrong timbre immediately
3. **Hides the bug** — you don't know piano failed, just sounds "wrong"
4. **Multiplayer divergence** — Player A hears piano, Player B hears synth (if one has cached samples)

### The Correct Approach

**Silence is better than the wrong sound.**

```typescript
// CORRECT - fail visibly
if (pianoInstrument.isReady()) {
  pianoInstrument.playNote(...);
} else {
  // Log error, skip note - user hears silence
  logger.audio.warn(`Piano not ready, skipping note at step ${step}`);
  // Optionally: show UI indicator that piano is still loading
}
return; // NEVER fall back to synth for sampled instruments
```

### The Rule

**For audio substitution:**
- Wrong sound = always bad (confuses users)
- Silence = sometimes acceptable (debugging clue)
- Error message = best (tells user what's wrong)

---

## Dependency Injection for Audio Testing

**Date:** 2024-12 (Phase 21A: Piano Integration)

### The Problem

Audio code often uses singletons, making it hard to test:

```typescript
// Hard to test - uses global singleton
class AudioEngine {
  playNote() {
    sampledInstrumentRegistry.get('piano').playNote(...);
    // How do you mock sampledInstrumentRegistry?
  }
}
```

### The Solution

Constructor injection with defaults:

```typescript
interface AudioEngineDependencies {
  sampledInstrumentRegistry?: SampledInstrumentRegistry;
  synthEngine?: SynthEngine;
}

class AudioEngine {
  private _sampledInstrumentRegistry: SampledInstrumentRegistry;
  private _synthEngine: SynthEngine;

  constructor(deps?: AudioEngineDependencies) {
    // Use provided dependencies or default to real singletons
    this._sampledInstrumentRegistry = deps?.sampledInstrumentRegistry ?? sampledInstrumentRegistry;
    this._synthEngine = deps?.synthEngine ?? synthEngine;
  }
}
```

### Usage in Tests

```typescript
describe('AudioEngine', () => {
  it('should skip notes when piano not ready', () => {
    const mockRegistry = {
      get: vi.fn().mockReturnValue({
        isReady: () => false,
        playNote: vi.fn(),
      }),
    };

    const engine = new AudioEngine({
      sampledInstrumentRegistry: mockRegistry as any,
    });

    engine.playSynthNote('piano', 60, 0, 1);

    // Verify piano.playNote was NOT called (because not ready)
    expect(mockRegistry.get('piano').playNote).not.toHaveBeenCalled();
  });
});
```

### The Pattern

**Default to production, accept test doubles:**

```typescript
constructor(deps?: Dependencies) {
  this.dep = deps?.dependency ?? realSingleton;
}
```

Benefits:
- Production code unchanged (uses defaults)
- Tests can inject mocks
- No global state manipulation in tests
- Clear dependency graph

---

## Audio Engineering Checklist

### Pre-Implementation
- [ ] **Define gain staging targets** - Document expected levels at each stage
- [ ] **Plan voice management** - How many simultaneous voices?
- [ ] **Consider memory cleanup** - How will nodes be disconnected?

### Implementation
- [ ] **Add compressor to master** - Prevents clipping with multiple sources
- [ ] **Use onended for cleanup** - BufferSourceNodes and synth voices
- [ ] **Add micro-fades** - 3ms prevents clicks
- [ ] **Use exponential envelopes** - Sounds more natural
- [ ] **Clamp filter resonance** - Prevent self-oscillation (max Q ≈ 20)

### Testing
- [ ] **Extended session test** - 10+ minutes, check for memory growth
- [ ] **Polyphony stress test** - Many simultaneous voices
- [ ] **Mobile CPU test** - Check performance on low-power devices
- [ ] **A/B comparison** - Compare to reference sounds

### Code Review Flags
```typescript
// RED FLAG: No cleanup
source.start(time);
// Where's the disconnect?

// RED FLAG: Unlimited polyphony
this.activeVoices.set(noteId, voice);
// What if there are 100 voices?

// RED FLAG: Linear envelopes for all stages
gainNode.gain.linearRampToValueAtTime(0, time + release);
// Should be exponential

// GREEN FLAG: Proper cleanup
source.onended = () => source.disconnect();

// GREEN FLAG: Voice limiting
if (this.activeVoices.size >= MAX_VOICES) {
  this.stopNote(this.voiceOrder.shift());
}
```

---

# Frontend / Mobile Lessons

---

## 2024-12-11: The Ghost Click Bug (Mobile Toggle Revert)

### Symptom
On iOS Chrome, tapping a step to toggle it would briefly show the change, then immediately revert. The UI appeared to "flash" the toggled state before returning to the original.

### Initial Hypotheses (All Wrong)
1. WebSocket sync race condition
2. State hash mismatch triggering unwanted snapshots
3. Optimistic update being overwritten by server response
4. Stale closure in React state management

### How We Found the Real Cause
Added assertion logging (`[ASSERT]` tags) to both client and server to trace the exact sequence of events:

```typescript
// Server-side logging
console.log(`[ASSERT] toggle_step RECEIVED: track=${msg.trackId}, step=${msg.step}, time=${Date.now()}`);
console.log(`[ASSERT] toggle_step APPLIED: ${oldValue} -> ${newValue}`);
```

Running `wrangler tail` while testing on the real device revealed:
```
toggle_step RECEIVED: step=2, time=1765475417245
toggle_step APPLIED: step=2, false -> true
toggle_step RECEIVED: step=2, time=1765475417257  (12ms later!)
toggle_step APPLIED: step=2, true -> false
```

**Each tap was sending TWO toggle messages.**

### Root Cause: Ghost Clicks
Mobile browsers fire both touch AND mouse events for a single tap:
```
touchstart → touchend → onClick() #1
       ↓ (0-300ms later, synthesized)
mousedown → mouseup → onClick() #2
```

Our original `useLongPress` hook had handlers for both touch and mouse events, causing `onClick` to fire twice.

---

### Why We Didn't Know

**This is a well-documented, classic problem** - we just didn't look for it.

#### Resources We Should Have Read
| Resource | What It Covers |
|----------|----------------|
| [web.dev: Touch and Mouse](https://web.dev/mobile-touchandmouse/) | Google's canonical guide on handling both input types |
| [MDN: Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events) | Comprehensive reference with mouse event emulation notes |
| [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | The modern, unified solution |
| [Apple Safari Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) | Official iOS touch event documentation |
| [Chrome: 300ms Tap Delay](https://developer.chrome.com/blog/300ms-tap-delay-gone-away) | History and current state of mobile browser delays |

#### Why DevTools Emulation Didn't Show the Bug
Chrome DevTools mobile emulation:
- ✅ Fires touch events
- ❌ Does NOT fire synthesized mouse events after touch
- ❌ Does NOT simulate the ghost click sequence

**The bug is invisible in emulation. Real device testing is required.**

---

### The Fix: Pointer Events API

#### Before (Buggy): Dual Touch + Mouse Handlers
```typescript
// OLD - Vulnerable to ghost clicks
return {
  onMouseDown,
  onMouseUp: end,
  onTouchStart,
  onTouchEnd: end,  // Both call end() → onClick()
};
```

#### After (Fixed): Unified Pointer Events
```typescript
// NEW - Single event system, no ghost clicks possible
return {
  onPointerDown,
  onPointerUp,
  onPointerLeave: cancel,
  onPointerCancel: cancel,
};
```

The [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) unifies mouse, touch, and stylus into a single event stream. Browser support is 96%+.

#### Why Pointer Events Are Better
| Aspect | Touch + Mouse | Pointer Events |
|--------|---------------|----------------|
| Event streams | Two (touch, mouse) | One (pointer) |
| Ghost click risk | Yes, requires mitigation | No, impossible |
| Input type detection | Separate handlers | `e.pointerType` |
| Multi-touch handling | Complex | `e.pointerId` tracking |
| Code complexity | Higher | Lower |

---

### Key Takeaways

#### 1. Observability beats speculation
We spent time on wrong hypotheses. Adding targeted logging immediately revealed the real issue.

#### 2. Test on real devices
Chrome DevTools emulation doesn't replicate mobile browser quirks. The ghost click bug only appears on actual iOS/Android devices.

#### 3. Write failing tests first
Our new tests explicitly test the failure mode:
```typescript
it('uses single event system - no ghost click handling needed', () => {
  // Documents the architectural decision
});
```

#### 4. Use modern APIs
The Pointer Events API exists precisely to solve this problem. We reinvented a wheel that was already rolling.

#### 5. Read the docs first
The ghost click problem is extensively documented. A 10-minute read of MDN or web.dev would have prevented hours of debugging.

---

### Code Review Checklist for Touch/Mouse Event Code

#### Pre-Implementation
- [ ] **Why not use an existing library?** (React Aria, @use-gesture, etc.)
- [ ] **Have you read the [MDN Pointer Events guide](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)?**
- [ ] **Do you understand the touch → mouse event sequence on mobile?**

#### Implementation
- [ ] **Prefer Pointer Events** over separate touch/mouse handlers
- [ ] **If using both touch AND mouse**:
  - [ ] Implement ghost click prevention (timestamp guard or `preventDefault()`)
  - [ ] Document WHY both are needed
- [ ] **Touch targets are at least 44x44px** (WCAG accessibility)

#### Testing
- [ ] **Unit tests for each pointer type** (mouse, touch, pen)
- [ ] **Unit tests for pointer ID tracking** (multi-touch safety)
- [ ] **Real device testing** (or BrowserStack/Sauce Labs)
- [ ] **Test on both iOS Safari AND iOS Chrome** (different behaviors!)

#### Code Patterns to Flag in Review
```typescript
// RED FLAG: Dual handlers without deduplication
return {
  onMouseUp: handleEnd,
  onTouchEnd: handleEnd,  // Ghost click vulnerability!
};

// GREEN FLAG: Pointer events (single system)
return {
  onPointerUp: handleEnd,
};
```

#### Questions for PR Review
1. "How does this handle a tap on mobile Chrome/Safari?"
2. "What happens if both touch and mouse events fire?"
3. "Has this been tested on a real mobile device?"
4. "Why aren't we using Pointer Events or React Aria for this?"

---

### Files Changed
- `src/hooks/useLongPress.ts` - Migrated from touch+mouse to Pointer Events
- `test/unit/useLongPress.test.ts` - 13 tests covering all pointer scenarios
- `docs/lessons-learned.md` - This document

### Related Links
- [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN: Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events)
- [web.dev: Touch and Mouse](https://web.dev/mobile-touchandmouse/)
- [Can I Use: Pointer Events](https://caniuse.com/pointer) (96%+ support)
- [React Aria usePress](https://react-spectrum.adobe.com/blog/building-a-button-part-1.html)
- [@use-gesture/react](https://github.com/pmndrs/use-gesture)

---

## AudioContext and mouseenter: The Hidden User Gesture Trap

**Date:** 2024-12 (Phase 21A Piano Samples)

### Symptom
First page load shows "AudioContext was not allowed to start" warning in console, and piano samples don't play. Second page load works fine.

### Root Cause: mouseenter Is NOT a User Gesture

The `SamplePicker` component had preview-on-hover functionality:

```typescript
// BUGGY CODE
const handlePreview = useCallback(async (sampleId: string) => {
  if (!audioEngine.isInitialized()) {
    await audioEngine.initialize();  // ← BUG: Called from mouseenter!
  }
  audioEngine.playNow(sampleId);
}, []);

// In JSX:
<button onMouseEnter={() => handlePreview(sampleId)}>...</button>
```

The Web Audio API requires AudioContext to be created inside a **user gesture**. Valid gestures are:
- `click` ✓
- `touchstart` / `touchend` ✓
- `keydown` / `keyup` ✓
- `pointerup` ✓

**NOT valid** (despite feeling interactive):
- `mouseenter` ✗
- `mouseover` ✗
- `mousemove` ✗
- `focus` ✗
- `scroll` ✗

When user hovers over a sample button before clicking anything, `handlePreview` was called, which tried to create AudioContext outside a user gesture → browser blocks it.

### Why Second Load Worked

**Answer: Browser HTTP caching makes initialize() fast enough**

On second load:
1. Piano samples served from browser cache (even with `no-cache`, browser uses 304 Not Modified)
2. `initialize()` completed in ~40ms instead of ~500ms
3. `attachUnlockListeners()` was called BEFORE user clicked Play
4. When user clicked, document-level click listener fired first → `resume()` succeeded

```
FIRST LOAD (network):         SECOND LOAD (cache):
C4.mp3 download: ~450ms       C4.mp3 from cache: ~10ms
Total init:      ~500ms       Total init:        ~40ms
User clicks at:  ~300ms       User clicks at:    ~300ms
Result:          BROKEN       Result:            WORKS
```

This is why the bug:
- Only appears on **true first load** (incognito window, cleared cache)
- Is **hard to reproduce in development** (developer refreshes → cache warm)
- **Affects new users disproportionately**
- Is **worse on slow networks** (longer fetch = more likely gesture expires)

### Why Old Code Worked Despite Same Bug

The old code ALSO called `initialize()` from mouseenter! But it worked because:

```
OLD CODE TIMING:
Time 0ms:   mouseenter → initialize() starts, context created (suspended)
Time 50ms:  createSynthesizedSamples() completes (FAST - in-memory generation)
Time 50ms:  attachUnlockListeners() adds click handler to document
Time 500ms: User clicks Play
Time 500ms: Document click listener fires FIRST → resume() SUCCEEDS
Time 500ms: handlePlayPause runs with context already unlocked
```

The key: old code finished in ~50ms, so unlock listeners were ready before user clicked.

```
NEW CODE TIMING (broken):
Time 0ms:   mouseenter → initialize() starts, context created (suspended)
Time 50ms:  Piano loading starts (network fetch + decode)
Time 300ms: User clicks Play BEFORE piano loads!
Time 300ms: handlePlayPause awaits initialize() (blocked on piano)
Time 500ms: Piano loads, attachUnlockListeners() called (TOO LATE!)
Time 500ms: handlePlayPause continues, user gesture EXPIRED
Time 500ms: resume() fails, context stays suspended, NO SOUND
```

**Critical insight:** User gesture tokens expire after ~100-300ms of async waiting. Old code was fast enough. New code with piano loading exceeded the gesture timeout.

### The Fix

Don't call `initialize()` from non-gesture contexts. Skip preview if not ready:

```typescript
// FIXED CODE
const handlePreview = useCallback((sampleId: string) => {
  // IMPORTANT: Don't initialize from hover - not a user gesture!
  if (!audioEngine.isInitialized()) {
    return; // Skip preview - user must click first
  }
  audioEngine.playNow(sampleId);
}, []);
```

### Test Added

```typescript
it('should NOT call initialize() when audio is not ready (preview should be skipped)', () => {
  isInitializedSpy.mockReturnValue(false);
  handlePreviewLogic();
  expect(initializeSpy).not.toHaveBeenCalled(); // ← Key assertion
});
```

### Tone.js Pattern

Tone.js handles this correctly by:
1. Deferring AudioContext creation until `Tone.start()` is called
2. Requiring `Tone.start()` to be called from a click handler
3. Queueing operations until context is ready

### Key Lessons

1. **mouseenter feels like interaction but isn't a user gesture** for browser audio policy
2. **Test first loads specifically** - second loads often "just work" due to caching
3. **Stack traces are gold** - the bug was immediately visible in: `onMouseEnter @ SamplePicker.tsx:170`
4. **Preview is a nice-to-have** - it's OK to skip preview if audio isn't ready

### Files Changed
- `src/components/SamplePicker.tsx` - Fixed handlePreview to not call initialize()
- `src/components/SamplePicker.test.ts` - Added user gesture compliance tests

### Related Links
- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay/)
- [MDN Web Audio Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Tone.js User Gesture Documentation](https://github.com/Tonejs/Tone.js/wiki/UserMedia)

---

## iOS Audio: No Sound Despite Animation

### Symptom
Sound doesn't play on mobile browsers (iOS Safari, Chrome on iOS) even though the playhead animation runs correctly. The sequencer appears to be working but is completely silent.

### Root Causes

#### 1. iOS Mute Switch (Most Common!)

The **physical mute switch** on the left side of iPhone silences Web Audio API sounds but allows animations to continue. This is the most common cause of "no sound on mobile."

**Solution:** Check that the mute switch doesn't show orange.

#### 2. Browser Autoplay Policy

Mobile browsers require a **user gesture** (tap, click) before audio can play. The AudioContext starts in a "suspended" state and must be resumed after user interaction.

**Solution:** Call `audioContext.resume()` in response to a user tap.

#### 3. iOS "Interrupted" State

iOS Safari can put the AudioContext in an "interrupted" state (not just "suspended"). This happens when:
- The app goes to background
- A phone call comes in
- Siri activates

**Solution:** Check for both `suspended` and `interrupted` states:

```typescript
const state = audioContext.state as string;
if (state === 'suspended' || state === 'interrupted') {
  await audioContext.resume();
}
```

#### 4. Chrome on iOS Uses WebKit

Chrome, Firefox, and all browsers on iOS use Apple's WebKit engine (Apple requirement). So "Chrome on iOS" behaves like Safari, not like Chrome on Android.

**Solution:** Use `webkitAudioContext` fallback:

```typescript
const AudioContextClass = window.AudioContext ||
  (window as any).webkitAudioContext;
```

### Implementation Pattern

#### Document-Level Unlock Listeners

Attach listeners to unlock audio on any user gesture:

```typescript
function attachUnlockListeners(audioContext: AudioContext) {
  const unlock = async () => {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  };

  // touchstart is crucial for mobile
  const events = ['touchstart', 'touchend', 'click', 'keydown'];
  events.forEach(event => {
    document.addEventListener(event, unlock, { passive: true });
  });
}
```

#### Ensure Audio Ready Before Playback

Always check audio context state before starting playback:

```typescript
async function ensureAudioReady(audioContext: AudioContext): Promise<boolean> {
  const state = audioContext.state as string;
  if (state === 'suspended' || state === 'interrupted') {
    try {
      await audioContext.resume();
    } catch (e) {
      return false;
    }
  }
  return audioContext.state === 'running';
}
```

### Debugging Checklist

When mobile audio doesn't work:

1. ☐ Is the iPhone mute switch off (no orange showing)?
2. ☐ Is the device volume turned up?
3. ☐ Did the user tap something before pressing play?
4. ☐ Is `audioContext.state` equal to `'running'`?
5. ☐ Are there any errors in the browser console?
6. ☐ Try force-quitting the browser and reopening

### Key Insight

**The playhead can animate without sound** because:
- Animation uses JavaScript timers (no restrictions)
- Audio requires user gesture + unmuted device

If you see the playhead moving but hear nothing, it's almost always:
1. Mute switch is on, OR
2. AudioContext wasn't unlocked by user gesture

### Files Changed
- `src/audio/engine.ts` - Audio context handling with unlock listeners

### Related Links
- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay)
- [Apple Developer Forums - Web Audio](https://developer.apple.com/forums/thread/23499)
- [MDN Web Audio Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Unlock Web Audio in Safari](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos)

---

# Multiplayer / Backend Lessons

---

## Architecture Overview

```
┌─────────────────┐     WebSocket      ┌─────────────────────────┐
│   Browser(s)    │◄──────────────────►│  Durable Object (DO)    │
│   React App     │                    │  - In-memory state      │
│   Audio Engine  │                    │  - WebSocket handling   │
└─────────────────┘                    │  - Broadcast to clients │
                                       └───────────┬─────────────┘
                                                   │ Debounced save
                                                   │ (2s) or on
                                                   │ last disconnect
                                                   ▼
                                       ┌─────────────────────────┐
                                       │   Cloudflare KV         │
                                       │   - Persistent storage  │
                                       │   - 30-day TTL          │
                                       └─────────────────────────┘
```

---

## Lesson 1: Duplicate Track IDs Cause Corruption

**Date:** 2024-12 (Phase 11)

### The Bug
A session ended up with 16 tracks: 1 Bass + 15 duplicate Rhodes tracks, all with the same track ID.

### Root Cause
The `handleAddTrack` method in the Durable Object didn't check for duplicate track IDs before adding. When rapid client-side actions (or reconnections) sent multiple `add_track` messages with the same ID, all were blindly appended.

### Fix
Added duplicate ID check to both:
1. **DO (`live-session.ts:456`):**
   ```typescript
   if (this.state.tracks.some(t => t.id === msg.track.id)) {
     console.log(`[WS] Ignoring duplicate track: ${msg.track.id}`);
     return;
   }
   ```

2. **Frontend reducer (`grid.tsx:146`):**
   ```typescript
   if (state.tracks.some(t => t.id === newTrack.id)) {
     return state;
   }
   ```

### Lesson
**Defense in depth:** Validate at both server (DO) and client (reducer). The server is the authoritative check, but client-side validation prevents unnecessary network traffic and provides faster feedback.

---

## Lesson 2: KV and DO State Can Diverge

**Date:** 2024-12 (Phase 11)

### The Bug
After fixing duplicate tracks via WebSocket, the KV still showed corrupted state with 16 tracks while the DO had the correct 2 tracks.

### Root Cause
The DO saves to KV via:
1. **Debounced save (2 seconds)** - after any state change
2. **Immediate save** - when the last player disconnects

The debounced save hadn't fired yet when we checked KV.

### State Sync Flow
```
State Change → scheduleKVSave() → setTimeout(2000ms) → saveToKV()
                    │
                    └── If DO hibernates before timeout: SAVE IS LOST
```

### Fix
Triggered a state change (toggled a step) to force the debounce timer to fire, which synced KV with DO.

### Lesson
**Debouncing is a trade-off:** Reduces KV writes but creates a window where DO and KV diverge. For critical operations, consider:
- Immediate saves for structural changes (add/delete track)
- Debounced saves for frequent changes (step toggles, volume)

---

## Lesson 3: DO Hibernation Breaks setTimeout

**Date:** 2024-12 (Phase 11)

### The Problem
Durable Objects use the **Hibernation API** for cost efficiency. When all WebSocket connections are idle, the DO can hibernate (be evicted from memory).

**Critical issue:** `setTimeout` does NOT survive hibernation.

### Impact
```
1. User makes change → scheduleKVSave() starts 2s timer
2. User goes idle → DO hibernates after ~10s inactivity
3. Timer is lost → KV never saved
4. User reconnects → DO loads stale state from KV
```

### Mitigation Strategies

1. **Save on disconnect (implemented):**
   ```typescript
   async webSocketClose(ws, code, reason, wasClean) {
     // ...
     if (this.players.size === 0 && this.state && this.sessionId) {
       await this.saveToKV(); // Immediate save when last player leaves
     }
   }
   ```

2. **Use Durable Object Alarms (implemented - Phase 11):**
   Replaced `setTimeout` with `ctx.storage.setAlarm()`. Alarms persist across hibernation:
   ```typescript
   private scheduleKVSave(): void {
     this.pendingKVSave = true;
     // Alarms survive hibernation, unlike setTimeout
     this.ctx.storage.setAlarm(Date.now() + KV_SAVE_DEBOUNCE_MS).catch(e => {
       console.error('[KV] Error scheduling alarm:', e);
     });
   }

   async alarm(): Promise<void> {
     if (this.pendingKVSave) {
       await this.saveToKV();
       this.pendingKVSave = false;
     }
   }
   ```

3. **Periodic client-side sync requests:**
   Have clients periodically request state hash verification.

### Lesson
**Hibernation-aware design:** Any time-based operations in DOs must account for hibernation. Use Alarms for reliable scheduling, not setTimeout.

---

## Lesson 4: Browser Must Refresh to See KV Updates

**Date:** 2024-12 (Phase 11)

### The Observation
After KV was updated with correct state, the open browser tab still showed old state (1 track instead of 2).

### Explanation
The browser connects via WebSocket to the DO. If the DO is still running with old in-memory state, that's what's served. Only when:
1. DO hibernates (no connections), AND
2. Browser reconnects (refresh or new tab)

...does the DO reload from KV.

### The Flow
```
Browser Tab Open (showing old state)
         │
         │ (WebSocket connected to DO with old state)
         │
         ▼
    DO in Memory ──── Old State (1 track)
         │
         │ (Meanwhile, KV was updated externally)
         │
         ▼
       KV Store ────── New State (2 tracks)
         │
         │ (User refreshes browser)
         │
         ▼
    DO loads from KV → New State (2 tracks) → Browser shows 2 tracks
```

### Lesson
**DO is the live source of truth** during active sessions. KV is only consulted when DO starts fresh (after hibernation or restart).

---

## Lesson 5: The DELETE Operation Pitfall

**Date:** 2024-12 (Phase 11)

### The Bug
When trying to delete 14 duplicate Rhodes tracks, all 15 Rhodes tracks were deleted (including the one we wanted to keep).

### Root Cause
All duplicate tracks had the same ID. The delete operation:
```typescript
const index = this.state.tracks.findIndex(t => t.id === trackId);
this.state.tracks.splice(index, 1);
```

This only removes one at a time, but we sent 14 delete messages, each finding the "first" Rhodes track.

### Lesson
**Unique IDs are fundamental:** Track IDs must be unique. Operations that assume uniqueness will behave unexpectedly when duplicates exist. Always validate uniqueness at creation time.

---

## Lesson 6: Reconnection Needs Jitter

**Date:** 2024-12 (Phase 12)

### The Problem

When a server goes down and comes back up, all disconnected clients try to reconnect at exactly the same time. This "thundering herd" can:
- Overwhelm the server immediately after recovery
- Cause cascading failures
- Result in poor user experience as connections are rejected

### The Solution

**Exponential backoff with jitter:**

```typescript
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_JITTER = 0.25; // ±25%

function calculateReconnectDelay(attempt: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const exponentialDelay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
    RECONNECT_MAX_DELAY_MS
  );

  // Jitter: ±25% randomization
  const jitterRange = exponentialDelay * RECONNECT_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(exponentialDelay + jitter);
}
```

### Why ±25% Jitter?

- **Too little jitter (±5%):** Clients still cluster together
- **Too much jitter (±50%):** Some clients wait unnecessarily long
- **±25% is a good balance:** Spreads reconnections while keeping wait times reasonable

### Lesson

**Always add jitter to retry logic.** The exponential backoff alone isn't enough — without jitter, all clients with the same retry count will reconnect simultaneously.

---

## Lesson 7: Offline Queues Need Limits

**Date:** 2024-12 (Phase 12)

### The Problem

When disconnected, users may continue editing. Naively queueing all changes can:
- Consume unbounded memory
- Replay stale/conflicting changes on reconnect
- Cause confusing state after long disconnections

### The Solution

**Bounded queue with age limits:**

```typescript
private maxQueueSize: number = 100;
private maxQueueAge: number = 30000; // 30 seconds

private queueMessage(message: ClientMessage): void {
  // Don't queue time-sensitive messages
  if (message.type === 'clock_sync_request' || message.type === 'state_hash') {
    return;
  }

  // Drop oldest if full
  if (this.offlineQueue.length >= this.maxQueueSize) {
    this.offlineQueue.shift();
  }

  this.offlineQueue.push({
    message,
    timestamp: Date.now(),
  });
}

private replayQueuedMessages(): void {
  const now = Date.now();
  for (const queued of this.offlineQueue) {
    // Skip stale messages
    if (now - queued.timestamp > this.maxQueueAge) continue;
    this.ws.send(JSON.stringify(queued.message));
  }
  this.offlineQueue = [];
}
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Queue size limit | 100 messages | Reasonable for ~30s of editing |
| Message age limit | 30 seconds | Old changes likely conflict with server state |
| What to queue | State changes only | Skip clock sync, state hash requests |
| When to queue | Only during 'connecting' | Fresh state on new connection anyway |

### Lesson

**Offline queues need boundaries.** Define max size, max age, and which message types to queue. After long disconnections, sync fresh state rather than replaying potentially conflicting changes.

---

## Lesson 8: Connection Status Must Be Visible

**Date:** 2024-12 (Phase 12)

### The Problem

Users can't tell if:
- Their changes are being saved
- They're working in single-player mode
- Reconnection is happening

This leads to confusion and lost work when they think they're connected but aren't.

### The Solution

**Visual connection indicator with states:**

```
┌──────────────────────────┐
│ ● Connected              │  (green, solid)
│ ● Connecting...          │  (yellow, pulsing)
│ ● Reconnecting (3)...    │  (yellow, shows attempt count)
│ ● Offline                │  (red)
│ ● Offline (5 queued)     │  (red, shows pending changes)
└──────────────────────────┘
```

### State Transitions

```
disconnected ──connect()──► connecting ──snapshot──► connected
     ▲                           │                       │
     │                           │                       │
     └─────── max retries ◄──────┴──── close/error ◄────┘
                  (removed in Phase 12 - keep trying)
```

### Lesson

**Make connection state obvious.** Users need to know:
1. Current status (connected/connecting/offline)
2. Reconnection progress (attempt count)
3. Pending changes (queue size)

---

## Lesson 9: Validate Requests Before Routing to Durable Objects

**Date:** 2024-12 (Phase 13A)

### The Problem

Cloudflare bills for Durable Object requests. If malformed requests (invalid UUIDs, oversized bodies, invalid data) reach the DO, you pay for:
- DO invocation
- CPU time for error handling
- Potential state corruption from bad data

### The Solution

**Validate in the Worker BEFORE routing to DO:**

```typescript
// src/worker/validation.ts
export function isValidUUID(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

export function isBodySizeValid(contentLength: string | null): boolean {
  if (!contentLength) return true;
  const size = parseInt(contentLength, 10);
  return !isNaN(size) && size <= MAX_MESSAGE_SIZE;
}

export function validateSessionState(state: unknown): ValidationResult {
  const errors: string[] = [];
  // Check tempo, swing, tracks array, step counts, etc.
  return { valid: errors.length === 0, errors };
}
```

**In Worker routes:**
```typescript
// Validate BEFORE getting DO stub
if (!isValidUUID(sessionId)) {
  return jsonError('Invalid session ID format', 400);  // Never hits DO
}

if (!isBodySizeValid(request.headers.get('content-length'))) {
  return jsonError('Request body too large', 413);  // Never hits DO
}

const validation = validateSessionState(body.state);
if (!validation.valid) {
  return validationErrorResponse(validation.errors);  // Never hits DO
}

// Only now route to DO
const stub = env.LIVE_SESSIONS.get(doId);
```

### Documentation

From [Cloudflare DO Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/):

> "Validate requests in the Worker before routing to Durable Objects to avoid billing for invalid requests."

### Lesson

**Shift validation left.** Every request that fails validation in the Worker is a request that doesn't cost DO compute. This is especially important for public-facing endpoints.

---

## Lesson 10: Recreate DO Stubs on Retryable Errors

**Date:** 2024-12 (Phase 13A)

### The Problem

A `DurableObjectStub` can enter a "broken" state after certain errors. Continuing to use the same stub will fail repeatedly even though the DO itself may be healthy.

### The Solution

**Check error properties and recreate stub on retryable errors:**

```typescript
try {
  return await stub.fetch(request);
} catch (error) {
  const e = error as { retryable?: boolean; overloaded?: boolean };

  // NEVER retry overloaded errors - makes things worse
  if (e.overloaded) {
    return jsonError('Service temporarily unavailable', 503);
  }

  // Recreate stub and retry once for retryable errors
  if (e.retryable) {
    stub = env.LIVE_SESSIONS.get(doId);  // Fresh stub
    try {
      return await stub.fetch(request);
    } catch (retryError) {
      return jsonError('Request failed after retry', 500);
    }
  }

  return jsonError('Request failed', 500);
}
```

### Error Types

| Property | Meaning | Action |
|----------|---------|--------|
| `e.retryable === true` | Transient failure, may succeed on retry | Recreate stub, retry once |
| `e.overloaded === true` | DO is overloaded | Return 503, do NOT retry |
| Neither | Permanent failure | Return 500 |

### Documentation

From [Cloudflare DO Error Handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/):

> "The DurableObjectStub may be in a 'broken' state... create a new stub to retry."

### Lesson

**Stubs are cheap, retrying broken stubs is expensive.** When a stub fails with a retryable error, discard it and create a fresh one. Never retry on overload — you'll make the situation worse.

---

## Lesson 11: Client-Side Timeouts Prevent Hung Connections

**Date:** 2024-12 (Phase 13A)

### The Problem

Without timeouts, a `fetch()` call can hang indefinitely if:
- Network is down but socket hasn't closed
- Server is slow to respond
- Connection is in a half-open state

This leaves the UI frozen with no feedback to the user.

### The Solution

**Use AbortController with all fetch calls:**

```typescript
const DEFAULT_TIMEOUT_MS = 10000;  // 10 seconds
const SAVE_TIMEOUT_MS = 15000;     // 15 seconds (larger payloads)

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Usage
const response = await fetchWithTimeout(`/api/sessions/${id}`, {
  method: 'PUT',
  body: JSON.stringify({ state }),
}, SAVE_TIMEOUT_MS);
```

### Error Handling

```typescript
try {
  const response = await fetchWithTimeout(url, options);
  // ...
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.error('Request timed out');
    // Show user-friendly timeout message
  } else {
    console.error('Request failed:', error);
  }
}
```

### Timeout Guidelines

| Operation | Timeout | Rationale |
|-----------|---------|-----------|
| GET session | 10s | Small payload, should be fast |
| PUT session | 15s | Larger payload (16 tracks × 64 steps) |
| POST create | 10s | Small request, creates UUID |
| POST remix | 10s | Server-side copy, no upload |

### Lesson

**Set timeouts on all network requests.** 10 seconds is a reasonable default. Larger operations (saves, uploads) may need more time. Always handle `AbortError` separately from other errors.

---

## Lesson 12: XSS Prevention in User-Controlled Fields

**Date:** 2024-12 (Phase 13A)

### The Problem

Session names are user-controlled and rendered in the UI. Without validation:
- `<script>alert(1)</script>` could execute in other users' browsers
- `javascript:` URLs could be injected
- Event handlers like `onerror=` could trigger XSS

### The Solution

**Server-side validation with pattern blocking:**

```typescript
export function validateSessionName(name: unknown): ValidationResult {
  if (name === null) return { valid: true, errors: [] };  // null clears name
  if (typeof name !== 'string') {
    return { valid: false, errors: ['Name must be a string or null'] };
  }

  const errors: string[] = [];

  // Length limit
  if (name.length > 100) {
    errors.push('Name cannot exceed 100 characters');
  }

  // XSS pattern detection
  if (/<script|javascript:|on\w+\s*=/i.test(name)) {
    errors.push('Name contains potentially unsafe content');
  }

  // Unicode-safe character validation
  const SAFE_PATTERN = /^[\p{L}\p{N}\p{P}\p{S}\s]*$/u;
  if (!SAFE_PATTERN.test(name)) {
    errors.push('Name contains invalid characters');
  }

  return { valid: errors.length === 0, errors };
}
```

### Test Results

```bash
$ curl -X PATCH /api/sessions/{id} -d '{"name": "<script>alert(1)</script>"}'
{"error":"Validation failed","details":["Name contains potentially unsafe content"]}

$ curl -X PATCH /api/sessions/{id} -d '{"name": "My Cool Beat 🎵"}'
{"id":"...","name":"My Cool Beat 🎵","updatedAt":...}  # Allowed
```

### Defense in Depth

| Layer | Protection |
|-------|------------|
| Server validation | Block dangerous patterns at API level |
| React rendering | JSX auto-escapes by default |
| CSP headers | Block inline scripts (future) |

### Lesson

**Validate at the boundary, escape at the output.** Server-side validation blocks the most dangerous patterns. React's JSX escaping handles the rest. Together they prevent XSS even if one layer fails.

---

## Lesson 13: WebSocket Connection Storm (Production-Only)

**Date:** 2024-12 (Phase 14+)

### The Bug

Every user interaction (clicking a step, changing tempo) caused the WebSocket to disconnect and reconnect with a new player ID. A single user session could generate hundreds of unique player IDs, overwhelming the server.

### Why It Wasn't Caught Locally

| Environment | WebSocket Connection | Bug Triggered |
|-------------|---------------------|---------------|
| `npm run dev` (Vite) | Mock API - no real WebSocket | No |
| `npx wrangler dev` | Real WebSocket | Yes, but not observed |
| Production | Real WebSocket | Yes, visible in logs |

The Vite development server used a mock API plugin that intercepted `/api/*` requests. WebSocket upgrade requests either failed silently or returned mock responses. **The buggy code path was never executed during normal development.**

### Root Cause

```typescript
// App.tsx - BUGGY PATTERN
const getStateForHash = useCallback(() => ({
  tracks: state.tracks,
  tempo: state.tempo,
  swing: state.swing,
}), [state.tracks, state.tempo, state.swing]); // Dependencies change on every state update

// useMultiplayer.ts
useEffect(() => {
  connect(sessionId, getStateForHash);
  return () => disconnect();
}, [sessionId, getStateForHash]); // Effect re-runs when callback changes!
```

**What happens:**
1. Component renders, effect runs, WebSocket connects
2. User changes tempo → state updates
3. `getStateForHash` gets new reference (due to state dependencies)
4. useEffect cleanup runs → WebSocket disconnects
5. useEffect runs → WebSocket reconnects with new player ID
6. Repeat for every state change = "connection storm"

### The Fix

```typescript
// App.tsx - FIXED PATTERN using ref
const stateRef = useRef(state);
stateRef.current = state; // Always update ref

const getStateForHash = useCallback(() => ({
  tracks: stateRef.current.tracks,
  tempo: stateRef.current.tempo,
  swing: stateRef.current.swing,
}), []); // Empty deps = stable reference
```

### Prevention

- [ ] **Never put state values in useCallback deps if the callback is used as a useEffect dependency**
- [ ] **Use ref pattern** for callbacks that need current state but stable reference
- [ ] **Test with real backend** (wrangler dev), not just mocks
- [ ] **Add runtime detection** for anomalous reconnection rates
- [ ] **Monitor unique player ID count** in debug overlay

See: [BUG-PATTERNS.md](./BUG-PATTERNS.md#2-unstable-callback-in-useeffect-dependency-connection-storm-bug)

---

## Lesson 14: State Hash Mismatch (Production-Only)

**Date:** 2024-12 (Phase 14+)

### The Bug

Client and server computed different hashes for what should be identical state, causing "state mismatch" warnings and potential sync issues.

### Why It Wasn't Caught Locally

- Unit tests mocked the server response, never testing real serialization
- No integration tests compared actual client/server hash computation
- The mismatch only occurred with specific field combinations

### Root Cause

```typescript
// Client Track type - fields may be undefined
interface Track {
  id: string;
  soloed?: boolean;  // Optional - may be undefined
  stepCount?: number; // Optional - may be undefined
}

// Server SessionTrack type - fields always present
interface SessionTrack {
  id: string;
  soloed: boolean;  // Required - always present
  stepCount: number; // Required - always present
}

// JSON.stringify produces different output:
// Client: {"id":"1"}  (undefined fields omitted)
// Server: {"id":"1","soloed":false,"stepCount":16}
```

### The Fix

1. **Compile-time type parity check** ensures Track and SessionTrack have same fields
2. **Canonical hash function** with explicit field ordering and normalization
3. **Normalization before hashing** to ensure consistent representation

```typescript
// Canonical normalization - same output regardless of field presence
function canonicalizeForHash(state) {
  return {
    tracks: state.tracks.map(t => ({
      id: t.id,
      soloed: t.soloed ?? false,      // Explicit default
      stepCount: t.stepCount ?? 16,    // Explicit default
      // ... all fields with explicit defaults
    })),
  };
}
```

### Prevention

- [ ] **Same optionality** across serialization boundaries - if client has `field?: T`, server should too
- [ ] **Add parity tests** that verify both sides produce identical serialization
- [ ] **Single normalization point** - don't scatter `?? false` throughout codebase
- [ ] **Cross-boundary tests** - verify hash match after real network round-trip

See: [BUG-PATTERNS.md](./BUG-PATTERNS.md#1-serialization-boundary-mismatch)

---

# Reference

---

## Cloudflare Component Interactions

### Durable Objects (DO)

| Aspect | Behavior |
|--------|----------|
| **State** | In-memory, lost on hibernation unless explicitly saved |
| **Hibernation** | Automatic after idle period; setTimeout/setInterval are cleared |
| **WebSockets** | Use Hibernation API with `acceptWebSocket()` for efficient handling |
| **Persistence** | Must explicitly save to KV/R2/SQLite; nothing automatic |
| **Geographic** | Created near first user, stays there (doesn't migrate) |
| **Alarms** | Survive hibernation; use for scheduled tasks |

### KV (Key-Value Store)

| Aspect | Behavior |
|--------|----------|
| **Consistency** | Eventually consistent (can take up to 60s to propagate globally) |
| **Read Performance** | Very fast (edge-cached) |
| **Write Performance** | Slower than DO; avoid frequent writes |
| **TTL** | Can set expiration; we use 30 days |
| **Size Limit** | 25 MB per value |

### Best Practices for KV ↔ DO Sync

1. **DO is authoritative during active sessions**
2. **KV is the persistence layer for inactive sessions**
3. **Debounce frequent writes to KV** (2s minimum)
4. **Always save on last disconnect**
5. **Consider state versioning** for conflict detection
6. **Use state hashing** to detect divergence

---

## Testing Multiplayer Systems

### Key Test Scenarios

Based on ultrathink analysis:

1. **Concurrency Stress:**
   - 10 simultaneous users toggling same step
   - Rapid-fire tempo changes from multiple clients
   - High message volume (100+ messages in quick succession)

2. **Race Conditions:**
   - Two users adding track with same ID simultaneously
   - Delete + modify race condition
   - Concurrent mute/solo toggles

3. **State Synchronization:**
   - KV debounce timing verification
   - Hibernation and wake-up cycles
   - Client reconnection with stale state

4. **Edge Cases:**
   - Network partition (client can't reach server)
   - Client disconnect mid-operation
   - Maximum player limit (10)
   - Invalid/malformed messages

5. **Chaos Engineering:**
   - Random disconnection during operations
   - Message reordering/dropping simulation
   - State corruption detection

### Invariants That Must ALWAYS Hold

```typescript
// No duplicate track IDs
const trackIds = state.tracks.map(t => t.id);
assert(new Set(trackIds).size === trackIds.length);

// Track count within limit
assert(state.tracks.length <= 16);

// Tempo within bounds
assert(state.tempo >= 30 && state.tempo <= 300);

// All tracks have valid step arrays (up to MAX_STEPS = 128)
state.tracks.forEach(t => {
  assert(t.steps.length <= 128);
  assert(t.parameterLocks.length <= 128);
});
```

---

## Lesson 15: Durable Object Initialization Race Conditions

**Category:** Infrastructure

**Problem:** Multiple concurrent requests arriving at a Durable Object before state is loaded from storage can cause race conditions, duplicate loads, or requests seeing partially-initialized state.

**Root Cause:** DO constructor runs synchronously but state loading is async. Without proper concurrency control, multiple requests can trigger parallel state loads or see null state.

**Solution:** Use `blockConcurrencyWhile()` in the constructor or a lazy initialization pattern:

```typescript
// Schema version for migrations
const SCHEMA_VERSION = 1;

export class LiveSessionDurableObject extends DurableObject<Env> {
  private state: SessionState | null = null;
  private stateLoaded: boolean = false;
  private stateLoadPromise: Promise<void> | null = null;
  private serverSeq: number = 0;  // Now persisted to survive hibernation

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Load critical data with blockConcurrencyWhile
    this.ctx.blockConcurrencyWhile(async () => {
      // Restore serverSeq from storage
      const storedSeq = await this.ctx.storage.get<number>('serverSeq');
      if (storedSeq !== undefined) {
        this.serverSeq = storedSeq;
      }

      // Schema migration support
      const storedVersion = await this.ctx.storage.get<number>('schemaVersion');
      if (storedVersion !== undefined && storedVersion < SCHEMA_VERSION) {
        await this.migrateSchema(storedVersion);
      }
      await this.ctx.storage.put('schemaVersion', SCHEMA_VERSION);
    });
  }

  // Lazy state loading with concurrency protection
  private async ensureStateLoaded(sessionId: string): Promise<void> {
    if (this.stateLoaded) return;

    if (this.stateLoadPromise) {
      await this.stateLoadPromise;
      return;
    }

    this.stateLoadPromise = this.ctx.blockConcurrencyWhile(async () => {
      if (this.stateLoaded) return;  // Double-check after acquiring lock

      const session = await getSession(this.env, sessionId);
      this.state = session?.state ?? { tracks: [], tempo: 120, swing: 0, version: 1 };
      this.stateLoaded = true;
    });

    await this.stateLoadPromise;
  }
}
```

**Key Patterns:**

1. **Constructor initialization:** Use `blockConcurrencyWhile()` for data that must be loaded before any request can proceed (serverSeq, schema version)

2. **Lazy state loading:** For session-specific state, use a flag + promise pattern with `blockConcurrencyWhile()` to ensure only one load happens

3. **Persist critical sequence numbers:** `serverSeq` must survive hibernation/eviction:
   - Load in constructor via `blockConcurrencyWhile()`
   - Persist periodically (every N messages)
   - Persist on save/cleanup

4. **Schema versioning from day one:** Include version tracking even for v1 to enable future migrations without data loss

**Prevention:**
- Always use `blockConcurrencyWhile()` for any async initialization
- Persist sequence numbers to DO storage, not just in-memory
- Include schema version in storage from the start
- Test concurrent request scenarios

**Reference:** [Cloudflare DO Best Practices - Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)

---

## Future Considerations

### Conflict Resolution

Currently using "last write wins" which can lose data in race conditions. Consider:
- **Operational Transformation (OT):** Track intentions, transform conflicts
- **CRDTs:** Conflict-free replicated data types for automatic merging
- **Optimistic locking:** Version numbers to detect conflicts

### Clock Synchronization

For synchronized audio playback across clients:
- Implement clock offset calculation using RTT/2 approximation
- Use server time as reference for playback start
- Consider Web Audio API's `currentTime` for precise local scheduling

### State Recovery (Implemented - Phase 11)

State corruption detection and auto-repair are now implemented:

1. **Invariant validation module (`invariants.ts`):**
   - `validateStateInvariants()` - checks all state invariants
   - `logInvariantStatus()` - logs violations to Cloudflare logs
   - `repairStateInvariants()` - auto-repairs when possible

2. **Validation points in DO:**
   - `loadFromKV` - validates state loaded from KV
   - `handleAddTrack` - validates after adding track
   - `handleDeleteTrack` - validates after deletion
   - `handleClearTrack` - validates after clearing

3. **Log output format:**
   ```
   [INVARIANT VIOLATION][handleAddTrack] session=abc-123 { violations: [...], trackCount: 16, trackIds: [...] }
   [INVARIANT] Auto-repaired state for session=abc-123 { repairs: [...] }
   ```

4. **Monitoring via `wrangler tail`:**
   - Use `npx wrangler tail --format=pretty` to monitor live logs
   - Filter for `[INVARIANT]` prefix to see corruption events

---

## Phase Summaries

### Phase 12: Error Handling

1. **Exponential Backoff + Jitter**
   - Base delay: 1s, max: 30s
   - ±25% jitter to prevent thundering herd
   - No max attempts (keep trying indefinitely)

2. **Offline Queue**
   - Max 100 messages
   - Max 30 second age
   - Skips time-sensitive messages
   - Replays on reconnect after snapshot

3. **Connection Status Indicator**
   - Visual dot (green/yellow/red)
   - Status text with reconnect count
   - Queue size display

4. **Graceful Degradation**
   - Local dispatch always works
   - KV sync continues via session layer
   - Changes replay on reconnect

### Phase 13A: Cloudflare Best Practices

| Improvement | Location | Documentation |
|-------------|----------|---------------|
| Worker-level validation | `worker/validation.ts` | [DO Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| UUID format validation | `worker/index.ts` | Prevents routing invalid IDs to DO |
| Body size validation | `worker/index.ts` | [MAX_MESSAGE_SIZE from invariants](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#limit-websocket-message-size) |
| Session state validation | `worker/validation.ts` | Enforces tempo/swing/track constraints |
| XSS prevention | `worker/validation.ts` | Blocks script tags, javascript: URLs |
| Stub recreation | `worker/index.ts` | [DO Error Handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/) |
| Overload handling | `worker/index.ts` | Returns 503, never retries |
| Request timeouts | `sync/session.ts` | AbortController with 10-15s limits |

---

## Lesson 15: E2E Tests Must Use Correct API Response Structure

**Date:** 2024-12-18
**Severity:** High - caused CI failures
**Time to Fix:** 2 hours across multiple attempts

### The Bug

E2E tests in `session-race.spec.ts` were failing in CI with `sessionData.tracks` being `undefined`:

```typescript
// WRONG - tests were accessing tracks directly
expect(sessionData.tracks).toHaveLength(2);

// CORRECT - API returns data nested in state object
expect(sessionData.state.tracks).toHaveLength(2);
```

### Root Cause

The GET `/api/sessions/{id}` endpoint returns session data wrapped in a `state` object:

```json
{
  "id": "uuid",
  "exists": true,
  "createdAt": "...",
  "state": {
    "tracks": [...],
    "tempo": 120,
    "swing": 0,
    ...
  }
}
```

But tests were assuming `tracks` was at the top level: `sessionData.tracks` instead of `sessionData.state.tracks`.

### Why It Wasn't Caught

1. Tests passed locally (different timing characteristics)
2. Other tests used the debug endpoint with different response format
3. No shared type definitions for E2E test API responses
4. Tests weren't using TypeScript strict mode for API responses

### The Fix

1. Created shared utilities in `e2e/test-utils.ts` with typed interfaces:
   ```typescript
   export interface SessionResponse {
     id: string;
     state: SessionState;  // tracks/tempo/swing are HERE
   }
   ```

2. Added helper functions that enforce correct access patterns:
   ```typescript
   const session = await getSessionWithRetry(request, sessionId);
   expect(session.state.tracks).toHaveLength(2);
   ```

### Prevention

- **Always use `e2e/test-utils.ts`** helpers for session API calls
- **Type API responses** with proper interfaces
- **Check response structure** when a test accesses API data

---

## Lesson 16: CI Tests Need Retry Logic for API Resilience

**Date:** 2024-12-18
**Severity:** Medium - caused flaky CI
**Time to Fix:** 30 minutes

### The Bug

E2E tests in CI were intermittently failing with session creation or read failures:

```
Error: expect(createRes.ok()).toBe(true)
Expected: true
Received: false
```

### Root Cause

Multiple factors cause intermittent API failures in CI:

1. **Durable Object cold starts** - First request to a DO may take longer
2. **KV eventual consistency** - Data may not be immediately available after write
3. **Rate limiting** - Production API may throttle rapid test requests
4. **Network variability** - CI runners have inconsistent network performance

### Why It Wasn't Caught

- Local tests run against local dev server with no cold starts
- Local tests don't hit rate limits
- Failures are intermittent (passed most of the time)

### The Fix

Created helpers with retry logic:

```typescript
// e2e/test-utils.ts
export async function createSessionWithRetry(
  request: APIRequestContext,
  data: Record<string, unknown>,
  maxRetries = 3
): Promise<{ id: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await request.post(`${API_BASE}/api/sessions`, { data });
    if (res.ok()) return res.json();
    // Exponential backoff
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error('Session create failed after retries');
}
```

### Prevention

- **Always use `createSessionWithRetry()`** for session creation in E2E tests
- **Always use `getSessionWithRetry()`** when reading session data
- **Add retry logic** when calling any production API in tests
- **Use exponential backoff** to avoid thundering herd

### Related

- Lesson 2: KV and DO State Can Diverge
- Lesson 10: Recreate DO Stubs on Retryable Errors

---

## Lesson 17: Test Scripts Must Match Server Message Structure

**Date:** 2024-12-18
**Severity:** Low - test bug, not production bug
**Time to Fix:** 15 minutes

### The Bug

Multiplayer sync test (`test-multiplayer-sync.ts`) was failing with "Track received by B: ✗" even though the sync was working correctly. The test reported 7/8 checks passed, making it appear that track sync was broken.

### Root Cause

The test script was checking the wrong JSON path for tracks in the snapshot message:

```typescript
// BUGGY CODE - looking at wrong path
const tracks = msg.tracks || [];  // ← BUG: tracks is undefined

// Server actually sends:
{
  type: 'snapshot',
  state: { tracks: [...], tempo: 120, swing: 0 },  // tracks is inside state
  players: [...],
  playerId: '...'
}
```

The fix was simple:
```typescript
// FIXED CODE - correct path
const tracks = msg.state?.tracks || [];
```

### Why It Wasn't Caught

- The test was newly created - no prior baseline to compare against
- Manual browser testing worked (browser code uses correct path)
- The real-time broadcast test passed (tempo sync), masking the issue
- Error message "Tracks received: 0" was ambiguous - could mean sync failed OR parse failed

### Prevention

1. **Log the raw message structure** when debugging sync tests:
   ```typescript
   console.log('Raw snapshot:', JSON.stringify(msg, null, 2));
   ```

2. **Use TypeScript types from shared definitions** instead of inline types:
   ```typescript
   import { ServerMessage } from '../src/worker/types';
   // TypeScript will catch msg.tracks as invalid
   ```

3. **Test both directions early** - if Client B can receive tempo changes from A, but not tracks, the test script (not the server) is likely wrong.

### Pattern Recognition

When debugging multiplayer tests:
- ✓ Real-time broadcasts work (tempo_changed) = WebSocket layer is fine
- ✓ Persistence works (final state in KV) = Server handlers are fine
- ✗ Initial snapshot missing data = Check client-side message parsing

### Related Files

- `scripts/test-multiplayer-sync.ts` - Test script with fix
- `src/worker/live-session.ts:287-296` - Server snapshot structure
- `src/worker/types.ts` - ServerMessage type definition

---

## Lesson 18: KV Save Debouncing Can Cause Test Timing Issues

**Date:** 2024-12-18
**Severity:** Low - documentation/understanding issue
**Time to Fix:** 5 minutes (once understood)

### The Observation

During multiplayer sync testing, the persisted state sometimes showed stale values (tempo=120 instead of 140) when checking immediately after tests completed.

### Root Cause

`KV_SAVE_DEBOUNCE_MS = 5000` in `live-session.ts` means state changes are batched and persisted via Durable Object alarms. If the test completes and disconnects before the alarm fires, the KV write may not happen.

Timeline:
```
0s    - Client A adds track → scheduleKVSave() → alarm set for 5s
1s    - Client B changes tempo → scheduleKVSave() → alarm RESET to 6s
2s    - Test ends, both clients disconnect
6s    - Alarm fires (if DO hasn't been evicted)
```

### Why It's Not a Bug

- Real-time sync works correctly (broadcasts are immediate)
- Users see changes instantly via WebSocket
- KV is eventually consistent - this is by design for cost/performance
- Production users keep sessions open longer, so alarms have time to fire

### When It Matters

- **CI tests checking persisted state** - add delay before checking KV
- **DO eviction before alarm** - rare, but possible under heavy load
- **Debugging "data loss"** - check if it's just timing vs actual loss

### Test Strategy

```typescript
// Wait for KV debounce before checking persisted state
await new Promise(r => setTimeout(r, 6000));  // > KV_SAVE_DEBOUNCE_MS
const session = await fetch(`/api/sessions/${id}`);
```

### Related

- Lesson 2: KV and DO State Can Diverge
- `live-session.ts:97` - `KV_SAVE_DEBOUNCE_MS` constant

---

## References

- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/)
- [DO WebSocket Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [DO Error Handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)
- [Hibernation API Guide](https://developers.cloudflare.com/durable-objects/reference/websockets/)
- [KV Documentation](https://developers.cloudflare.com/kv/)
- [Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Exponential Backoff And Jitter (AWS)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
