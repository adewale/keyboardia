/**
 * navigator.mediaSession wiring (Phase 44 §6).
 *
 * Declares the sequencer as media to the OS: lock-screen transport state and
 * a name, and on iOS a signal that this page plays media. Everything is
 * feature-detected; on platforms and test environments without the API the
 * calls are no-ops.
 */

interface MediaSessionLike {
  playbackState: MediaSessionPlaybackState;
  metadata: MediaMetadata | null;
  setActionHandler?: (
    action: 'play' | 'pause',
    handler: MediaSessionActionHandler | null,
  ) => void;
}

export function installMediaSessionActionHandlers(
  handlers: { play: () => void; pause: () => void },
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): () => void {
  const session = mediaSessionOf(nav);
  if (!session?.setActionHandler) return () => undefined;
  for (const action of ['play', 'pause'] as const) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // Partial Media Session implementations must not break transport setup.
    }
  }
  return () => {
    for (const action of ['play', 'pause'] as const) {
      try { session.setActionHandler?.(action, null); } catch { /* no-op */ }
    }
  };
}

function mediaSessionOf(nav: Navigator | undefined): MediaSessionLike | null {
  if (!nav || !('mediaSession' in nav)) return null;
  return nav.mediaSession as MediaSessionLike;
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): void {
  const session = mediaSessionOf(nav);
  if (!session) return;
  try {
    if (state === 'playing' && typeof MediaMetadata !== 'undefined' && !session.metadata) {
      session.metadata = new MediaMetadata({ title: 'Keyboardia session' });
    }
    session.playbackState = state;
  } catch {
    // A browser that exposes the API but rejects the value must not break playback.
  }
}
