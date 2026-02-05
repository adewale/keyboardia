import { useCallback, useState, lazy, Suspense } from 'react'
import { GridProvider } from './state/grid'
import { LandingPage } from './components/LandingPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DebugProvider } from './debug/DebugContext'
import { DebugOverlay } from './debug/DebugOverlay'
import { RemoteChangeProvider } from './context/RemoteChangeContext'
import { createSession, updateUrlWithSession } from './sync/session'
import './App.css'

// Phase 34+: Lazy load the entire session app (audio engine, multiplayer, sequencer)
// This keeps the landing page bundle small - audio/sync only loads when a session starts
const SessionApp = lazy(() => import('./SessionApp'))

// Check if URL has a session ID (matches /s/{id} pattern)
function hasSessionInUrl(): boolean {
  const path = window.location.pathname;
  return /^\/s\/[a-zA-Z0-9_-]+/.test(path);
}

// Default drum samples for landing page example patterns
// Must match valid sample IDs from sample-constants.ts
const LANDING_SAMPLES = ['kick', 'snare', 'hihat', 'clap'];

function App() {
  const [showLanding, setShowLanding] = useState(() => !hasSessionInUrl());

  const handleStartSession = useCallback(async () => {
    // Create empty session
    const session = await createSession({
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    });
    updateUrlWithSession(session.id);
    setShowLanding(false);
  }, []);

  const handleSelectExample = useCallback(async (pattern: number[][], bpm: number) => {
    // Create session with pre-populated tracks from example pattern
    // Convert number steps (0/1) to booleans
    const tracks = pattern.map((steps, i) => ({
      id: `track-${Date.now()}-${i}`,
      name: LANDING_SAMPLES[i] || `Track ${i + 1}`,
      sampleId: LANDING_SAMPLES[i] || 'kick',
      steps: steps.map(s => s === 1),
      stepCount: 16,
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
      transpose: 0,
      parameterLocks: Array(16).fill(null),
    }));

    const session = await createSession({
      tracks,
      tempo: bpm,
      swing: 0,
      version: 1,
    });
    updateUrlWithSession(session.id);
    setShowLanding(false);
  }, []);

  if (showLanding) {
    return (
      <LandingPage
        onStartSession={handleStartSession}
        onSelectExample={handleSelectExample}
      />
    );
  }

  return (
    <ErrorBoundary>
      <DebugProvider>
        <GridProvider>
          <RemoteChangeProvider>
            <Suspense fallback={<div className="app"><div className="session-loading-screen">Loading session...</div></div>}>
              <SessionApp />
            </Suspense>
          </RemoteChangeProvider>
          <DebugOverlay />
        </GridProvider>
      </DebugProvider>
    </ErrorBoundary>
  );
}

export default App
