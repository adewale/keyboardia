import { useCallback, useState } from 'react'
import { GridProvider, useGrid } from './state/grid'
import { StepSequencer } from './components/StepSequencer'
import { SamplePicker } from './components/SamplePicker'
import { Recorder } from './components/Recorder'
import { useSession } from './hooks/useSession'
import { DebugProvider } from './debug/DebugContext'
import { DebugOverlay } from './debug/DebugOverlay'
import { MAX_TRACKS } from './types'
import type { Track } from './types'
import './App.css'

function SessionControls() {
  const { state, dispatch } = useGrid();
  const [copied, setCopied] = useState(false);
  const [sendingCopy, setSendingCopy] = useState(false);
  const [copySent, setCopySent] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [orphanDismissed, setOrphanDismissed] = useState(false);

  const loadState = useCallback((tracks: Track[], tempo: number, swing: number) => {
    dispatch({ type: 'LOAD_STATE', tracks, tempo, swing });
  }, [dispatch]);

  const resetState = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
  }, [dispatch]);

  const {
    status,
    share,
    sendCopy,
    remix,
    createNew,
    remixedFrom,
    remixedFromName,
    remixCount,
    isOrphaned,
  } = useSession(state, loadState, resetState);

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

  const handleSendCopy = useCallback(async () => {
    setSendingCopy(true);
    try {
      const url = await sendCopy();
      await navigator.clipboard.writeText(url);
      setCopySent(true);
      setTimeout(() => setCopySent(false), 2000);
    } catch (error) {
      console.error('Failed to send copy:', error);
    } finally {
      setSendingCopy(false);
    }
  }, [sendCopy]);

  const handleRemix = useCallback(async () => {
    setRemixing(true);
    try {
      await remix();
    } catch (error) {
      console.error('Failed to remix:', error);
    } finally {
      setRemixing(false);
    }
  }, [remix]);

  const handleNew = useCallback(async () => {
    await createNew();
  }, [createNew]);

  if (status === 'loading') {
    return <div className="session-controls session-loading">Loading...</div>;
  }

  if (status === 'not_found') {
    return (
      <div className="session-controls session-not-found">
        <span className="not-found-text">Session not found</span>
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
    <>
      {/* Orphan banner */}
      {isOrphaned && !orphanDismissed && (
        <div className="orphan-banner">
          <span>This session hasn't been used in over 90 days. It's still here! Editing will mark it as active again.</span>
          <button
            className="orphan-dismiss"
            onClick={() => setOrphanDismissed(true)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <div className="session-controls">
        {/* Remix lineage */}
        {remixedFrom && (
          <span className="remix-lineage">
            <span className="lineage-arrow">↳</span>
            <a
              href={`/s/${remixedFrom}`}
              className="lineage-link"
              title={`View parent session`}
            >
              Remixed from {remixedFromName || 'another session'}
            </a>
            {remixCount > 0 && (
              <span className="remix-count" title={`${remixCount} remix${remixCount > 1 ? 'es' : ''}`}>
                • {remixCount} remix{remixCount > 1 ? 'es' : ''}
              </span>
            )}
          </span>
        )}
        {/* Show remix count even if not a remix */}
        {!remixedFrom && remixCount > 0 && (
          <span className="remix-count-standalone" title={`${remixCount} remix${remixCount > 1 ? 'es' : ''}`}>
            {remixCount} remix{remixCount > 1 ? 'es' : ''}
          </span>
        )}
        <button
          className="session-btn share-btn"
          onClick={handleShare}
          title="Copy session link — recipients can edit live"
        >
          {copied ? 'Copied!' : 'Invite'}
        </button>
        <button
          className="session-btn send-copy-btn"
          onClick={handleSendCopy}
          disabled={sendingCopy}
          title="Create a copy and copy link — recipients get their own version"
        >
          {copySent ? 'Link Copied!' : sendingCopy ? 'Creating...' : 'Send Copy'}
        </button>
        <button
          className="session-btn remix-btn"
          onClick={handleRemix}
          disabled={remixing}
          title="Create a copy for yourself"
        >
          {remixing ? 'Remixing...' : 'Remix'}
        </button>
        <button
          className="session-btn new-btn"
          onClick={handleNew}
          title="Start fresh"
        >
          New
        </button>
      </div>
    </>
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
    <DebugProvider>
      <GridProvider>
        <AppContent />
        <DebugOverlay />
      </GridProvider>
    </DebugProvider>
  )
}

export default App
