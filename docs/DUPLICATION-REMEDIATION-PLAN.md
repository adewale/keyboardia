# Duplication Remediation Plan

**Generated:** 2026-01-09
**Audit Scope:** Full codebase analysis for duplication and missing abstractions
**Total Issues Identified:** 89 distinct duplication patterns across 6 categories

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Task List by Priority](#task-list-by-priority)
3. [Bug Patterns to Add](#bug-patterns-to-add)
4. [Verification Audits](#verification-audits)
5. [Implementation Guidelines](#implementation-guidelines)

---

## Executive Summary

| Category | Issues | Lines Affected | Priority |
|----------|--------|----------------|----------|
| Handler Duplication | 23 handlers | ~400 lines | Critical |
| Validation Logic | 15 patterns | ~200 lines | Critical |
| Type Definitions | 31 definitions | Test brittleness | Critical |
| State Mutation Patterns | 21 instances | ~300 lines | High |
| CSS Duplication | 109 patterns | ~500 lines | High |
| Audio Abstractions | 8 patterns | ~300 lines | Medium |
| React Hooks | 7 patterns | ~250 lines | Medium |
| Test Setup | 8 patterns | ~150 lines | Low |
| Error Handling | 12 patterns | ~100 lines | Low |

---

## Task List by Priority

### Phase 1: Critical (Blocks correctness)

#### TASK-001: Fix Test Type Drift
**Priority:** P0 - Critical
**Estimated Effort:** 2 hours
**Files to Modify:**
- Create: `app/test/types.ts`
- Modify: `app/test/staging/*.test.ts` (6 files)
- Modify: `app/test/integration/*.test.ts` (2 files)

**Description:**
Test files define local types that have drifted from canonical definitions, causing silent test failures.

**Subtasks:**
- [ ] 001.1: Create `app/test/types.ts` that re-exports from `src/shared/`
- [ ] 001.2: Update `effects-immediate-sync.test.ts` - remove local SessionTrack, PlayerInfo, EffectsState
- [ ] 001.3: Update `effects-bypass-sync.test.ts` - remove local types
- [ ] 001.4: Update `multiplayer-sync.test.ts` - CRITICAL: FMParams has wrong structure
- [ ] 001.5: Update `kv-staleness.test.ts` - remove local SessionState, SessionTrack
- [ ] 001.6: Update `failure-modes.test.ts` - remove local types
- [ ] 001.7: Update `staging-e2e-test.ts` script - use shared types
- [ ] 001.8: Add CI lint rule to detect local type definitions in test files

**Acceptance Criteria:**
- No test file contains `interface SessionTrack`, `interface FMParams`, etc.
- All test files import types from `../types` or `../../src/shared/`
- CI fails if new local type definitions are added

---

#### TASK-002: Migrate Pattern Handlers to Factory
**Priority:** P0 - Critical
**Estimated Effort:** 1 hour
**Files to Modify:**
- `app/src/sync/multiplayer.ts` (lines 2096-2144)

**Description:**
Five pattern operation handlers are 100% copy-paste with only log message differences.

**Current Code (repeated 5x):**
```typescript
private handlePatternRotated = (msg: {...}): void => {
  if (msg.playerId === this.state.playerId) return;
  logger.ws.log(`Pattern rotated: track=${msg.trackId} direction=${msg.direction} by ${msg.playerId}`);
  if (this.dispatch) {
    this.dispatch({ type: 'SET_TRACK_STEPS', trackId: msg.trackId, steps: msg.steps,
                   parameterLocks: msg.parameterLocks, stepCount: msg.stepCount, isRemote: true });
  }
};
```

**Subtasks:**
- [ ] 002.1: Create `createPatternOperationHandler(operationName: string)` factory in `handler-factory.ts`
- [ ] 002.2: Replace `handlePatternRotated` with factory call
- [ ] 002.3: Replace `handlePatternInverted` with factory call
- [ ] 002.4: Replace `handlePatternReversed` with factory call
- [ ] 002.5: Replace `handlePatternMirrored` with factory call
- [ ] 002.6: Replace `handleEuclideanFilled` with factory call
- [ ] 002.7: Add unit test for new factory

**Acceptance Criteria:**
- All 5 pattern handlers use the factory
- Factory is tested with all operation types
- No manual echo prevention code in pattern handlers

---

#### TASK-003: Create Validation Module
**Priority:** P0 - Critical
**Estimated Effort:** 3 hours
**Files to Create:**
- `app/src/shared/validation.ts`

**Files to Modify:**
- `app/src/audio/track-bus.ts`
- `app/src/components/VelocityLane.tsx`
- `app/src/components/XYPad.tsx`
- `app/src/components/TransportBar.tsx`
- `app/src/components/TrackRow.tsx`
- `app/src/components/LoopRuler.tsx`
- `app/src/worker/live-session.ts`
- `app/src/hooks/useSession.ts`
- `app/src/worker/sessions.ts`
- `app/src/state/grid.tsx`
- `app/src/utils/math.ts` (delete after migration)

**Description:**
Validation logic is scattered with 12+ inline `Math.max(min, Math.min(max, value))` patterns and 5 name sanitization duplications.

**Subtasks:**
- [ ] 003.1: Create `app/src/shared/validation.ts` with consolidated utilities
- [ ] 003.2: Export `clamp` from new module (remove from `utils/math.ts`)
- [ ] 003.3: Add `sanitizeSessionName(name, maxLength = 100)`
- [ ] 003.4: Add `sanitizeTrackName(name, maxLength = 32)` with HTML stripping
- [ ] 003.5: Add `isValidStepIndex(step)` combining `isValidNumber` + `Number.isInteger`
- [ ] 003.6: Add domain-specific clamps: `clampVelocity`, `clampVolume`, `clampPan`
- [ ] 003.7: Replace inline clamps in `track-bus.ts` (3 instances)
- [ ] 003.8: Replace inline clamps in `VelocityLane.tsx` (2 instances)
- [ ] 003.9: Replace inline clamps in `XYPad.tsx` (2 instances)
- [ ] 003.10: Replace name sanitization in `live-session.ts` (2 instances)
- [ ] 003.11: Replace name sanitization in `useSession.ts`, `sessions.ts`, `grid.tsx`
- [ ] 003.12: Delete `utils/math.ts` if only `clamp` remains
- [ ] 003.13: Add unit tests for all validation functions

**New Module API:**
```typescript
// app/src/shared/validation.ts
export { clamp } from './constants';

export function sanitizeSessionName(name: string | null | undefined, maxLength = 100): string | null;
export function sanitizeTrackName(name: string, maxLength = 32): string;
export function isValidStepIndex(step: unknown): step is number;
export function clampVelocity(v: number): number;
export function clampVolume(v: number): number;
export function clampPan(v: number): number;
```

**Acceptance Criteria:**
- No inline `Math.max(min, Math.min(max, value))` patterns remain
- All name sanitization uses shared utilities
- Step validation uses `isValidStepIndex` in `live-session.ts`

---

### Phase 2: High Priority (Affects maintainability)

#### TASK-004: Create State Mutation Helper
**Priority:** P1 - High
**Estimated Effort:** 2 hours
**Files to Modify:**
- `app/src/shared/state-mutations.ts`

**Description:**
21 instances of identical track mapping pattern in `state-mutations.ts`:
```typescript
const tracks = state.tracks.map((track) => {
  if (track.id !== message.trackId) return track;
  return { ...track, [field]: newValue };
});
return { ...state, tracks };
```

**Subtasks:**
- [ ] 004.1: Create `updateTrackById(state, trackId, updater)` helper
- [ ] 004.2: Create `updateTrackField(state, trackId, field, value)` helper
- [ ] 004.3: Refactor `toggle_step` mutation to use helper
- [ ] 004.4: Refactor `mute_track`, `solo_track` mutations
- [ ] 004.5: Refactor `set_parameter_lock` mutation
- [ ] 004.6: Refactor `clear_track` mutation
- [ ] 004.7: Refactor `set_track_sample`, `set_track_volume`, `set_track_transpose`
- [ ] 004.8: Refactor `set_track_step_count`, `set_track_swing`
- [ ] 004.9: Refactor `set_fm_params`
- [ ] 004.10: Refactor `copy_sequence`, `move_sequence`
- [ ] 004.11: Add unit tests for helpers

**New Helper API:**
```typescript
function updateTrackById<T extends { id: string }>(
  state: { tracks: T[] },
  trackId: string,
  updater: (track: T) => T
): { tracks: T[] } {
  return {
    ...state,
    tracks: state.tracks.map(track =>
      track.id === trackId ? updater(track) : track
    ),
  };
}
```

**Acceptance Criteria:**
- No raw `tracks.map(track => track.id !== ... ? track : {...})` patterns
- All track mutations use the helper functions
- Helper functions are unit tested

---

#### TASK-005: Create useDropdownMenu Hook
**Priority:** P1 - High
**Estimated Effort:** 2 hours
**Files to Create:**
- `app/src/hooks/useDropdownMenu.ts`

**Files to Modify:**
- `app/src/components/StepCountDropdown.tsx`
- `app/src/components/TransposeDropdown.tsx`

**Description:**
Both dropdown components have 4 identical useEffect hooks (~80 lines each) for:
- Click outside detection
- Escape key handling
- Scroll to selected item
- Menu positioning

**Subtasks:**
- [ ] 005.1: Create `useDropdownMenu` hook with all 4 behaviors
- [ ] 005.2: Add `useClickOutside` as internal utility or separate hook
- [ ] 005.3: Refactor `StepCountDropdown` to use hook
- [ ] 005.4: Refactor `TransposeDropdown` to use hook
- [ ] 005.5: Add unit tests for hook

**New Hook API:**
```typescript
function useDropdownMenu(): {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  menuPosition: { top: number; left: number };
  triggerRef: RefObject<HTMLButtonElement>;
  menuRef: RefObject<HTMLDivElement>;
  handleToggle: () => void;
};
```

**Acceptance Criteria:**
- Both dropdowns use the shared hook
- No duplicate useEffect hooks in dropdown components
- Hook handles all 4 behaviors (click outside, escape, scroll, position)

---

#### TASK-006: Create useSyncExternalState Hook
**Priority:** P1 - High
**Estimated Effort:** 1 hour
**Files to Create:**
- `app/src/hooks/useSyncExternalState.ts`

**Files to Modify:**
- `app/src/components/EffectsPanel.tsx`
- `app/src/components/Transport.tsx`

**Description:**
Both components have identical JSON.stringify-based state sync:
```typescript
useEffect(() => {
  if (initialState) {
    setEffects(prev => {
      if (JSON.stringify(prev) === JSON.stringify(initialState)) return prev;
      return initialState;
    });
  }
}, [initialState]);
```

**Subtasks:**
- [ ] 006.1: Create `useSyncExternalState` hook
- [ ] 006.2: Refactor `EffectsPanel.tsx` to use hook
- [ ] 006.3: Refactor `Transport.tsx` to use hook
- [ ] 006.4: Add unit tests for hook

**Acceptance Criteria:**
- Both components use the shared hook
- No duplicate JSON.stringify comparison patterns

---

#### TASK-007: Extract applyEffectToEngine Utility
**Priority:** P1 - High
**Estimated Effort:** 1 hour
**Files to Create:**
- `app/src/audio/effectsUtils.ts`

**Files to Modify:**
- `app/src/components/EffectsPanel.tsx`
- `app/src/components/Transport.tsx`

**Description:**
Identical 30-line `applyEffectToEngine` callback in both components.

**Subtasks:**
- [ ] 007.1: Create `effectsUtils.ts` with shared function
- [ ] 007.2: Refactor `EffectsPanel.tsx` to use utility
- [ ] 007.3: Refactor `Transport.tsx` to use utility
- [ ] 007.4: Add unit tests

**Acceptance Criteria:**
- Single implementation of effect application logic
- Both components import from shared utility

---

#### TASK-008: Create CSS Variables for Common Values
**Priority:** P1 - High
**Estimated Effort:** 2 hours
**Files to Modify:**
- `app/src/index.css` (add variables)
- All component CSS files

**Description:**
CSS has 109 duplicated patterns:
- `transition: all 0.15s ease` (36 instances)
- `-webkit-appearance: none` (28 instances)
- Height `36px` (~45 instances)
- Border-radius values (99 instances)

**Subtasks:**
- [ ] 008.1: Add CSS variables to `index.css`:
  ```css
  :root {
    --transition-default: all 0.15s ease;
    --button-height: 36px;
    --border-radius-sm: 4px;
    --border-radius-md: 6px;
    --border-radius-lg: 8px;
  }
  ```
- [ ] 008.2: Create slider reset mixin or utility class
- [ ] 008.3: Replace hardcoded transitions with variable
- [ ] 008.4: Replace hardcoded heights with variable
- [ ] 008.5: Replace border-radius values with variables

**Acceptance Criteria:**
- Common CSS values use variables
- New components use variables by default

---

### Phase 3: Medium Priority (Reduces complexity)

#### TASK-009: Create AudioChain Builder
**Priority:** P2 - Medium
**Estimated Effort:** 2 hours
**Files to Create:**
- `app/src/audio/AudioChain.ts`

**Files to Modify:**
- `app/src/audio/track-bus.ts`
- `app/src/audio/toneEffects.ts`
- `app/src/audio/synth.ts`
- `app/src/audio/advancedSynth.ts`

**Description:**
Manual `.connect()` chains repeated in 4 files:
```typescript
this.inputGain.connect(this.volumeGain);
this.volumeGain.connect(this.muteGain);
this.muteGain.connect(this.panNode);
this.panNode.connect(this.outputGain);
```

**Subtasks:**
- [ ] 009.1: Create `AudioChain` class with fluent API
- [ ] 009.2: Refactor `track-bus.ts` to use AudioChain
- [ ] 009.3: Refactor `toneEffects.ts` to use AudioChain
- [ ] 009.4: Add unit tests

**New Class API:**
```typescript
class AudioChain {
  add(node: AudioNode): this;
  build(): void;
  disconnect(): void;
}
```

**Acceptance Criteria:**
- Audio node chains use builder pattern
- Manual `.connect()` sequences eliminated

---

#### TASK-010: Create Envelope Utilities
**Priority:** P2 - Medium
**Estimated Effort:** 2 hours
**Files to Create:**
- `app/src/audio/envelope.ts`

**Files to Modify:**
- `app/src/audio/synth.ts`
- `app/src/audio/advancedSynth.ts`

**Description:**
ADSR envelope scheduling code duplicated in synth files.

**Subtasks:**
- [ ] 010.1: Create `envelope.ts` with scheduling utilities
- [ ] 010.2: Add `scheduleADSR(param, envelope, time, peak)` function
- [ ] 010.3: Add `applyEnvelopeParameters(node, params)` function
- [ ] 010.4: Refactor `synth.ts` to use utilities
- [ ] 010.5: Refactor `advancedSynth.ts` to use utilities
- [ ] 010.6: Add unit tests

**Acceptance Criteria:**
- Envelope scheduling uses shared utilities
- Manual envelope parameter setting eliminated

---

#### TASK-011: Extract MessageQueue Class
**Priority:** P2 - Medium
**Estimated Effort:** 2 hours
**Files to Create:**
- `app/src/sync/MessageQueue.ts`

**Files to Modify:**
- `app/src/sync/multiplayer.ts`

**Description:**
Message queue management (lines 1015-1125 in multiplayer.ts) should be a separate class.

**Subtasks:**
- [ ] 011.1: Extract `MessageQueue` class with priority support
- [ ] 011.2: Move `queueMessage`, `evictLowestPriority`, `replayQueuedMessages`
- [ ] 011.3: Update `multiplayer.ts` to use extracted class
- [ ] 011.4: Add unit tests for MessageQueue

**Acceptance Criteria:**
- MessageQueue is independently testable
- multiplayer.ts delegates to MessageQueue

---

#### TASK-012: Extract RecoveryManager Class
**Priority:** P2 - Medium
**Estimated Effort:** 1.5 hours
**Files to Create:**
- `app/src/sync/RecoveryManager.ts`

**Files to Modify:**
- `app/src/sync/multiplayer.ts`

**Description:**
Recovery state management (lines 842-882) should be a separate class.

**Subtasks:**
- [ ] 012.1: Extract `RecoveryManager` class
- [ ] 012.2: Move `requestSnapshotRecovery`, `completeRecovery`
- [ ] 012.3: Move `recoveryInProgress`, `lastRecoveryRequest`, `recoveryTimeout`
- [ ] 012.4: Update `multiplayer.ts` to use extracted class
- [ ] 012.5: Add unit tests

**Acceptance Criteria:**
- RecoveryManager is independently testable
- Recovery logic encapsulated in single class

---

### Phase 4: Low Priority (Polish)

#### TASK-013: Create Test Utilities Module
**Priority:** P3 - Low
**Estimated Effort:** 2 hours
**Files to Create:**
- `app/test/utils/setup.ts`
- `app/test/utils/websocket.ts`

**Description:**
8+ test files have duplicate beforeEach/afterEach patterns.

**Subtasks:**
- [ ] 013.1: Create `createTestContext()` utility
- [ ] 013.2: Create `createMockWebSocket()` utility
- [ ] 013.3: Create `cleanupTestConnections()` utility
- [ ] 013.4: Refactor staging tests to use utilities
- [ ] 013.5: Refactor integration tests to use utilities

**Acceptance Criteria:**
- Common test setup extracted to utilities
- New tests use shared utilities

---

#### TASK-014: Create Error Handler Utilities
**Priority:** P3 - Low
**Estimated Effort:** 1 hour
**Files to Create:**
- `app/src/utils/errorHandling.ts`

**Description:**
12 instances of similar `.catch()` patterns.

**Subtasks:**
- [ ] 014.1: Create `silentCatch()` utility for fire-and-forget
- [ ] 014.2: Create `logAndIgnore(category)` utility
- [ ] 014.3: Replace scattered `.catch(() => {})` patterns
- [ ] 014.4: Add documentation explaining when to use each

**Acceptance Criteria:**
- Consistent error handling patterns
- Clear documentation on which to use when

---

#### TASK-015: Universalize Array Initialization
**Priority:** P3 - Low
**Estimated Effort:** 1 hour
**Files to Modify:**
- `app/src/shared/state-mutations.ts`
- `app/src/utils/patternOps.ts`
- `app/src/utils/bug-patterns.ts`

**Description:**
`Array(MAX_STEPS).fill(false)` pattern exists in track-utils but isn't universally used.

**Subtasks:**
- [ ] 015.1: Export `createEmptySteps()` and `createEmptyLocks()` from track-utils
- [ ] 015.2: Replace direct Array() calls in state-mutations.ts
- [ ] 015.3: Replace direct Array() calls in patternOps.ts
- [ ] 015.4: Update bug-patterns.ts examples

**Acceptance Criteria:**
- All step/lock array creation uses utilities
- No direct `Array(MAX_STEPS).fill()` calls

---

## Bug Patterns to Add

The following patterns should be added to `app/src/utils/bug-patterns.ts`:

### BUG-PATTERN-001: Handler Factory Bypass

```typescript
{
  id: 'handler-factory-bypass',
  name: 'Handler Factory Bypass',
  category: 'consistency',
  severity: 'medium',
  description:
    'Creating message handlers manually instead of using createRemoteHandler factory. ' +
    'This leads to inconsistent echo prevention and dispatch patterns.',
  symptoms: [
    'Handler has manual "if (msg.playerId === this.state.playerId) return"',
    'Handler has manual "if (this.dispatch)" or "if (!this.dispatch) return"',
    'New handler doesn\'t match pattern of existing factory-based handlers',
    'Echo prevention works inconsistently for some message types',
  ],
  rootCause:
    'When adding new handlers, developers copy-paste existing handlers instead of ' +
    'using the factory. This duplicates boilerplate and makes patterns inconsistent. ' +
    'The factory exists (createRemoteHandler) but isn\'t universally adopted.',
  detection: {
    codePatterns: [
      'msg\\.playerId === this\\.state\\.playerId.*return',
      'handlePattern(?:Rotated|Inverted|Reversed|Mirrored).*=.*\\(msg',
      'private handle\\w+ = \\(msg:.*\\): void =>',
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'Use createRemoteHandler factory for all remote message handlers',
    steps: [
      '1. Import createRemoteHandler from handler-factory.ts',
      '2. Define handler as: private handleX = createRemoteHandler<MsgType>(...)',
      '3. Factory handles echo prevention and dispatch checking',
      '4. Only add custom logic in the action mapper function',
    ],
    codeExample: `
// BAD: Manual handler with duplicated boilerplate
private handlePatternRotated = (msg: {...}): void => {
  if (msg.playerId === this.state.playerId) return;  // Duplicated
  if (this.dispatch) {  // Duplicated
    this.dispatch({ type: 'SET_TRACK_STEPS', ... });
  }
};

// GOOD: Use factory - echo prevention is automatic
private handlePatternRotated = createRemoteHandler<PatternMsg>(
  (msg) => ({ type: 'SET_TRACK_STEPS', trackId: msg.trackId, steps: msg.steps, ... })
);
`,
  },
  prevention: [
    'When adding new handlers, ALWAYS use createRemoteHandler factory',
    'Add lint rule to detect manual echo prevention in handlers',
    'Code review checklist: "Does new handler use factory?"',
  ],
  relatedFiles: [
    'src/sync/multiplayer.ts',
    'src/sync/handler-factory.ts',
  ],
  dateDiscovered: '2026-01-09',
}
```

### BUG-PATTERN-002: Inline Validation Logic

```typescript
{
  id: 'inline-validation-logic',
  name: 'Inline Validation Logic',
  category: 'consistency',
  severity: 'medium',
  description:
    'Writing validation logic inline (Math.max/min for clamping, trim().slice() for ' +
    'sanitization) instead of using shared utilities. Leads to inconsistent limits ' +
    'and duplicated code.',
  symptoms: [
    'Math.max(0, Math.min(1, value)) appears in component code',
    'name.trim().slice(0, 100) appears in multiple files',
    'Different max lengths for same field (100 vs 32)',
    'Validation limits not matching between client and server',
  ],
  rootCause:
    'Validation utilities exist (clamp, sanitizeSessionName) but developers write ' +
    'inline validation because: (1) utilities not well-documented, (2) copy-paste ' +
    'from existing code, (3) utilities in unexpected locations.',
  detection: {
    codePatterns: [
      'Math\\.max\\(\\d+,\\s*Math\\.min\\(\\d+,',
      '\\.trim\\(\\)\\.slice\\(0,\\s*\\d+\\)',
      'Number\\.isFinite.*\\?.*:.*0',
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'Use shared validation utilities from shared/validation.ts',
    steps: [
      '1. Import from src/shared/validation.ts',
      '2. Use clamp(value, min, max) instead of Math.max/min chain',
      '3. Use sanitizeSessionName() for session names',
      '4. Use sanitizeTrackName() for track names',
      '5. Use domain-specific clamps (clampVelocity, clampVolume, clampPan)',
    ],
    codeExample: `
// BAD: Inline clamping with magic numbers
const clampedValue = Math.max(0, Math.min(1, value));
const sanitizedName = name.trim().slice(0, 100);

// GOOD: Use shared utilities
import { clamp, clampVolume, sanitizeSessionName } from '../shared/validation';
const clampedValue = clampVolume(value);
const sanitizedName = sanitizeSessionName(name);
`,
  },
  prevention: [
    'Document validation utilities in CONTRIBUTING.md',
    'Add lint rule to detect Math.max(Math.min()) pattern',
    'Code review checklist: "Are validation limits from shared utilities?"',
    'Run: grep -rn "Math.max.*Math.min" src/ --include="*.ts" --include="*.tsx"',
  ],
  relatedFiles: [
    'src/shared/validation.ts',
    'src/shared/constants.ts',
  ],
  dateDiscovered: '2026-01-09',
}
```

### BUG-PATTERN-003: Test Type Definition Drift

```typescript
{
  id: 'test-type-drift',
  name: 'Test Type Definition Drift',
  category: 'consistency',
  severity: 'high',
  description:
    'Test files define their own type interfaces instead of importing from shared ' +
    'modules. These local definitions drift from canonical types over time, causing ' +
    'tests to pass with invalid data structures.',
  symptoms: [
    'Test passes locally but feature broken in production',
    'Test uses field that doesn\'t exist in canonical type',
    'Test missing required field that was recently added',
    '"interface SessionTrack" defined in test file',
    'FMParams test definition has different fields than real type',
  ],
  rootCause:
    'When shared types were consolidated to src/shared/, test files were not updated ' +
    'to import from the new location. Developers copy-pasted type definitions from ' +
    'existing tests, perpetuating stale versions.',
  detection: {
    codePatterns: [
      'interface SessionTrack.*\\{',
      'interface FMParams.*\\{',
      'interface ParameterLock.*\\{',
      'interface SessionState.*\\{',
      'interface PlayerInfo.*\\{',
      'interface EffectsState.*\\{',
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'Import types from shared modules, never define locally in tests',
    steps: [
      '1. Create test/types.ts that re-exports from src/shared/',
      '2. Update all test files to import from test/types.ts',
      '3. Delete all local interface definitions in test files',
      '4. Add lint rule to prevent interface definitions in test/',
    ],
    codeExample: `
// BAD: Local type definition in test file
interface FMParams {
  modulatorRatio: number;  // WRONG! Not in canonical type
  attack: number;          // WRONG! Not in canonical type
}

// GOOD: Import from shared
import type { FMParams } from '../types';
// Uses canonical definition: { harmonicity, modulationIndex }
`,
  },
  prevention: [
    'Create test/types.ts as single import point for tests',
    'Add ESLint rule: no-local-types-in-tests',
    'Add CI check: grep for "interface.*{" in test/ directory',
    'Document in CONTRIBUTING.md: "Never define types in test files"',
  ],
  relatedFiles: [
    'test/types.ts',
    'src/shared/state.ts',
    'src/shared/sync-types.ts',
    'src/shared/player.ts',
  ],
  dateDiscovered: '2026-01-09',
}
```

### BUG-PATTERN-004: Duplicate React Effect Pattern

```typescript
{
  id: 'duplicate-react-effect',
  name: 'Duplicate React Effect Pattern',
  category: 'consistency',
  severity: 'medium',
  description:
    'Common useEffect patterns (click outside, escape key, timer cleanup) are ' +
    'duplicated across components instead of extracted to custom hooks.',
  symptoms: [
    'Multiple components with identical useEffect for click outside detection',
    'Multiple components with identical useEffect for escape key handling',
    'Same 20+ line useEffect in different files',
    'Bugs fixed in one component not fixed in duplicates',
  ],
  rootCause:
    'When building new components, developers copy useEffect patterns from existing ' +
    'components instead of creating shared hooks. Custom hooks exist (useStableCallback) ' +
    'but not for all common patterns.',
  detection: {
    codePatterns: [
      'document\\.addEventListener\\([\'"]mousedown[\'"].*handleClickOutside',
      'document\\.addEventListener\\([\'"]keydown[\'"].*Escape',
      'useEffect.*JSON\\.stringify.*prev.*===.*JSON\\.stringify',
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'Extract common effect patterns to custom hooks',
    steps: [
      '1. Identify duplicated effect pattern',
      '2. Create custom hook in src/hooks/',
      '3. Refactor all components to use the hook',
      '4. Add hook to documentation',
    ],
    codeExample: `
// BAD: Effect duplicated in multiple components
useEffect(() => {
  if (!isOpen) return;
  const handleClickOutside = (e: MouseEvent) => {
    if (!ref.current?.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [isOpen]);

// GOOD: Extract to custom hook
import { useClickOutside } from '../hooks/useClickOutside';
useClickOutside(ref, () => setIsOpen(false), isOpen);
`,
  },
  prevention: [
    'Before writing useEffect, check if hook exists in src/hooks/',
    'If pattern appears in 2+ components, extract to hook',
    'Document available hooks in src/hooks/README.md',
    'Code review: "Can this effect be replaced with existing hook?"',
  ],
  relatedFiles: [
    'src/hooks/useDropdownMenu.ts',
    'src/hooks/useSyncExternalState.ts',
    'src/hooks/useStableCallback.ts',
  ],
  dateDiscovered: '2026-01-09',
}
```

### BUG-PATTERN-005: CSS Magic Number Duplication

```typescript
{
  id: 'css-magic-number',
  name: 'CSS Magic Number Duplication',
  category: 'consistency',
  severity: 'low',
  description:
    'Hardcoded CSS values (heights, transitions, border-radii) repeated across ' +
    'component stylesheets instead of using CSS variables.',
  symptoms: [
    'Changing button height requires editing 15+ files',
    'Transition timing inconsistent across components',
    'Border radius values slightly different (4px vs 6px) unintentionally',
    'Same height/width value in many selectors',
  ],
  rootCause:
    'CSS variables exist in index.css but not for all common values. Developers ' +
    'copy values from existing stylesheets, propagating magic numbers.',
  detection: {
    codePatterns: [
      'height:\\s*36px',
      'transition:\\s*all\\s*0\\.15s',
      'border-radius:\\s*[4-8]px',
      '-webkit-appearance:\\s*none',
    ],
    logPatterns: [],
  },
  fix: {
    summary: 'Use CSS variables for common values',
    steps: [
      '1. Add variable to :root in index.css',
      '2. Replace hardcoded values with var(--name)',
      '3. Document variable in CSS section of CONTRIBUTING.md',
    ],
    codeExample: `
/* BAD: Hardcoded magic numbers */
.button { height: 36px; transition: all 0.15s ease; }
.input { height: 36px; transition: all 0.15s ease; }

/* GOOD: CSS variables */
:root {
  --button-height: 36px;
  --transition-default: all 0.15s ease;
}
.button { height: var(--button-height); transition: var(--transition-default); }
.input { height: var(--button-height); transition: var(--transition-default); }
`,
  },
  prevention: [
    'Define CSS variables for common values in index.css',
    'Before hardcoding value, check if variable exists',
    'If value used 3+ times, create variable',
  ],
  relatedFiles: [
    'src/index.css',
  ],
  dateDiscovered: '2026-01-09',
}
```

---

## Verification Audits

The following audits should be run by sub-agents after remediation to verify fixes:

### AUDIT-001: Test Type Imports
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After TASK-001 completion

**Audit Prompt:**
```
Search ALL files in app/test/ for local type definitions. Report any file that contains:
1. "interface SessionTrack"
2. "interface FMParams"
3. "interface ParameterLock"
4. "interface SessionState"
5. "interface PlayerInfo"
6. "interface EffectsState"
7. "type SessionTrack ="
8. "type FMParams ="

For each violation found, report:
- File path and line number
- The offending type definition
- Whether it differs from canonical definition in src/shared/

Expected result: ZERO violations. All test files should import from test/types.ts or src/shared/.
```

### AUDIT-002: Handler Factory Adoption
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After TASK-002 completion

**Audit Prompt:**
```
Search app/src/sync/multiplayer.ts for message handlers that don't use createRemoteHandler.

Look for patterns:
1. "private handle* = (msg:" that DON'T use createRemoteHandler
2. Manual echo prevention: "msg.playerId === this.state.playerId"
3. Manual dispatch checks: "if (this.dispatch)" or "if (!this.dispatch)"

Exceptions (allowed manual handlers):
- handleSnapshot (complex logic)
- handleStepToggled (needs recordSupersession)
- handlePlaybackStarted/Stopped (callback invocation)
- handlePlayerJoined/Left (player list management)
- handleMessage (main router)

For each non-exempt manual handler, report:
- Handler name
- Line number
- Why it should use factory (or why it's legitimately exempt)

Expected result: All pattern handlers use factory. Only exempt handlers are manual.
```

### AUDIT-003: Inline Validation Patterns
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After TASK-003 completion

**Audit Prompt:**
```
Search ALL .ts and .tsx files in app/src/ for inline validation patterns.

Patterns to find:
1. Math.max followed by Math.min (clamping): "Math.max.*Math.min" or "Math.min.*Math.max"
2. Inline name sanitization: ".trim().slice(0,"
3. Manual number validation: "Number.isFinite" followed by ternary

For each instance found, report:
- File path and line number
- The inline pattern
- Which shared utility should replace it

Exceptions (allowed inline):
- Inside shared/validation.ts itself
- Inside test files with explicit test data
- Comments or documentation

Expected result: ZERO inline validation in component/service code. All use shared utilities.
```

### AUDIT-004: State Mutation Pattern Usage
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After TASK-004 completion

**Audit Prompt:**
```
Search app/src/shared/state-mutations.ts for the raw track mapping pattern.

Pattern to find:
"state.tracks.map((track) =>" or "state.tracks.map(track =>"

For each instance, check if it follows this pattern:
```typescript
if (track.id !== X) return track;
return { ...track, field: value };
```

Report:
- Line number
- Which mutation function contains it
- Whether it should use updateTrackById helper

Expected result: All track mutations use updateTrackById or updateTrackField helpers.
No raw map-with-id-check patterns remain.
```

### AUDIT-005: Duplicate useEffect Patterns
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After TASK-005 and TASK-006 completion

**Audit Prompt:**
```
Search app/src/components/*.tsx for duplicate useEffect patterns.

Patterns to find:
1. Click outside detection: "document.addEventListener('mousedown'" with "handleClickOutside"
2. Escape key handling: "addEventListener('keydown'" with "Escape"
3. JSON stringify comparison: "JSON.stringify(prev) === JSON.stringify"
4. Scroll to element: "scrollIntoView" inside useEffect

For each pattern found, report:
- File path and line number
- Which hook should replace it (useDropdownMenu, useSyncExternalState, etc.)
- Full useEffect code for comparison

Expected result: These patterns only appear in:
1. The hook definition files themselves
2. Components with legitimately unique requirements (documented)

No copy-paste duplicates should remain.
```

### AUDIT-006: CSS Variable Usage
**Agent Type:** Explore
**Thoroughness:** Medium
**Trigger:** After TASK-008 completion

**Audit Prompt:**
```
Search all .css files in app/src/ for hardcoded values that should use CSS variables.

Values to find:
1. "height: 36px" (should be var(--button-height))
2. "transition: all 0.15s" (should be var(--transition-default))
3. "border-radius: 4px" or "6px" or "8px" (should be var(--border-radius-*))

For each instance, report:
- File path and line number
- The hardcoded value
- Which CSS variable should replace it

Expected result:
- Common values use CSS variables
- Only unique, one-off values are hardcoded
- New components default to using variables
```

### AUDIT-007: Audio Chain Patterns
**Agent Type:** Explore
**Thoroughness:** Medium
**Trigger:** After TASK-009 completion

**Audit Prompt:**
```
Search app/src/audio/*.ts for manual audio node connection chains.

Pattern to find:
Multiple consecutive ".connect(" calls:
```typescript
x.connect(a);
a.connect(b);
b.connect(c);
```

For each chain of 3+ manual connects, report:
- File path and line numbers
- The nodes being connected
- Whether AudioChain builder should be used

Expected result:
- Audio chains of 3+ nodes use AudioChain builder
- Only 1-2 node connections are manual
```

### AUDIT-008: Full Duplication Scan
**Agent Type:** Explore
**Thoroughness:** Very Thorough
**Trigger:** After all tasks complete

**Audit Prompt:**
```
Perform a comprehensive scan for ANY remaining duplication across the codebase.

Search for:
1. Any function body that appears identically in 2+ files
2. Any useEffect hook body that appears in 2+ components
3. Any CSS rule block that appears identically in 2+ files
4. Any type definition that appears in 2+ files
5. Any error handling pattern (.catch) that appears 3+ times

For each duplication found, report:
- Category (function, hook, CSS, type, error handling)
- All file locations with line numbers
- Similarity percentage
- Suggested abstraction

Expected result:
- No HIGH severity duplications remain
- All duplications are either:
  a) Documented as intentional
  b) Logged as future cleanup tasks
```

---

## Implementation Guidelines

### How to Use This Document

1. **Sprint Planning:** Pick tasks from Phase 1 first, then Phase 2
2. **PR Reviews:** Reference relevant bug patterns when reviewing
3. **New Development:** Check bug patterns before adding new handlers/validation
4. **Verification:** Run audits after completing related tasks

### Definition of Done for Each Task

- [ ] Code changes complete
- [ ] Unit tests added/updated
- [ ] No lint errors
- [ ] Related audit passes
- [ ] Documentation updated if needed
- [ ] PR approved by at least one reviewer

### Commit Message Format

```
fix(category): TASK-XXX description

- Subtask completed
- Files modified
- Tests added

Refs: DUPLICATION-REMEDIATION-PLAN.md
```

### Adding New Bug Patterns

When adding patterns to `bug-patterns.ts`:

1. Use existing pattern as template
2. Include all fields (id, name, category, severity, etc.)
3. Add at least one codePattern for detection
4. Include concrete codeExample
5. Add to appropriate section (consistency, state-management, etc.)
6. Add dateDiscovered field

---

## Appendix: Quick Reference

### Files Created by This Plan

| File | Created By | Purpose |
|------|-----------|---------|
| `test/types.ts` | TASK-001 | Re-export shared types for tests |
| `shared/validation.ts` | TASK-003 | Consolidated validation utilities |
| `hooks/useDropdownMenu.ts` | TASK-005 | Dropdown behavior hook |
| `hooks/useSyncExternalState.ts` | TASK-006 | External state sync hook |
| `audio/effectsUtils.ts` | TASK-007 | Effect application utility |
| `audio/AudioChain.ts` | TASK-009 | Audio node chain builder |
| `audio/envelope.ts` | TASK-010 | Envelope scheduling utilities |
| `sync/MessageQueue.ts` | TASK-011 | Extracted message queue |
| `sync/RecoveryManager.ts` | TASK-012 | Extracted recovery logic |
| `test/utils/setup.ts` | TASK-013 | Test setup utilities |
| `utils/errorHandling.ts` | TASK-014 | Error handling utilities |

### Utility Import Cheatsheet

```typescript
// Validation
import { clamp, clampVolume, clampVelocity, clampPan } from '../shared/validation';
import { sanitizeSessionName, sanitizeTrackName } from '../shared/validation';
import { isValidStepIndex } from '../shared/validation';

// State Mutations
import { updateTrackById, updateTrackField } from '../shared/state-mutations';

// Hooks
import { useDropdownMenu } from '../hooks/useDropdownMenu';
import { useSyncExternalState } from '../hooks/useSyncExternalState';
import { useStableCallback } from '../hooks/useStableCallback';

// Audio
import { AudioChain } from '../audio/AudioChain';
import { scheduleADSR, applyEnvelopeParameters } from '../audio/envelope';
import { applyEffectToEngine } from '../audio/effectsUtils';

// Handler Factory
import { createRemoteHandler } from '../sync/handler-factory';
```
