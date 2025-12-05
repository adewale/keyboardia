import { useCallback, useState } from 'react'
import { GridProvider, useGrid } from './state/grid'
import { StepSequencer } from './components/StepSequencer'
import { SamplePicker } from './components/SamplePicker'
import { Recorder } from './components/Recorder'
import { useSession } from './hooks/useSession'
import { MAX_TRACKS } from './types'
import type { Track } from './types'
import './App.css'

function SessionControls() {
  const { state, dispatch } = useGrid();
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);

  const loadState = useCallback((tracks: Track[], tempo: number, swing: number) => {
    dispatch({ type: 'LOAD_STATE', tracks, tempo, swing });
  }, [dispatch]);

  const { status, share, fork, createNew, forkedFrom } = useSession(state, loadState);

  const handleShare = useCallback(async () => {
    try {
      const url = await share();
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to share:', error);
    }
  }, [share]);

  const handleFork = useCallback(async () => {
    setForking(true);
    try {
      await fork();
    } catch (error) {
      console.error('Failed to fork:', error);
    } finally {
      setForking(false);
    }
  }, [fork]);

  const handleNew = useCallback(async () => {
    await createNew();
  }, [createNew]);

  if (status === 'loading') {
    return <div className="session-controls session-loading">Loading...</div>;
  }

  if (status === 'not_found') {
    return (
      <div className="session-controls session-not-found">
        <span className="not-found-text">Session expired or not found</span>
        <button
          className="session-btn new-btn"
          onClick={handleNew}
          title="Create a new session"
        >
          Create New
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return <div className="session-controls session-error">Session error</div>;
  }

  return (
    <div className="session-controls">
      {forkedFrom && (
        <span className="forked-badge" title={`Forked from ${forkedFrom}`}>
          Forked
        </span>
      )}
      <button
        className="session-btn share-btn"
        onClick={handleShare}
        title="Copy link to clipboard"
      >
        {copied ? 'Copied!' : 'Share'}
      </button>
      <button
        className="session-btn fork-btn"
        onClick={handleFork}
        disabled={forking}
        title="Create a copy to edit"
      >
        {forking ? 'Forking...' : 'Fork'}
      </button>
      <button
        className="session-btn new-btn"
        onClick={handleNew}
        title="Start fresh"
      >
        New
      </button>
    </div>
  );
}

function AppContent() {
  const { state, dispatch } = useGrid();
  const canAddTrack = state.tracks.length < MAX_TRACKS;

  const handleAddTrack = useCallback((sampleId: string, name: string) => {
    dispatch({ type: 'ADD_TRACK', sampleId, name });
  }, [dispatch]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <h1>Keyboardia</h1>
          <SessionControls />
        </div>
        <p className="subtitle">Click a cell to toggle, then press play</p>
      </header>
      <main>
        <StepSequencer />
        <SamplePicker
          onSelectSample={handleAddTrack}
          disabled={!canAddTrack}
        />
        <Recorder
          onSampleRecorded={handleAddTrack}
          disabled={!canAddTrack}
          trackCount={state.tracks.length}
          maxTracks={MAX_TRACKS}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <GridProvider>
      <AppContent />
    </GridProvider>
  )
}

export default App
