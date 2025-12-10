import { useCallback, useState, useRef, useEffect } from 'react'
import { GridProvider, useGrid } from './state/grid'
import { StepSequencer } from './components/StepSequencer'
import { SamplePicker } from './components/SamplePicker'
import { Recorder } from './components/Recorder'
import { AvatarStack } from './components/AvatarStack'
import { ToastNotification, type Toast } from './components/ToastNotification'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SessionName } from './components/SessionName'
import { useSession } from './hooks/useSession'
import { useMultiplayer, useMultiplayerDispatch, useMultiplayerSync } from './hooks/useMultiplayer'
import { DebugProvider } from './debug/DebugContext'
import { DebugOverlay } from './debug/DebugOverlay'
import { MultiplayerContext, useMultiplayerContext, type MultiplayerContextValue } from './context/MultiplayerContext'
import { RemoteChangeProvider, useRemoteChanges } from './context/RemoteChangeContext'
import type { PlayerInfo } from './sync/multiplayer'
import { MAX_TRACKS } from './types'
import type { Track } from './types'
import './App.css'

// Feature flags - recording is hidden until Phase 16 (Shared Sample Recording)
// Enable with ?recording=1 in URL for testing
const ENABLE_RECORDING = new URLSearchParams(window.location.search).get('recording') === '1';

interface SessionControlsProps {
  children: React.ReactNode;
}

function SessionControls({ children }: SessionControlsProps) {
  const { state, dispatch } = useGrid();
  const [copied, setCopied] = useState(false);
  const [sendingCopy, setSendingCopy] = useState(false);
  const [copySent, setCopySent] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [orphanDismissed, setOrphanDismissed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const loadState = useCallback((tracks: Track[], tempo: number, swing: number) => {
    dispatch({ type: 'LOAD_STATE', tracks, tempo, swing });
  }, [dispatch]);

  const resetState = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
  }, [dispatch]);

  const {
    status,
    sessionId,
    sessionName,
    renameSession,
    share,
    sendCopy,
    remix,
    createNew,
    remixedFrom,
    remixedFromName,
    remixCount,
    isOrphaned,
  } = useSession(state, loadState, resetState);

  // Phase 11: Remote change attribution
  const remoteChanges = useRemoteChanges();

  // Phase 11: Player join/leave notification handler
  const handlePlayerEvent = useCallback((player: PlayerInfo, event: 'join' | 'leave') => {
    const toast: Toast = {
      id: `${player.id}-${event}-${Date.now()}`,
      message: `${player.name} ${event === 'join' ? 'joined' : 'left'}`,
      color: player.color,
      type: event,
    };
    setToasts(prev => [...prev, toast]);
  }, []);

  // Dismiss toast handler
  const handleDismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Multiplayer connection
  const {
    isConnected,
    players,
    playerId,
    playerCount,
    status: connectionStatus,
    reconnectAttempts,
    queueSize,
    cursors,
    sendCursor,
    retryConnection,
  } = useMultiplayer(sessionId, dispatch, status === 'ready', remoteChanges?.recordChange, handlePlayerEvent);

  // Wrap dispatch to send actions over WebSocket
  const multiplayerDispatch = useMultiplayerDispatch(dispatch, isConnected);

  // Mute/solo/track sync handlers
  const { handleMuteChange, handleSoloChange, handleTrackAdded } = useMultiplayerSync(isConnected);

  // Multiplayer context value
  const multiplayerContextValue: MultiplayerContextValue = {
    isConnected,
    playerCount,
    dispatch: multiplayerDispatch,
    handleMuteChange,
    handleSoloChange,
    handleTrackAdded,
    // Phase 11: Cursors
    cursors,
    sendCursor,
  };

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

  // Session controls UI component
  const sessionControlsUI = (
    <>
      {status === 'loading' && (
        <div className="session-controls session-loading">Loading...</div>
      )}

      {status === 'not_found' && (
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
      )}

      {status === 'error' && (
        <div className="session-controls session-error">Session error</div>
      )}

      {status === 'ready' && (
        <div className="session-controls">
            {/* Phase 12: Connection status indicator */}
            <ConnectionStatus
              status={connectionStatus}
              reconnectAttempts={reconnectAttempts}
              queueSize={queueSize}
              onRetry={retryConnection}
            />
            {/* Multiplayer avatars */}
            {playerCount > 0 && (
              <AvatarStack
                players={players}
                currentPlayerId={playerId}
                maxVisible={5}
              />
            )}
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
      )}
    </>
  );

  return (
    <MultiplayerContext.Provider value={multiplayerContextValue}>
      <div className="app">
        <header className="app-header">
          {/* Orphan banner above header */}
          {status === 'ready' && isOrphaned && !orphanDismissed && (
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
          <div className="header-top">
            <div className="header-title-group">
              <h1>Keyboardia</h1>
              {status === 'ready' && (
                <>
                  <span className="title-separator">/</span>
                  <SessionName
                    name={sessionName}
                    onRename={renameSession}
                  />
                </>
              )}
            </div>
            {sessionControlsUI}
          </div>
          <p className="subtitle">Click a cell to toggle, then press play</p>
        </header>
        {children}
        {/* Phase 11: Player join/leave notifications */}
        <ToastNotification toasts={toasts} onDismiss={handleDismissToast} />
      </div>
    </MultiplayerContext.Provider>
  );
}

function MainContent() {
  const { state, dispatch } = useGrid();
  const multiplayer = useMultiplayerContext();
  const canAddTrack = state.tracks.length < MAX_TRACKS;

  // Track IDs we've already sent to the server to avoid duplicates
  const sentTrackIdsRef = useRef<Set<string>>(new Set());

  // When tracks change, send any new ones to the server
  // This handles the case where we added a track locally
  useEffect(() => {
    if (!multiplayer?.isConnected) return;

    for (const track of state.tracks) {
      if (!sentTrackIdsRef.current.has(track.id)) {
        sentTrackIdsRef.current.add(track.id);
        // Only send if this looks like a locally-created track (timestamp-based ID)
        // Remote tracks have UUIDs from the server
        if (track.id.startsWith('track-')) {
          multiplayer.handleTrackAdded(track);
        }
      }
    }
  }, [state.tracks, multiplayer]);

  const handleAddTrack = useCallback((sampleId: string, name: string) => {
    // Use multiplayer dispatch if connected, otherwise regular dispatch
    const dispatchFn = multiplayer?.dispatch ?? dispatch;
    dispatchFn({ type: 'ADD_TRACK', sampleId, name });
  }, [multiplayer, dispatch]);

  return (
    <main>
      <StepSequencer />
      <SamplePicker
        onSelectSample={handleAddTrack}
        disabled={!canAddTrack}
      />
      {ENABLE_RECORDING && (
        <Recorder
          onSampleRecorded={handleAddTrack}
          disabled={!canAddTrack}
          trackCount={state.tracks.length}
          maxTracks={MAX_TRACKS}
        />
      )}
    </main>
  );
}

function AppContent() {
  return (
    <SessionControls>
      <MainContent />
    </SessionControls>
  );
}

function App() {
  return (
    <DebugProvider>
      <GridProvider>
        <RemoteChangeProvider>
          <AppContent />
        </RemoteChangeProvider>
        <DebugOverlay />
      </GridProvider>
    </DebugProvider>
  )
}

export default App
