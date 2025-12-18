import { useCallback, useState, useRef, useEffect } from 'react'
import { GridProvider, useGrid } from './state/grid'
import { StepSequencer } from './components/StepSequencer'
import { SamplePicker } from './components/SamplePicker'
import { Recorder } from './components/Recorder'
import { EffectsPanel } from './components/EffectsPanel'
import type { EffectsState } from './types'
import { AvatarStack } from './components/AvatarStack'
import { ToastNotification, type Toast } from './components/ToastNotification'
import { ConnectionStatus } from './components/ConnectionStatus'
import { SessionName } from './components/SessionName'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OrientationHint } from './components/OrientationHint'
import { QROverlay } from './components/QROverlay'
import { useSession } from './hooks/useSession'
import { useMultiplayer, useMultiplayerDispatch, useMultiplayerSync } from './hooks/useMultiplayer'
import { useQRMode } from './hooks/useQRMode'
import { useDisplayMode } from './hooks/useDisplayMode'
import { DebugProvider } from './debug/DebugContext'
import { DebugOverlay } from './debug/DebugOverlay'
import { MultiplayerContext, useMultiplayerContext, type MultiplayerContextValue } from './context/MultiplayerContext'
import { RemoteChangeProvider, useRemoteChanges } from './context/RemoteChangeContext'
import type { PlayerInfo } from './sync/multiplayer'
import { MAX_TRACKS } from './types'
import type { Track } from './types'
import { logger } from './utils/logger'
import { copyToClipboard } from './utils/clipboard'
import './App.css'

// Feature flags - recording is hidden (Shared Sample Recording archived)
// Enable with ?recording=1 in URL for testing
const ENABLE_RECORDING = new URLSearchParams(window.location.search).get('recording') === '1';

interface SessionControlsProps {
  children: React.ReactNode;
}

function SessionControls({ children }: SessionControlsProps) {
  const { state, dispatch } = useGrid();
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [orphanDismissed, setOrphanDismissed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);

  // QR Mode
  const { isActive: qrModeActive, targetURL: qrTargetURL, activate: activateQR, deactivate: deactivateQR } = useQRMode();
  const displayMode = useDisplayMode();

  // Auto-reset copied state after 2 seconds (prevents memory leak from setTimeout in callback)
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
    publish,
    remix,
    createNew,
    remixedFrom,
    remixedFromName,
    remixCount,
    isOrphaned,
    isPublished,
    setIsPublished,
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

  // Show URL fallback toast when clipboard copy fails
  const showUrlFallbackToast = useCallback((url: string, message: string) => {
    const toast: Toast = {
      id: `url-${Date.now()}`,
      message,
      type: 'url',
      url,
    };
    setToasts(prev => [...prev, toast]);
  }, []);

  // Phase 12 Polish: State getter for hash verification
  // Returns state in the same shape as server's SessionState (tracks, tempo, swing, version)
  // Note: version is maintained by server, client doesn't track it, so we omit it
  // The hash function will produce consistent results as long as tracks/tempo/swing match
  //
  // IMPORTANT: Uses ref pattern to maintain stable callback reference.
  // Without this, the callback changes on every state update, causing the useMultiplayer
  // useEffect to re-run and disconnect/reconnect the WebSocket (connection storm bug).
  const stateForHashRef = useRef({ tracks: state.tracks, tempo: state.tempo, swing: state.swing });
  stateForHashRef.current = { tracks: state.tracks, tempo: state.tempo, swing: state.swing };

  const getStateForHash = useCallback(() => stateForHashRef.current, []);

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
    playingPlayerIds,
  } = useMultiplayer(sessionId, dispatch, status === 'ready', remoteChanges?.recordChange, handlePlayerEvent, getStateForHash, setIsPublished);

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
    // Phase 21: Published sessions are read-only
    isPublished,
    // Phase 22: Per-player playback tracking
    playingPlayerIds,
  };

  const handleShare = useCallback(async () => {
    try {
      // share() is sync - just returns current URL
      const url = await share();
      const success = await copyToClipboard(url);
      if (success) {
        setCopied(true);
        // Timer cleanup is handled by useEffect above
      } else {
        // Show URL fallback toast so user can copy manually
        showUrlFallbackToast(url, 'Could not copy automatically');
      }
    } catch (error) {
      logger.error('Failed to share:', error);
    }
  }, [share, showUrlFallbackToast]);

  // Phase 21: Publish session handler
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const url = await publish();

      // Copy the published URL to clipboard
      const success = await copyToClipboard(url);
      if (success) {
        // Show toast notification
        const toast: Toast = {
          id: `publish-${Date.now()}`,
          message: 'Session published! Link copied.',
          type: 'join',
        };
        setToasts(prev => [...prev, toast]);
      } else {
        showUrlFallbackToast(url, 'Published! Copy link:');
      }
    } catch (error) {
      logger.error('Failed to publish:', error);
    } finally {
      setPublishing(false);
    }
  }, [publish, showUrlFallbackToast]);

  const handleRemix = useCallback(async () => {
    setRemixing(true);
    try {
      await remix();
    } catch (error) {
      logger.error('Failed to remix:', error);
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
                playingPlayerIds={playingPlayerIds}
              />
            )}
            {/* Published badge */}
            {isPublished && (
              <span className="published-badge" title="This session is published and read-only">
                Published
              </span>
            )}
            {/* Remix lineage - text only, no links (spec lines 472-479) */}
            {remixedFrom && (
              <span className="remix-lineage">
                <span className="lineage-arrow">↳</span>
                <span className="lineage-text">
                  Remixed from {remixedFromName || 'another session'}
                </span>
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
            {/* Phase 21: Button order - [Publish] [Remix] [New] ··· [Invite ▾] */}
            {!isPublished && (
              <button
                className="session-btn publish-btn"
                onClick={handlePublish}
                disabled={publishing}
                title="Publish this session — freeze it forever for sharing"
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            )}
            <button
              className="session-btn remix-btn"
              onClick={handleRemix}
              disabled={remixing}
              title={isPublished ? 'Create your own editable copy' : 'Create a copy for yourself'}
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
            {/* Phase 21: No Invite button on published sessions (spec line 298) */}
            {!isPublished && (
              <div className="share-dropdown-container">
                <button
                  className="session-btn invite-btn"
                  onClick={() => setShareDropdownOpen(!shareDropdownOpen)}
                  title="Invite others to collaborate"
                  aria-expanded={shareDropdownOpen}
                  aria-haspopup="true"
                >
                  {copied ? 'Copied!' : 'Invite'} ▾
                </button>
                {shareDropdownOpen && (
                  <div className="share-dropdown">
                    <button
                      className="share-dropdown-item"
                      onClick={() => {
                        handleShare();
                        setShareDropdownOpen(false);
                      }}
                    >
                      Copy Link
                    </button>
                    <button
                      className="share-dropdown-item"
                      onClick={() => {
                        activateQR();
                        setShareDropdownOpen(false);
                      }}
                    >
                      Show QR Code
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
      )}
    </>
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!shareDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.share-dropdown-container')) {
        setShareDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [shareDropdownOpen]);

  // CSS class for QR large mode layout adjustment
  const appClassName = `app${qrModeActive && displayMode === 'large' ? ' qr-mode-large' : ''}`;

  return (
    <MultiplayerContext.Provider value={multiplayerContextValue}>
      <div className={appClassName}>
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
                    disabled={isPublished}
                  />
                </>
              )}
            </div>
            {sessionControlsUI}
          </div>
          <p className={`subtitle${isPublished ? ' published' : ''}`}>
            {isPublished
              ? 'Published • Press play to listen, then remix to make it yours'
              : 'Click a cell to toggle, then press play'}
          </p>
        </header>
        {children}
        {/* Phase 11: Player join/leave notifications */}
        <ToastNotification toasts={toasts} onDismiss={handleDismissToast} />

        {/* QR Code Overlay */}
        {qrModeActive && status === 'ready' && (
          <QROverlay
            targetURL={qrTargetURL}
            sessionName={sessionName}
            playerCount={playerCount}
            onClose={deactivateQR}
          />
        )}
      </div>
    </MultiplayerContext.Provider>
  );
}

function MainContent() {
  const { state, dispatch } = useGrid();
  const multiplayer = useMultiplayerContext();
  const canAddTrack = state.tracks.length < MAX_TRACKS;
  const isPublished = multiplayer?.isPublished ?? false;

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

  // Handle effects changes
  const handleEffectsChange = useCallback((effects: EffectsState) => {
    const dispatchFn = multiplayer?.dispatch ?? dispatch;
    dispatchFn({ type: 'SET_EFFECTS', effects });
  }, [multiplayer, dispatch]);

  return (
    <main>
      <OrientationHint />
      <StepSequencer />
      {/* Effects and sample picker row */}
      <div className="controls-row">
        {/* Hide sample picker for published sessions - they can only listen */}
        {!isPublished && (
          <SamplePicker
            onSelectSample={handleAddTrack}
            disabled={!canAddTrack}
            previewsDisabled={isPublished}
          />
        )}
        {/* Effects panel - mobile only (desktop uses Transport bar FX) */}
        <div className="mobile-effects-wrapper">
          <EffectsPanel
            initialState={state.effects}
            onEffectsChange={handleEffectsChange}
            disabled={isPublished}
          />
        </div>
      </div>
      {ENABLE_RECORDING && !isPublished && (
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
    <ErrorBoundary>
      <DebugProvider>
        <GridProvider>
          <RemoteChangeProvider>
            <AppContent />
          </RemoteChangeProvider>
          <DebugOverlay />
        </GridProvider>
      </DebugProvider>
    </ErrorBoundary>
  )
}

export default App
