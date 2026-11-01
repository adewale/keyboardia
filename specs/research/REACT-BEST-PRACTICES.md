# React Best Practices for Keyboardia

A comprehensive guide to React best practices for building a real-time collaborative music sequencer.

**Last Updated:** 2025-12-10

## Table of Contents

1. [State Management](#1-state-management)
2. [Performance Optimization](#2-performance-optimization)
3. [Concurrent Features](#3-concurrent-features)
4. [Error Boundaries](#4-error-boundaries)
5. [WebSocket Integration](#5-websocket-integration)
6. [Audio in React](#6-audio-in-react)
7. [Testing](#7-testing)

---

## 1. State Management

### Best Practice: Use Context for Low-Frequency Updates, External State for High-Frequency Updates

**Why it Matters for Keyboardia:**

Keyboardia has two distinct types of state:
- **Low-frequency state**: User preferences, authentication, multiplayer connection status, UI theme
- **High-frequency state**: Step data across 16 tracks × 64 steps, parameter locks, playhead position, real-time cursor positions

Performance benchmarks (2025) show dramatic differences:

| Approach | Render Time | Re-renders | Bundle Size |
|----------|-------------|------------|-------------|
| Context | 245ms | 2,000+ | 0 KB |
| Zustand | 18ms | 100 | 2.5 KB |
| Jotai | 12ms | 100 | 3.1 KB |

**When Context Re-renders Become a Problem:**

When any value in Context changes, every component consuming that Context re-renders. This is catastrophic for a sequencer where step data updates frequently. With 1,024 cells (16 × 64), a single step update could trigger 1,000+ unnecessary re-renders.

**Recommended Pattern:**

```javascript
// GOOD: Use Context for connection state (changes infrequently)
const MultiplayerContext = React.createContext();

// GOOD: Use Zustand for sequencer data (changes frequently)
import create from 'zustand';

const useSequencerStore = create((set) => ({
  tracks: Array(16).fill(null).map(() => ({
    steps: Array(64).fill(false),
    paramLocks: {},
  })),

  // Granular updates - only affected components re-render
  toggleStep: (trackIndex, stepIndex) =>
    set((state) => ({
      tracks: state.tracks.map((track, i) =>
        i === trackIndex
          ? {
              ...track,
              steps: track.steps.map((step, j) =>
                j === stepIndex ? !step : step
              ),
            }
          : track
      ),
    })),

  // Optimized selector pattern
  setParameterLock: (trackIndex, stepIndex, param, value) =>
    set((state) => {
      const newTracks = [...state.tracks];
      const track = { ...newTracks[trackIndex] };
      track.paramLocks = {
        ...track.paramLocks,
        [`${stepIndex}-${param}`]: value,
      };
      newTracks[trackIndex] = track;
      return { tracks: newTracks };
    }),
}));

// Component only re-renders when its specific track changes
function Track({ index }) {
  const track = useSequencerStore((state) => state.tracks[index]);
  const toggleStep = useSequencerStore((state) => state.toggleStep);

  return (
    <div>
      {track.steps.map((active, stepIndex) => (
        <StepButton
          key={stepIndex}
          active={active}
          onClick={() => toggleStep(index, stepIndex)}
        />
      ))}
    </div>
  );
}
```

**Zustand vs Jotai Decision:**

- **Use Zustand** if you prefer a single store with slices (similar to Redux patterns)
- **Use Jotai** if you want atomic state that can be composed (better for parameter locks that are independent)

For Keyboardia, Zustand is recommended because:
- Sequencer state has clear hierarchies (tracks → steps → params)
- Simple API with minimal boilerplate
- Works well with WebSocket updates (easy to replace entire state)
- Better TypeScript inference

**Combining Context + Zustand:**

```javascript
// Keep your existing MultiplayerContext for WebSocket state
// Add Zustand for sequencer data
// Keep RemoteChangeContext for flash animations

// This hybrid approach is explicitly recommended in 2025 best practices
```

**Key Principle:**

"Start with the simplest approach that could work (Context API), then graduate to Zustand when you need more performance or structure." - If you find yourself stacking more than 5 context providers, consider switching to Zustand.

**Sources:**
- [State Management in 2025: When to Use Context, Redux, Zustand, or Jotai](https://dev.to/hijazi313/state-management-in-2025-when-to-use-context-redux-zustand-or-jotai-2d2k)
- [React State Management in 2025: What You Actually Need](https://www.developerway.com/posts/react-state-management-2025)
- [State Management Trends in React 2025](https://makersden.io/blog/react-state-management-in-2025)

---

## 2. Performance Optimization

### Best Practice: Profile First, Then Optimize Strategically

**Why it Matters for Keyboardia:**

Keyboardia renders 1,024+ interactive cells (16 tracks × 64 steps), receives WebSocket updates from multiple users, and must maintain audio timing precision. Unnecessary re-renders directly impact perceived latency.

**The Three Memoization Tools:**

1. **React.memo**: Prevents component re-renders when props haven't changed
2. **useMemo**: Caches computed values
3. **useCallback**: Caches function references

**Critical Rule: Don't Optimize Without Profiling**

> "The cost of using useCallback and useMemo improperly can outweigh their benefits." - Kent C. Dodds

Memoization has costs:
- Memory overhead for cached values
- Comparison overhead on every render
- Code complexity

**When to Use Each Tool:**

### React.memo

```javascript
// GOOD: Step button receives simple props, re-renders frequently
const StepButton = React.memo(({
  active,
  hasParamLock,
  isRemoteEdit,
  onClick
}) => {
  return (
    <button
      className={`step ${active ? 'active' : ''} ${isRemoteEdit ? 'flash' : ''}`}
      onClick={onClick}
    >
      {hasParamLock && <LockIcon />}
    </button>
  );
});

// BAD: Over-memoizing a simple component
const PlayButton = React.memo(({ onClick }) => (
  <button onClick={onClick}>Play</button>
));
// This adds overhead without benefit - component is too simple
```

**Key insight:** React.memo is most valuable for:
- Components that render many instances (like StepButton × 1,024)
- Components with expensive render logic
- Components that receive the same props frequently

### useMemo

```javascript
// GOOD: Expensive calculation that rarely changes
function TrackView({ track, filters }) {
  const visibleSteps = useMemo(() => {
    // Filtering 64 steps with complex logic
    return track.steps.filter(step =>
      filters.every(filter => filter.test(step))
    );
  }, [track.steps, filters]);

  return <div>{visibleSteps.map(renderStep)}</div>;
}

// BAD: Memoizing a cheap calculation
function Tempo({ bpm }) {
  const msPerBeat = useMemo(() => 60000 / bpm, [bpm]);
  // Division is fast - memoization overhead exceeds benefit
  return <div>{msPerBeat}ms</div>;
}

// GOOD: Memoizing to maintain reference equality
function ParameterLockEditor({ paramLocks }) {
  // Without useMemo, this creates a new array every render
  // causing child components to re-render unnecessarily
  const sortedParams = useMemo(() =>
    Object.keys(paramLocks).sort(),
    [paramLocks]
  );

  return <ParamList params={sortedParams} />; // ParamList is React.memo'd
}
```

**Use useMemo when:**
- The calculation is noticeably slow (profile to confirm)
- Dependencies rarely change
- You're passing the value to a memoized component
- You want to maintain reference equality for dependency arrays

### useCallback

```javascript
// GOOD: Function passed to memoized child components
function Track({ index }) {
  const toggleStep = useSequencerStore((state) => state.toggleStep);

  // Without useCallback, creates new function every render
  // causing all StepButtons to re-render even with React.memo
  const handleStepClick = useCallback((stepIndex) => {
    toggleStep(index, stepIndex);
  }, [index, toggleStep]);

  return (
    <div>
      {steps.map((_, stepIndex) => (
        <StepButton
          key={stepIndex}
          onClick={() => handleStepClick(stepIndex)}
        />
      ))}
    </div>
  );
}

// BETTER: Create stable references at the step level
function Track({ index }) {
  const toggleStep = useSequencerStore((state) => state.toggleStep);

  return (
    <div>
      {steps.map((_, stepIndex) => (
        <Step
          key={stepIndex}
          trackIndex={index}
          stepIndex={stepIndex}
          onToggle={toggleStep} // Pass stable function from store
        />
      ))}
    </div>
  );
}

const Step = React.memo(({ trackIndex, stepIndex, onToggle }) => {
  const handleClick = useCallback(() => {
    onToggle(trackIndex, stepIndex);
  }, [trackIndex, stepIndex, onToggle]);

  return <button onClick={handleClick}>Step</button>;
});
```

**Use useCallback when:**
- Passing functions to memoized child components
- Functions are used in dependency arrays of other hooks
- Creating event handlers for many instances (like 1,024 steps)

**Anti-Pattern to Avoid:**

```javascript
// BAD: Memoizing everything "just in case"
function Track({ index }) {
  const data = useMemo(() => someData, [someData]); // Unnecessary
  const value = useMemo(() => index * 2, [index]); // Multiplication is cheap
  const handleClick = useCallback(() => {}, []); // Not passed to memoized component

  // This adds overhead without measurable benefit
}
```

**Keyboardia-Specific Optimization Strategy:**

1. **Profile with React DevTools Profiler** during:
   - Rapid step editing (clicking many steps quickly)
   - Receiving WebSocket updates from remote users
   - Playhead moving across steps
   - Parameter lock editing

2. **Optimize hot paths identified by profiling:**
   - StepButton (1,024 instances) - React.memo
   - Track list rendering - useMemo for filtering/sorting
   - WebSocket message handlers - useCallback

3. **Targeted memoization yields 45% performance improvement:**
   > "Targeted use of useMemo on filtering logic can help reduce computation time by 45% on each update in dashboards with heavy data operations."

**React 19 Update (Future Consideration):**

React 19 introduces automatic memoization via the React Compiler. This eliminates manual memoization in most cases. However, you still need manual optimization for:
- Extremely expensive calculations the compiler doesn't catch
- Passing functions to React.memo components that depend on strict reference equality

**Performance Checklist for Keyboardia:**

- [ ] Profile before optimizing
- [ ] React.memo for StepButton and frequently re-rendered components
- [ ] useMemo for filtering/sorting track lists
- [ ] useCallback for event handlers passed to memoized components
- [ ] Avoid memoizing simple calculations (< 1ms)
- [ ] Check that dependency arrays are correct (use eslint-plugin-react-hooks)
- [ ] Re-profile after optimization to confirm improvement

**Sources:**
- [React Performance Optimization: Best Techniques for 2025](https://www.growin.com/blog/react-performance-optimization-2025/)
- [Mastering useMemo and useCallback in React](https://mukeshdani.medium.com/mastering-usememo-and-usecallback-in-react-ab25ecd3f90b)
- [Understanding when to use useMemo](https://maxrozen.com/understanding-when-use-usememo)
- [React memo documentation](https://react.dev/reference/react/memo)

---

## 3. Concurrent Features

### Best Practice: Use useTransition for User-Triggered Updates, useDeferredValue for Derived Values

**Why it Matters for Keyboardia:**

Keyboardia must balance multiple priorities:
- **Urgent**: User clicking steps, playback controls, audio scheduling
- **Less urgent**: Rendering multiplayer cursors, updating pattern visualizations, applying filters

Without concurrent features, heavy rendering (like updating all 1,024 cells after a WebSocket message) blocks urgent updates (like the user clicking Play).

React 18's concurrent features solve this by letting you mark some updates as lower priority.

### Understanding useTransition

**What it does:** Marks state updates as non-urgent, allowing React to interrupt them for higher-priority updates.

**Returns:**
- `isPending`: Boolean indicating if transition is in progress
- `startTransition`: Function to wrap low-priority updates

```javascript
const [isPending, startTransition] = useTransition();

// Urgent update happens immediately
setSearchQuery(input);

// Non-urgent update can be interrupted
startTransition(() => {
  setFilteredResults(filterSteps(input));
});
```

**Perfect for Keyboardia - Pattern Search:**

```javascript
function PatternSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPatterns, setFilteredPatterns] = useState([]);
  const [isPending, startTransition] = useTransition();
  const allPatterns = useSequencerStore((state) => state.patterns);

  const handleSearch = (input) => {
    // Urgent: Update search input immediately
    // User must see their typing without lag
    setSearchQuery(input);

    // Non-urgent: Filter patterns (expensive with many patterns)
    // Can be interrupted if user keeps typing
    startTransition(() => {
      const filtered = allPatterns.filter(pattern =>
        pattern.name.toLowerCase().includes(input.toLowerCase())
      );
      setFilteredPatterns(filtered);
    });
  };

  return (
    <div>
      <input
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search patterns..."
      />
      {isPending && <LoadingSpinner />}
      <PatternList patterns={filteredPatterns} />
    </div>
  );
}
```

**Before useTransition (old approach with debouncing):**

```javascript
// Required lodash or custom setTimeout logic
const debouncedFilter = useMemo(
  () => debounce((query) => setFilteredPatterns(filter(query)), 300),
  []
);

// More code, external dependency, harder to reason about
```

**After useTransition (2025 approach):**

```javascript
// Built-in, simpler, more React-idiomatic
startTransition(() => setFilteredPatterns(filter(query)));
```

### Understanding useDeferredValue

**What it does:** Creates a "lagged" version of a value that updates after higher-priority work.

**Use when:** You don't control the state update code (e.g., value comes from props or external library).

```javascript
function TrackVisualization({ steps, tempo }) {
  // Defer the expensive visualization update
  // steps updates immediately in parent
  // but visualization lags behind during rapid changes
  const deferredSteps = useDeferredValue(steps);

  // Expensive WebGL or Canvas rendering
  const visualization = useMemo(() =>
    renderComplexVisualization(deferredSteps, tempo),
    [deferredSteps, tempo]
  );

  return (
    <div>
      <canvas ref={visualization} />
    </div>
  );
}
```

**Keyboardia Use Case - Multiplayer Cursors:**

```javascript
function MultiplayerCursors({ remoteCursors }) {
  // Remote cursors update rapidly (50-80ms from WebSocket)
  // Defer rendering to prevent blocking urgent updates
  const deferredCursors = useDeferredValue(remoteCursors);

  return (
    <div className="cursor-layer">
      {deferredCursors.map(cursor => (
        <Cursor
          key={cursor.userId}
          x={cursor.x}
          y={cursor.y}
          color={cursor.color}
          userName={cursor.userName}
        />
      ))}
    </div>
  );
}
```

### When to Use Which

| Scenario | Tool | Reason |
|----------|------|--------|
| User typing in search | useTransition | You control the setState call |
| Filter results from search | useTransition | You trigger the update |
| Expensive prop-based rendering | useDeferredValue | Parent controls the value |
| WebSocket data visualization | useDeferredValue | Data comes from external source |
| Pattern browser filtering | useTransition | You control filtering logic |
| Real-time cursor positions | useDeferredValue | Values from WebSocket context |

**Key Insight:**

> "useTransition gives you full control since you decide which code should be wrapped and treated as 'low priority'. If you don't have access to the actual state updating code (e.g., because it's performed by some third-party library), use useDeferredValue."

### Performance Impact

**Important Caveat - Double Re-renders:**

Both hooks cause components to render twice:
1. First render with old value (immediate)
2. Second render with new value (deferred)

This is intentional but means:
- Don't use for every state update
- Only use when profiling confirms a problem
- Memory/CPU cost of two renders must be less than cost of blocking

**Benchmark Results:**

In user input scenarios (typing, searching):
- **Before**: 300ms lag when typing in pattern search with 1,000+ patterns
- **After useTransition**: 0ms input lag, filtering happens in background
- **Trade-off**: Results appear 50-100ms later, but UX feels more responsive

### Best Practices for Keyboardia

**DO Use Concurrent Features:**

1. **Pattern/sample browser search** - Mark filtering as transition
2. **Parameter lock bulk edits** - Transition for applying changes to many steps
3. **Multiplayer cursor rendering** - Defer cursor updates
4. **Visualization updates** - Defer complex canvas/WebGL rendering
5. **Theme changes** - Transition for re-rendering entire UI

**DON'T Use Concurrent Features:**

1. **Audio scheduling** - Must be immediate and precise
2. **Playback controls** - Play/stop must be instant
3. **Step toggling** - Direct user interaction, must be immediate
4. **WebSocket connection state** - Critical for app functionality
5. **Error boundaries** - Need immediate error handling

**Pattern for WebSocket Updates:**

```javascript
function SequencerSync() {
  const { lastMessage } = useWebSocket(WS_URL);
  const updateSequencer = useSequencerStore((state) => state.update);

  useEffect(() => {
    if (!lastMessage) return;

    const update = JSON.parse(lastMessage.data);

    // Critical updates: immediate (affects audio)
    if (update.type === 'tempo' || update.type === 'playback') {
      updateSequencer(update);
      return;
    }

    // Visual updates: can be deferred (doesn't affect audio)
    if (update.type === 'step' || update.type === 'paramLock') {
      startTransition(() => {
        updateSequencer(update);
      });
    }
  }, [lastMessage]);
}
```

### Try Other Optimizations First

> "You should not start wrapping all your state updates with useTransition(). Those hooks should be used if you have a complex user interface or component that can't be optimized with other means."

**Optimization Hierarchy:**

1. **First:** Lazy loading, code splitting
2. **Second:** React.memo, useMemo, useCallback
3. **Third:** Pagination or virtualization (react-window)
4. **Fourth:** Web Workers for heavy computation
5. **Last:** useTransition/useDeferredValue

**Sources:**
- [React 18 Concurrent Rendering: Performance Optimization Guide](https://www.curiosum.com/blog/performance-optimization-with-react-18-concurrent-rendering)
- [UseTransition() Vs UseDeferredValue() In React 18](https://blog.openreplay.com/usetransition-vs-usedeferredvalue-in-react-18/)
- [React Performance Optimization: Best Practices for 2025](https://dev.to/frontendtoolstech/react-performance-optimization-best-practices-for-2025-2g6b)
- [React useTransition: performance game changer or...?](https://www.developerway.com/posts/use-transition)

---

## 4. Error Boundaries

### Best Practice: Layer Error Boundaries with Recovery Strategies

**Why it Matters for Keyboardia:**

In a real-time collaborative app:
- WebSocket disconnections can break features temporarily
- Audio context can enter invalid states
- Remote users might send malformed data
- Browser audio permissions can be denied

Error boundaries prevent one user's error from crashing the entire session for everyone.

### Understanding Error Boundaries

**What they catch:**
- Errors during rendering
- Errors in lifecycle methods
- Errors in constructors
- Errors in child components

**What they DON'T catch:**
- Event handler errors (use try/catch)
- Async errors (use error states)
- Server-side rendering errors
- Errors in the boundary itself

### Three-Layer Strategy

```javascript
// Layer 1: Top-level boundary (catches everything)
function App() {
  return (
    <TopLevelErrorBoundary>
      <KeyboardiaApp />
    </TopLevelErrorBoundary>
  );
}

// Layer 2: Feature-level boundaries (isolate features)
function KeyboardiaApp() {
  return (
    <div>
      <ErrorBoundary name="Sequencer">
        <Sequencer />
      </ErrorBoundary>

      <ErrorBoundary name="Multiplayer">
        <MultiplayerCursors />
      </ErrorBoundary>

      <ErrorBoundary name="Audio">
        <AudioControls />
      </ErrorBoundary>
    </div>
  );
}

// Layer 3: Component-level boundaries (granular isolation)
function Sequencer() {
  return (
    <div>
      {tracks.map(track => (
        <ErrorBoundary key={track.id} name={`Track ${track.id}`}>
          <Track track={track} />
        </ErrorBoundary>
      ))}
    </div>
  );
}
```

### Recommended Library: react-error-boundary

```javascript
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';

// Fallback component with recovery
function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert" className="error-boundary">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>
        Try again
      </button>
    </div>
  );
}

// Usage with logging
function KeyboardiaApp() {
  const handleError = (error, errorInfo) => {
    // Log to error reporting service (Sentry, LogRocket, etc.)
    console.error('Error caught by boundary:', error, errorInfo);

    // Could send to analytics
    analytics.track('error_boundary_triggered', {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });
  };

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={handleError}
      onReset={() => {
        // Reset app state when user clicks "Try again"
        window.location.reload(); // Or more graceful state reset
      }}
    >
      <Sequencer />
    </ErrorBoundary>
  );
}
```

### Recovery Pattern: Retry Boundary

```javascript
function RetryErrorBoundary({ children, maxRetries = 3 }) {
  const [retryCount, setRetryCount] = useState(0);

  const handleReset = () => {
    if (retryCount < maxRetries) {
      setRetryCount(count => count + 1);
    }
  };

  if (retryCount >= maxRetries) {
    return (
      <div className="error-max-retries">
        <p>Unable to recover after {maxRetries} attempts.</p>
        <button onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={handleReset}
      resetKeys={[retryCount]} // Reset when this changes
    >
      {children}
    </ErrorBoundary>
  );
}

// Use for network-dependent features
function MultiplayerPanel() {
  return (
    <RetryErrorBoundary maxRetries={3}>
      <WebSocketConsumer />
    </RetryErrorBoundary>
  );
}
```

**Impact:**

> "The retry count prevents infinite loops while giving users multiple recovery attempts. This can reduce support tickets by 40% for transient failures."

### Environment-Aware Error Handling

```javascript
function SmartErrorBoundary({ children }) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment) {
    // In dev, let errors bubble to React DevTools
    return <>{children}</>;
  }

  // In production, show graceful fallback
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, errorInfo) => {
        // Production error logging
        errorReportingService.log(error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
```

### Handling Async Errors (Not Caught by Boundaries)

Error boundaries only catch errors during render. For async operations:

```javascript
function AudioInitializer() {
  const { showBoundary } = useErrorBoundary();
  const [audioError, setAudioError] = useState(null);

  useEffect(() => {
    async function initAudio() {
      try {
        const audioContext = new AudioContext();
        await audioContext.resume();
        // Setup complete
      } catch (error) {
        // Manual propagation to error boundary
        showBoundary(error);
        // Or handle locally
        setAudioError(error);
      }
    }

    initAudio();
  }, [showBoundary]);

  if (audioError) {
    return (
      <div className="audio-error">
        <p>Audio initialization failed: {audioError.message}</p>
        <button onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  return <AudioControls />;
}
```

### Event Handler Errors

```javascript
function StepButton({ onClick }) {
  const handleClick = (e) => {
    try {
      onClick(e);
    } catch (error) {
      // Log error but don't crash
      console.error('Step click error:', error);
      toast.error('Failed to update step');
    }
  };

  return <button onClick={handleClick}>Step</button>;
}
```

### Combining with Suspense

```javascript
// Suspense handles loading, ErrorBoundary handles errors
function PatternLoader({ patternId }) {
  return (
    <ErrorBoundary
      FallbackComponent={PatternLoadError}
      onReset={() => {
        // Clear any cached data
        queryClient.invalidateQueries(['pattern', patternId]);
      }}
    >
      <Suspense fallback={<PatternLoadingSpinner />}>
        <Pattern id={patternId} />
      </Suspense>
    </ErrorBoundary>
  );
}
```

**Important:** Suspense boundaries only catch loading states, NOT errors. Always wrap Suspense with ErrorBoundary.

### Keyboardia-Specific Boundaries

```javascript
// WebSocket errors shouldn't crash sequencer
<ErrorBoundary name="WebSocket">
  <WebSocketProvider>
    <MultiplayerFeatures />
  </WebSocketProvider>
</ErrorBoundary>

// Audio errors should show fallback but keep sequencer working
<ErrorBoundary name="Audio" FallbackComponent={AudioErrorFallback}>
  <AudioEngine />
</ErrorBoundary>

// Individual track errors shouldn't crash other tracks
{tracks.map(track => (
  <ErrorBoundary key={track.id} name={`Track-${track.id}`}>
    <Track data={track} />
  </ErrorBoundary>
))}
```

### Error Reporting Integration

```javascript
import * as Sentry from '@sentry/react';

// Sentry has built-in error boundary support
function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={ErrorFallback}
      showDialog // Show user feedback dialog
    >
      <KeyboardiaApp />
    </Sentry.ErrorBoundary>
  );
}

// Or use react-error-boundary with Sentry
<ErrorBoundary
  FallbackComponent={ErrorFallback}
  onError={(error, errorInfo) => {
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
  }}
>
  <App />
</ErrorBoundary>
```

### Best Practices Checklist

- [ ] Top-level boundary to prevent white screen of death
- [ ] Feature-level boundaries to isolate sections (sequencer, multiplayer, audio)
- [ ] Component-level boundaries for repeating elements (tracks)
- [ ] Retry logic for network-dependent features (max 3 attempts)
- [ ] Environment-aware error handling (dev vs production)
- [ ] Error reporting integration (Sentry, LogRocket)
- [ ] Manual error propagation for async operations (useErrorBoundary hook)
- [ ] try/catch in event handlers (not caught by boundaries)
- [ ] Combine with Suspense for loading + error states
- [ ] User-friendly error messages with recovery actions

**Sources:**
- [7 Advanced React Error Boundary Patterns](https://medium.com/techkoala-insights/7-advanced-react-error-boundary-patterns-for-bulletproof-production-applications-ac574899851f)
- [Error Handling in React Apps: A Complete Guide](https://medium.com/@rajeevranjan2k11/error-handling-in-react-apps-a-complete-guide-to-error-boundaries-and-best-practices-094aa0e4a641)
- [Error Handling with React Error Boundary](https://www.tatvasoft.com/outsourcing/2025/02/react-error-boundary.html)
- [react-error-boundary GitHub](https://github.com/bvaughn/react-error-boundary)

---

## 5. WebSocket Integration

### Best Practice: Robust Reconnection + Message Queueing + Optimistic Updates

**Why it Matters for Keyboardia:**

Real-time collaboration requires:
- Instant visual feedback when user edits (optimistic updates)
- Reliable message delivery even during network hiccups
- Automatic reconnection without losing user work
- Handling thousands of messages/sec during busy sessions

### Recommended Library: react-use-websocket

```javascript
import useWebSocket from 'react-use-websocket';

function MultiplayerSync() {
  const {
    sendMessage,
    lastMessage,
    readyState,
    getWebSocket,
  } = useWebSocket('wss://keyboardia.app/session/abc123', {
    // Automatic reconnection with exponential backoff
    shouldReconnect: (closeEvent) => true,
    reconnectAttempts: 10,
    reconnectInterval: (attemptNumber) =>
      Math.min(1000 * Math.pow(2, attemptNumber), 30000), // Max 30s

    // Connection lifecycle hooks
    onOpen: () => console.log('WebSocket connected'),
    onClose: () => console.log('WebSocket disconnected'),
    onError: (event) => console.error('WebSocket error', event),

    // Message filtering
    filter: (message) => {
      // Only process messages for this session
      const data = JSON.parse(message.data);
      return data.sessionId === currentSessionId;
    },

    // Share connection across components
    share: true,
  });

  return { sendMessage, lastMessage, readyState };
}
```

### Reconnection Strategy with Exponential Backoff

**Critical Pattern:**

> "Implement exponential backoff with a randomized delay. This approach significantly lowers chances of a reconnection storm according to Cloudflare research (2024), which demonstrates up to 42% reduction in simultaneous reconnect attempts under heavy load."

```javascript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
reconnectInterval: (attemptNumber) => {
  const delay = Math.min(1000 * Math.pow(2, attemptNumber), 30000);
  const jitter = Math.random() * 1000; // Add randomness
  return delay + jitter;
}
```

**Why randomness matters:** If 100 users disconnect simultaneously (server restart), without jitter they all reconnect at the exact same intervals, overwhelming the server. Jitter spreads reconnections over time.

### Message Queueing

**Problem:** If you call setState on every WebSocket message, React will choke.

**Solution:** Buffer messages in a ref, then flush at intervals.

```javascript
function useWebSocketQueue({
  url,
  flushInterval = 100, // Flush every 100ms
}) {
  const messageQueue = useRef([]);
  const [messages, setMessages] = useState([]);

  const { sendMessage, lastMessage } = useWebSocket(url);

  // Add incoming messages to queue
  useEffect(() => {
    if (lastMessage) {
      messageQueue.current.push(JSON.parse(lastMessage.data));
    }
  }, [lastMessage]);

  // Flush queue periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (messageQueue.current.length > 0) {
        setMessages(prev => [...prev, ...messageQueue.current]);
        messageQueue.current = [];
      }
    }, flushInterval);

    return () => clearInterval(interval);
  }, [flushInterval]);

  return { messages, sendMessage };
}

// Usage
function Sequencer() {
  const { messages } = useWebSocketQueue({
    url: WS_URL,
    flushInterval: 100, // Process batches every 100ms
  });

  // Process batched messages
  useEffect(() => {
    messages.forEach(applyRemoteUpdate);
  }, [messages]);
}
```

**Performance Impact:**

> "This allows browsers to handle thousands of messages/sec without choking, and UI updates feel smooth (humans can't perceive sub-100ms updates anyway)."

### Optimistic Updates

**Pattern:** Update UI immediately, then reconcile with server response.

```javascript
function useOptimisticSequencer() {
  const { sendMessage, lastMessage } = useWebSocket(WS_URL);
  const [tracks, setTracks] = useState(initialTracks);
  const [pendingUpdates, setPendingUpdates] = useState(new Map());

  const toggleStep = (trackIndex, stepIndex) => {
    const updateId = `${Date.now()}-${Math.random()}`;

    // 1. Optimistic UI update (immediate)
    setTracks(prev => {
      const newTracks = [...prev];
      newTracks[trackIndex].steps[stepIndex] =
        !newTracks[trackIndex].steps[stepIndex];
      return newTracks;
    });

    // 2. Track pending update
    setPendingUpdates(prev => new Map(prev).set(updateId, {
      trackIndex,
      stepIndex,
      timestamp: Date.now(),
    }));

    // 3. Send to server
    sendMessage(JSON.stringify({
      type: 'toggleStep',
      updateId,
      trackIndex,
      stepIndex,
    }));
  };

  // Handle server confirmation
  useEffect(() => {
    if (!lastMessage) return;

    const data = JSON.parse(lastMessage.data);

    if (data.type === 'confirmUpdate') {
      // Remove from pending
      setPendingUpdates(prev => {
        const next = new Map(prev);
        next.delete(data.updateId);
        return next;
      });
    }

    if (data.type === 'rejectUpdate') {
      // Rollback optimistic update
      const pending = pendingUpdates.get(data.updateId);
      if (pending) {
        setTracks(prev => {
          const newTracks = [...prev];
          newTracks[pending.trackIndex].steps[pending.stepIndex] =
            !newTracks[pending.trackIndex].steps[pending.stepIndex];
          return newTracks;
        });
      }
    }
  }, [lastMessage, pendingUpdates]);

  return { tracks, toggleStep, pendingUpdates };
}
```

### Delta Updates (Reduce Bandwidth by 85%)

**Problem:** Sending full 16 track × 64 step state on every change wastes bandwidth.

**Solution:** Send only what changed.

```javascript
// Server sends delta updates
{
  "type": "delta",
  "changes": [
    { "op": "replace", "path": "/tracks/0/steps/5", "value": true },
    { "op": "replace", "path": "/tracks/0/paramLocks/5-cutoff", "value": 80 }
  ]
}

// Client applies using immer or similar
import { produce } from 'immer';
import { applyPatch } from 'fast-json-patch';

function applyDelta(state, changes) {
  return produce(state, draft => {
    applyPatch(draft, changes);
  });
}
```

**Performance:**

> "Apply JSON diff protocols such as rfc6902 to transfer only the parts of data that have actually updated, reducing bandwidth by up to 85% compared to full object replacement strategies."

### Heartbeat/Ping Pattern

**Prevent silent disconnections:**

```javascript
useWebSocket(url, {
  heartbeat: {
    message: JSON.stringify({ type: 'ping' }),
    interval: 30000, // 30 seconds
    timeout: 5000, // Consider dead if no pong within 5s
  },
});

// Or manual implementation
useEffect(() => {
  if (readyState !== ReadyState.OPEN) return;

  const interval = setInterval(() => {
    sendMessage(JSON.stringify({ type: 'ping' }));
  }, 30000);

  return () => clearInterval(interval);
}, [readyState, sendMessage]);
```

### Security Best Practices

```javascript
// 1. Always use wss:// (WebSocket Secure)
const WS_URL = 'wss://keyboardia.app/session'; // Not ws://

// 2. Token-based authentication
useWebSocket(url, {
  queryParams: {
    token: authToken, // JWT from login
  },
  // Or in message
  onOpen: () => {
    sendMessage(JSON.stringify({
      type: 'auth',
      token: authToken,
    }));
  },
});

// 3. Validate incoming messages
useEffect(() => {
  if (!lastMessage) return;

  try {
    const data = JSON.parse(lastMessage.data);

    // Validate structure
    if (!isValidMessage(data)) {
      console.warn('Invalid message received', data);
      return;
    }

    // Validate permissions (e.g., user can edit this session)
    if (!canUserEdit(data.userId, sessionId)) {
      console.warn('Unauthorized edit attempt', data);
      return;
    }

    applyUpdate(data);
  } catch (error) {
    console.error('Message processing error', error);
  }
}, [lastMessage]);
```

### Connection State UI

```javascript
import { ReadyState } from 'react-use-websocket';

function ConnectionIndicator() {
  const { readyState } = useWebSocket(WS_URL);

  const statusMap = {
    [ReadyState.CONNECTING]: {
      label: 'Connecting...',
      color: 'yellow'
    },
    [ReadyState.OPEN]: {
      label: 'Connected',
      color: 'green'
    },
    [ReadyState.CLOSING]: {
      label: 'Disconnecting...',
      color: 'orange'
    },
    [ReadyState.CLOSED]: {
      label: 'Disconnected',
      color: 'red'
    },
  };

  const status = statusMap[readyState];

  return (
    <div className="connection-status">
      <div
        className="status-indicator"
        style={{ backgroundColor: status.color }}
      />
      {status.label}
    </div>
  );
}
```

### Keyboardia Integration Pattern

```javascript
// MultiplayerContext.js (existing)
export function MultiplayerProvider({ children }) {
  const sessionId = useSessionId();
  const userId = useUserId();

  const {
    sendMessage,
    lastMessage,
    readyState
  } = useWebSocket(`wss://keyboardia.app/session/${sessionId}`, {
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: (attemptNumber) =>
      Math.min(1000 * Math.pow(2, attemptNumber), 30000),
    share: true, // Share connection across components
  });

  const sequencerStore = useSequencerStore();
  const messageQueue = useRef([]);

  // Queue incoming messages
  useEffect(() => {
    if (lastMessage) {
      messageQueue.current.push(JSON.parse(lastMessage.data));
    }
  }, [lastMessage]);

  // Flush queue every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      if (messageQueue.current.length === 0) return;

      const batch = messageQueue.current;
      messageQueue.current = [];

      // Apply all updates at once
      batch.forEach(message => {
        if (message.userId === userId) return; // Skip own messages

        sequencerStore.applyRemoteUpdate(message);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [sequencerStore, userId]);

  const value = {
    sendMessage,
    readyState,
    isConnected: readyState === ReadyState.OPEN,
  };

  return (
    <MultiplayerContext.Provider value={value}>
      {children}
    </MultiplayerContext.Provider>
  );
}
```

### Best Practices Checklist

- [ ] Use react-use-websocket or Socket.IO (don't build from scratch)
- [ ] Implement exponential backoff with jitter for reconnection
- [ ] Buffer messages in ref, flush at intervals (100ms recommended)
- [ ] Use optimistic updates for immediate UI feedback
- [ ] Send delta updates (JSON Patch) instead of full state
- [ ] Implement heartbeat/ping to detect silent disconnections
- [ ] Always use wss:// (WebSocket Secure)
- [ ] Authenticate with JWT tokens
- [ ] Validate all incoming messages (structure + permissions)
- [ ] Show connection state in UI
- [ ] Share WebSocket connection across components
- [ ] Handle reconnection by re-syncing state from server

**Sources:**
- [React WebSocket: High-Load Platform Guide](https://maybe.works/blogs/react-websocket)
- [The complete guide to WebSockets with React](https://ably.com/blog/websockets-react-tutorial)
- [Real-time State Management in React Using WebSockets](https://moldstud.com/articles/p-real-time-state-management-in-react-using-websockets-boost-your-apps-performance)
- [Building Real-Time Dashboards with React and WebSockets](https://www.wildnetedge.com/blogs/building-real-time-dashboards-with-react-and-websockets)

---

## 6. Audio in React

### Best Practice: Keep Audio Scheduling Outside React Render Cycle

**Why it Matters for Keyboardia:**

React re-renders on state changes (~60fps for UI). Audio timing requires microsecond precision (~44,100 samples/sec). Mixing these timelines causes:
- Timing drift and jitter
- Notes playing late or early
- Inconsistent tempo
- UI lag affecting audio

**The Core Problem:**

```javascript
// BAD: Audio scheduling tied to React lifecycle
function Track({ steps, tempo }) {
  useEffect(() => {
    // This runs AFTER React finishes rendering
    // Timing is already off by 10-50ms
    steps.forEach((step, index) => {
      if (step.active) {
        playNote(index * (60000 / tempo)); // Wrong!
      }
    });
  }, [steps, tempo]);
}
```

**Why this fails:**
- React's clock (setTimeout, useEffect) runs on the main thread
- Main thread is busy with DOM updates, event handlers
- AudioContext has its own high-precision clock
- Mixing the two causes timing inconsistencies

### The Solution: Separate Audio Timeline

**Key Principle:**

> "The audio context provides a consistent timing model and frame of reference for time that is different from JavaScript timers like setTimeout, setInterval, and new Date(). It's also different from the performance clock provided by window.performance.now()."

**Use AudioContext.currentTime for all scheduling:**

```javascript
// Create audio context outside React (singleton)
// utils/audioContext.js
let audioContextInstance = null;

export function getAudioContext() {
  if (!audioContextInstance) {
    audioContextInstance = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContextInstance;
}

export function getAudioTime() {
  return getAudioContext().currentTime;
}
```

```javascript
// Audio engine separate from React
// utils/audioEngine.js
class AudioEngine {
  constructor() {
    this.context = getAudioContext();
    this.tracks = [];
    this.isPlaying = false;
    this.tempo = 120;
    this.schedulerInterval = null;
    this.scheduleAheadTime = 0.1; // Schedule 100ms ahead
    this.currentStep = 0;
  }

  start() {
    this.isPlaying = true;
    this.currentStep = 0;

    // Lookahead scheduler (runs every 25ms)
    this.schedulerInterval = setInterval(() => {
      this.schedule();
    }, 25);
  }

  stop() {
    this.isPlaying = false;
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  schedule() {
    if (!this.isPlaying) return;

    const currentTime = this.context.currentTime;
    const secondsPerStep = (60 / this.tempo) / 4; // 16th notes

    // Schedule steps that fall within lookahead window
    while (
      this.nextStepTime < currentTime + this.scheduleAheadTime
    ) {
      this.playStep(this.currentStep, this.nextStepTime);
      this.nextStepTime += secondsPerStep;
      this.currentStep = (this.currentStep + 1) % 64;
    }
  }

  playStep(stepIndex, time) {
    // Use AudioContext time, not JavaScript time
    this.tracks.forEach(track => {
      if (track.steps[stepIndex]) {
        this.playNote(track, stepIndex, time);
      }
    });
  }

  playNote(track, stepIndex, time) {
    const oscillator = this.context.createOscillator();
    const gainNode = this.context.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.context.destination);

    oscillator.frequency.value = track.frequency;
    gainNode.gain.value = track.volume;

    // Precise scheduling using AudioContext timeline
    oscillator.start(time);
    oscillator.stop(time + 0.1);
  }

  updateTracks(tracks) {
    // React updates data, but doesn't trigger playback
    this.tracks = tracks;
  }

  setTempo(tempo) {
    this.tempo = tempo;
  }
}

export const audioEngine = new AudioEngine();
```

### React Integration (The Right Way)

```javascript
// React components control audio engine, don't schedule directly
function Sequencer() {
  const tracks = useSequencerStore(state => state.tracks);
  const tempo = useSequencerStore(state => state.tempo);
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync data to audio engine (but don't trigger playback)
  useEffect(() => {
    audioEngine.updateTracks(tracks);
  }, [tracks]);

  useEffect(() => {
    audioEngine.setTempo(tempo);
  }, [tempo]);

  // UI controls audio engine
  const handlePlay = () => {
    audioEngine.start();
    setIsPlaying(true);
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
  };

  return (
    <div>
      <button onClick={handlePlay} disabled={isPlaying}>
        Play
      </button>
      <button onClick={handleStop} disabled={!isPlaying}>
        Stop
      </button>
      <TrackList tracks={tracks} />
    </div>
  );
}
```

### The Lookahead Scheduler Pattern

**Critical Pattern:**

> "You need to have a system where you have intervals of setTimeout() being fired and each time it does, it triggers a function that schedules future individual notes. Every time it's fired, the setTimeout() timer will have to check if there are any notes that need to be scheduled based on the current tempo."

**Why lookahead?**
- Schedule notes ~100ms in the future
- Gives buffer against main thread blocking
- Uses precise AudioContext.currentTime for actual playback
- setTimeout only triggers scheduling checks, doesn't play notes

```javascript
// Visualization of lookahead scheduler
// Time: ----[now]----[100ms ahead]----[200ms ahead]----
//              ^           ^
//              |           |
//         currentTime   scheduleAhead
//
// Every 25ms, check if any notes fall in the lookahead window
// If yes, schedule them using audioContext.start(time)
```

### Using useRef to Store Audio Objects

```javascript
function Track({ trackData }) {
  // BAD: Creating new oscillator on every render
  const oscillator = new OscillatorNode(audioContext); // Wrong!

  // GOOD: Persist audio objects across renders
  const oscillatorRef = useRef(null);
  const gainRef = useRef(null);

  useEffect(() => {
    // Initialize once
    oscillatorRef.current = audioContext.createOscillator();
    gainRef.current = audioContext.createGain();

    oscillatorRef.current.connect(gainRef.current);
    gainRef.current.connect(audioContext.destination);

    return () => {
      // Cleanup
      oscillatorRef.current?.disconnect();
      gainRef.current?.disconnect();
    };
  }, []); // Empty deps - run once

  // Update params without recreating nodes
  useEffect(() => {
    if (oscillatorRef.current) {
      oscillatorRef.current.frequency.value = trackData.frequency;
    }
  }, [trackData.frequency]);
}
```

### AudioParam Scheduling (Better than setState)

```javascript
// BAD: Updating volume with state
function updateVolume(value) {
  setState({ volume: value }); // Causes re-render
  gainNode.gain.value = value; // Abrupt change
}

// GOOD: Use AudioParam methods
function updateVolume(value, time) {
  // Smooth ramp over 50ms, scheduled precisely
  gainNode.gain.linearRampToValueAtTime(
    value,
    audioContext.currentTime + 0.05
  );
  // No React re-render needed!
}

// Even better: Schedule parameter automation
function scheduleFilter(cutoffValues, startTime) {
  cutoffValues.forEach((value, index) => {
    const time = startTime + (index * 0.25); // Every beat
    filterNode.frequency.exponentialRampToValueAtTime(value, time);
  });
}
```

**Why this matters:**

> "If your website or application requires timing and scheduling, it's best to stick with the AudioParam methods for setting values."

### Helpful Libraries

1. **Tone.js** - Higher-level abstraction

```javascript
import * as Tone from 'tone';

// Tone.js handles scheduling complexity
const synth = new Tone.Synth().toDestination();

// React triggers Tone.js (which uses correct scheduling)
function Track() {
  const playNote = () => {
    synth.triggerAttackRelease('C4', '8n'); // Uses Tone.Transport
  };

  return <button onClick={playNote}>Play</button>;
}
```

2. **R-Audio** - React components for Web Audio

```javascript
// Declarative Web Audio in JSX
import { RAudioContext, RGain, ROscillator } from 'r-audio';

function Synthesizer() {
  return (
    <RAudioContext>
      <RGain gain={0.5}>
        <ROscillator
          frequency={440}
          type="sawtooth"
          playing={isPlaying}
        />
      </RGain>
    </RAudioContext>
  );
}
```

### Performance Measurement

> "It takes just 0.7ms to get from the DOM event to having scheduled the audio event. The rest is spent processing the keyboard component and dealing with clearing the event queue."

**Benchmark your audio scheduling:**

```javascript
function handleStepClick(stepIndex) {
  const start = performance.now();

  // UI update
  toggleStep(stepIndex);

  // Audio scheduling
  audioEngine.scheduleStep(stepIndex, audioContext.currentTime);

  const end = performance.now();
  console.log(`Click to schedule: ${end - start}ms`); // Should be < 1ms
}
```

**Target: < 1ms from click to schedule**

### Pre-loading Audio Buffers

```javascript
// Load samples outside React
const sampleCache = new Map();

async function loadSample(url) {
  if (sampleCache.has(url)) {
    return sampleCache.get(url);
  }

  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  sampleCache.set(url, audioBuffer);
  return audioBuffer;
}

// React component
function SamplePlayer({ sampleUrl }) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadSample(sampleUrl).then(() => setIsLoaded(true));
  }, [sampleUrl]);

  const play = () => {
    if (!isLoaded) return;

    const buffer = sampleCache.get(sampleUrl);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(audioContext.currentTime); // Precise timing
  };

  return (
    <button onClick={play} disabled={!isLoaded}>
      {isLoaded ? 'Play' : 'Loading...'}
    </button>
  );
}
```

### Best Practices Checklist

- [ ] Create AudioContext outside React (singleton pattern)
- [ ] Use AudioContext.currentTime for all scheduling (not setTimeout)
- [ ] Implement lookahead scheduler (check every 25ms, schedule 100ms ahead)
- [ ] Store audio nodes in useRef (not state)
- [ ] Use AudioParam methods for smooth parameter changes
- [ ] Keep audio engine separate from React components
- [ ] React components update data, audio engine handles playback
- [ ] Pre-load audio buffers before playback
- [ ] Consider Tone.js for complex scheduling needs
- [ ] Measure latency: click to schedule should be < 1ms

**Sources:**
- [Web Audio API best practices - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [React and Web Audio](http://joesul.li/van/react-and-web-audio/)
- [Understanding The Web Audio Clock](https://sonoport.github.io/web-audio-clock.html)
- [Web Audio Scheduling](https://loophole-letters.vercel.app/web-audio-scheduling)

---

## 7. Testing

### Best Practice: Multi-Layer Testing Strategy for Real-Time Collaboration

**Why it Matters for Keyboardia:**

Testing real-time collaborative features is complex:
- WebSocket connections need mocking
- Audio APIs aren't available in test environments
- Multiple users need simulation
- Timing-dependent behavior is hard to test
- Optimistic updates create race conditions

### Testing Pyramid for Keyboardia

```
        /\
       /  \     E2E Tests (Cypress)
      /    \    - Multi-user scenarios
     /------\   - WebSocket integration
    /        \
   /  INTE-   \ Integration Tests (Testing Library + MSW)
  / GRATION   \ - Component + WebSocket mocking
 /------------\ - Audio engine integration
/   UNIT       \
\    TESTS     / Unit Tests (Jest/Vitest)
 \            /  - Pure functions
  \----------/   - Store logic
   \        /    - Utilities
    \      /
     \    /
      \  /
       \/
```

### 1. Unit Tests - Pure Logic

**Test state management, utilities, no DOM/WebSocket/Audio:**

```javascript
// sequencerStore.test.js
import { renderHook, act } from '@testing-library/react';
import { useSequencerStore } from './sequencerStore';

describe('Sequencer Store', () => {
  beforeEach(() => {
    // Reset store before each test
    useSequencerStore.setState({
      tracks: Array(16).fill(null).map(() => ({
        steps: Array(64).fill(false),
        paramLocks: {},
      })),
    });
  });

  it('toggles step on and off', () => {
    const { result } = renderHook(() => useSequencerStore());

    act(() => {
      result.current.toggleStep(0, 5);
    });

    expect(result.current.tracks[0].steps[5]).toBe(true);

    act(() => {
      result.current.toggleStep(0, 5);
    });

    expect(result.current.tracks[0].steps[5]).toBe(false);
  });

  it('sets parameter lock', () => {
    const { result } = renderHook(() => useSequencerStore());

    act(() => {
      result.current.setParameterLock(0, 5, 'cutoff', 80);
    });

    expect(result.current.tracks[0].paramLocks['5-cutoff']).toBe(80);
  });

  it('clears track', () => {
    const { result } = renderHook(() => useSequencerStore());

    // Set some steps
    act(() => {
      result.current.toggleStep(0, 5);
      result.current.toggleStep(0, 10);
    });

    // Clear track
    act(() => {
      result.current.clearTrack(0);
    });

    expect(result.current.tracks[0].steps.every(s => !s)).toBe(true);
  });
});
```

### 2. Component Tests - Mocked WebSocket

**Use jest-websocket-mock:**

```javascript
// Track.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import WS from 'jest-websocket-mock';
import Track from './Track';
import { MultiplayerProvider } from './MultiplayerContext';

describe('Track Component', () => {
  let server;

  beforeEach(async () => {
    // Create mock WebSocket server
    server = new WS('ws://localhost:1234');
  });

  afterEach(() => {
    WS.clean();
  });

  it('sends WebSocket message when step is clicked', async () => {
    render(
      <MultiplayerProvider>
        <Track index={0} />
      </MultiplayerProvider>
    );

    await server.connected; // Wait for WS connection

    const stepButton = screen.getByTestId('step-0-5');

    // Click step
    fireEvent.click(stepButton);

    // Assert WebSocket message was sent
    await expect(server).toReceiveMessage(
      JSON.stringify({
        type: 'toggleStep',
        trackIndex: 0,
        stepIndex: 5,
      })
    );
  });

  it('updates UI when receiving remote change', async () => {
    render(
      <MultiplayerProvider>
        <Track index={0} />
      </MultiplayerProvider>
    );

    await server.connected;

    const stepButton = screen.getByTestId('step-0-5');
    expect(stepButton).not.toHaveClass('active');

    // Simulate remote user toggling step
    act(() => {
      server.send(JSON.stringify({
        type: 'toggleStep',
        trackIndex: 0,
        stepIndex: 5,
        userId: 'other-user',
      }));
    });

    // UI should update
    await waitFor(() => {
      expect(stepButton).toHaveClass('active');
    });
  });

  it('shows flash animation on remote change', async () => {
    render(
      <MultiplayerProvider>
        <Track index={0} />
      </MultiplayerProvider>
    );

    await server.connected;

    const stepButton = screen.getByTestId('step-0-5');

    // Remote change
    act(() => {
      server.send(JSON.stringify({
        type: 'toggleStep',
        trackIndex: 0,
        stepIndex: 5,
        userId: 'other-user',
      }));
    });

    // Should have flash class
    await waitFor(() => {
      expect(stepButton).toHaveClass('flash');
    });

    // Flash should disappear after timeout
    await waitFor(() => {
      expect(stepButton).not.toHaveClass('flash');
    }, { timeout: 2000 });
  });
});
```

**Important for React Testing:**

> "When testing React applications, jest-websocket-mock will look for @testing-library/react's implementation of act. If it is available, it will wrap all the necessary calls in act, so you don't have to."

### 3. Audio Engine Tests - Mock Web Audio API

```javascript
// audioEngine.test.js
import { AudioEngine } from './audioEngine';

// Mock Web Audio API
global.AudioContext = jest.fn().mockImplementation(() => ({
  createOscillator: jest.fn(() => ({
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    frequency: { value: 0 },
  })),
  createGain: jest.fn(() => ({
    connect: jest.fn(),
    gain: { value: 1 },
  })),
  destination: {},
  currentTime: 0,
}));

describe('Audio Engine', () => {
  let engine;

  beforeEach(() => {
    engine = new AudioEngine();
  });

  it('schedules notes at correct times', () => {
    const tracks = [{
      steps: [true, false, true, false],
      frequency: 440,
      volume: 0.5,
    }];

    engine.updateTracks(tracks);
    engine.setTempo(120);

    const createOscillator = jest.spyOn(
      engine.context,
      'createOscillator'
    );

    // Start playback
    engine.start();

    // Fast-forward scheduler
    jest.advanceTimersByTime(100);

    // Should have scheduled notes for active steps
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });

  it('updates tempo without restarting', () => {
    engine.setTempo(120);
    expect(engine.tempo).toBe(120);

    engine.setTempo(140);
    expect(engine.tempo).toBe(140);
  });
});
```

### 4. Integration Tests - MSW for HTTP, jest-websocket-mock for WS

**Mock Service Worker (MSW) for API calls:**

```javascript
// setupTests.js
import { setupServer } from 'msw/node';
import { rest } from 'msw';

export const server = setupServer(
  rest.get('/api/session/:id', (req, res, ctx) => {
    return res(ctx.json({
      id: req.params.id,
      tracks: [],
      users: [],
    }));
  }),

  rest.post('/api/session', (req, res, ctx) => {
    return res(ctx.json({
      id: 'new-session-123',
      tracks: [],
      users: [],
    }));
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Integration test combining HTTP + WebSocket:**

```javascript
// Sequencer.integration.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import WS from 'jest-websocket-mock';
import Sequencer from './Sequencer';

it('loads session and connects to WebSocket', async () => {
  const wsServer = new WS('ws://localhost:1234/session/abc123');

  render(<Sequencer sessionId="abc123" />);

  // Should fetch session data
  await waitFor(() => {
    expect(screen.getByText('Session: abc123')).toBeInTheDocument();
  });

  // Should connect to WebSocket
  await wsServer.connected;

  // Simulate server sending initial state
  wsServer.send(JSON.stringify({
    type: 'initialState',
    tracks: [/* data */],
  }));

  // UI should update
  await waitFor(() => {
    expect(screen.getByTestId('track-0')).toBeInTheDocument();
  });
});
```

### 5. E2E Tests - Cypress with Multiple Clients

**Simulate multi-user collaboration:**

```javascript
// cypress/e2e/collaboration.cy.js
describe('Multi-User Collaboration', () => {
  it('shows changes from other users in real-time', () => {
    // Open app in two different contexts
    cy.visit('/session/test-123');

    // User 1 clicks a step
    cy.get('[data-testid="step-0-5"]').click();
    cy.get('[data-testid="step-0-5"]').should('have.class', 'active');

    // Open second window (simulating User 2)
    cy.window().then(win => {
      win.open('/session/test-123', 'user2');
    });

    // Switch to User 2 window
    cy.switchWindow('user2');

    // User 2 should see User 1's change
    cy.get('[data-testid="step-0-5"]')
      .should('have.class', 'active')
      .and('have.class', 'flash'); // Flash animation for remote change
  });

  it('handles concurrent edits with optimistic updates', () => {
    cy.visit('/session/test-123');

    // Simulate slow network
    cy.intercept('/ws/**', { delay: 1000 });

    // User clicks step
    cy.get('[data-testid="step-0-5"]').click();

    // Should update immediately (optimistic)
    cy.get('[data-testid="step-0-5"]').should('have.class', 'active');

    // Should show pending indicator
    cy.get('[data-testid="step-0-5"]').should('have.class', 'pending');

    // After server confirms, pending should disappear
    cy.get('[data-testid="step-0-5"]', { timeout: 2000 })
      .should('not.have.class', 'pending');
  });
});
```

**Stub WebSocket in Cypress:**

```javascript
// cypress/support/commands.js
Cypress.Commands.add('mockWebSocket', (url, messages) => {
  cy.window().then(win => {
    const MockWebSocket = class {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        setTimeout(() => this.onopen?.(), 0);
      }

      send(data) {
        // Simulate server response
        const response = messages[data] || { type: 'ack' };
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify(response),
          });
        }, 100);
      }

      close() {
        this.readyState = 3; // CLOSED
        this.onclose?.();
      }
    };

    win.WebSocket = MockWebSocket;
  });
});

// Usage
cy.mockWebSocket('wss://keyboardia.app/session/abc', {
  '{"type":"toggleStep"}': {
    type: 'confirm',
    updateId: '123',
  },
});
```

### Testing Reconnection Logic

```javascript
// reconnection.test.js
it('reconnects with exponential backoff', async () => {
  const server = new WS('ws://localhost:1234');

  render(<MultiplayerProvider />);

  await server.connected;

  // Close connection
  server.close();

  // Should attempt reconnect after 1s
  await waitFor(() => {
    expect(server).toHaveBeenConnectedTimes(2);
  }, { timeout: 1500 });

  // Close again
  server.close();

  // Should attempt reconnect after 2s (exponential backoff)
  await waitFor(() => {
    expect(server).toHaveBeenConnectedTimes(3);
  }, { timeout: 2500 });
});
```

### Performance Testing

```javascript
// performance.test.js
it('handles 1000 messages/sec without choking', async () => {
  const server = new WS('ws://localhost:1234');

  render(<Sequencer />);

  await server.connected;

  const startTime = performance.now();

  // Send 1000 messages
  for (let i = 0; i < 1000; i++) {
    server.send(JSON.stringify({
      type: 'toggleStep',
      trackIndex: i % 16,
      stepIndex: i % 64,
      userId: 'other-user',
    }));
  }

  // Wait for all messages to be processed
  await waitFor(() => {
    expect(screen.getByTestId('message-count')).toHaveTextContent('1000');
  });

  const endTime = performance.now();
  const duration = endTime - startTime;

  // Should process 1000 messages in < 1 second
  expect(duration).toBeLessThan(1000);
});
```

### Best Practices Checklist

- [ ] Unit test pure logic (stores, utilities)
- [ ] Use jest-websocket-mock for WebSocket testing
- [ ] Mock Web Audio API in tests (not available in jsdom)
- [ ] Test optimistic updates and rollback scenarios
- [ ] Test reconnection logic with multiple connect/disconnect cycles
- [ ] Use MSW for HTTP API mocking
- [ ] Cypress for E2E multi-user scenarios
- [ ] Test performance (1000+ messages/sec)
- [ ] Test error boundaries and error recovery
- [ ] Test message queueing and batching
- [ ] Verify flash animations on remote changes
- [ ] Test offline behavior and message queueing

**Sources:**
- [jest-websocket-mock - npm](https://www.npmjs.com/package/jest-websocket-mock)
- [React WebSocket tutorial - LogRocket](https://blog.logrocket.com/websocket-tutorial-socket-io/)
- [How to Build a Real-Time Collaborative Editor](https://codezup.com/build-real-time-collaborative-editor-websockets-react/)
- [WebSocket React Native Guide](https://www.videosdk.live/developer-hub/websocket/websocket-react-native)

---

## Summary: Key Takeaways for Keyboardia

### State Management
- **Use Context for:** Connection state, user preferences, UI theme (low-frequency)
- **Use Zustand for:** Sequencer data, tracks, steps, param locks (high-frequency)
- **Result:** 10-20x fewer re-renders, 13x faster updates

### Performance
- **Profile first** using React DevTools Profiler
- **React.memo** for StepButton (1,024 instances)
- **useMemo** for filtering/sorting (expensive operations only)
- **useCallback** for event handlers passed to memoized components
- **Don't** memoize everything - it has costs

### Concurrent Features
- **useTransition** for pattern search, bulk edits (you control the update)
- **useDeferredValue** for multiplayer cursors, visualizations (external data)
- **Don't** use for audio scheduling or playback controls
- **Try** other optimizations first (lazy loading, virtualization)

### Error Boundaries
- **Three layers:** Top-level, feature-level, component-level
- **Use react-error-boundary** library
- **Retry pattern** with max 3 attempts for network features
- **Manual propagation** for async errors (useErrorBoundary hook)
- **try/catch** for event handlers (not caught by boundaries)

### WebSocket
- **Use react-use-websocket** (don't build from scratch)
- **Exponential backoff** with jitter for reconnection
- **Message queueing:** Buffer in ref, flush every 100ms
- **Optimistic updates** for immediate feedback
- **Delta updates** (JSON Patch) to reduce bandwidth by 85%
- **Heartbeat/ping** every 30s to detect silent disconnections

### Audio
- **Keep scheduling separate** from React render cycle
- **AudioContext.currentTime** for all timing (not setTimeout)
- **Lookahead scheduler:** Check every 25ms, schedule 100ms ahead
- **useRef** for audio nodes (not state)
- **AudioParam methods** for smooth parameter changes
- **Pre-load** audio buffers before playback

### Testing
- **Unit tests:** Pure logic (stores, utilities)
- **Component tests:** jest-websocket-mock for WebSocket
- **Integration tests:** MSW + WebSocket mocks
- **E2E tests:** Cypress for multi-user scenarios
- **Mock Web Audio API** (not available in test environments)
- **Test reconnection**, optimistic updates, performance

---

**Document Version:** 1.0
**Last Updated:** 2025-12-10
**Next Review:** 2026-01-10
