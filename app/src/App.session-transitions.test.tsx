// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionId: '11111111-1111-4111-8111-111111111111' as string | null,
  publish: vi.fn(),
  share: vi.fn(),
  remix: vi.fn(),
  createNew: vi.fn(),
  copyToClipboard: vi.fn(),
  activateQR: vi.fn(),
  deactivateQR: vi.fn(),
}));

vi.mock('./state/grid', () => ({
  GridProvider: ({ children }: { children: React.ReactNode }) => children,
  useGrid: () => ({
    state: {
      tracks: [], tempo: 120, swing: 0,
      effects: {
        bypass: false,
        reverb: { decay: 2, wet: 0 },
        delay: { time: '8n', feedback: 0.3, wet: 0 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
        distortion: { amount: 0.4, wet: 0 },
      },
      scale: { root: 'C', scaleId: 'minor-pentatonic', locked: false },
      isPlaying: false, currentStep: -1,
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('./hooks/useSession', () => ({
  useSession: () => ({
    status: 'ready',
    sessionId: mocks.sessionId,
    sessionName: null,
    renameSession: vi.fn(),
    share: mocks.share,
    publish: mocks.publish,
    remix: mocks.remix,
    createNew: mocks.createNew,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    isOrphaned: false,
    isPublished: false,
    setIsPublished: vi.fn(),
  }),
}));

vi.mock('./hooks/useMultiplayer', () => ({
  useMultiplayer: () => ({
    isConnected: false, players: [], playerId: null, playerCount: 0,
    status: 'disconnected', reconnectAttempts: 0, queueSize: 0,
    cursors: new Map(), sendCursor: vi.fn(), retryConnection: vi.fn(), playingPlayerIds: new Set(),
  }),
  useMultiplayerDispatch: (dispatch: unknown) => dispatch,
  useMultiplayerSync: () => ({
    handleMuteChange: vi.fn(), handleSoloChange: vi.fn(), handleTrackAdded: vi.fn(),
    handleBatchClearSteps: vi.fn(), handleBatchSetParameterLocks: vi.fn(), handleTrackReorder: vi.fn(),
  }),
}));

vi.mock('./hooks/useQRMode', () => ({
  useQRMode: () => ({
    isActive: false,
    targetURL: `${window.location.origin}/s/${mocks.sessionId}`,
    activate: mocks.activateQR,
    deactivate: mocks.deactivateQR,
  }),
}));
vi.mock('./hooks/useDisplayMode', () => ({ useDisplayMode: () => 'large', useOrientationMode: () => 'desktop' }));
vi.mock('./context/RemoteChangeContext', () => ({ useRemoteChanges: () => null, RemoteChangeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./components/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('./components/AvatarStack', () => ({ AvatarStack: () => null }));
vi.mock('./components/SessionName', () => ({ SessionName: () => null }));
vi.mock('./components/FeatureErrorBoundary', () => ({ FeatureErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./components/ToastNotification', () => ({
  ToastNotification: ({ toasts }: { toasts: Array<{ message: string }> }) => (
    <div data-testid="toasts">{toasts.map(toast => toast.message).join('|')}</div>
  ),
}));
vi.mock('./icons', () => ({ Close: () => null, CopyLink: () => null, Qr: () => null }));
vi.mock('./utils/clipboard', () => ({ copyToClipboard: mocks.copyToClipboard }));
vi.mock('./audio/midiExport', () => ({ downloadMidi: vi.fn() }));

import { SessionControls } from './App';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('App session transition ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionId = '11111111-1111-4111-8111-111111111111';
    mocks.copyToClipboard.mockResolvedValue(true);
    mocks.remix.mockResolvedValue('');
    mocks.createNew.mockResolvedValue(undefined);
  });

  it('allows only one shared Publish/Remix/New/Share action at a time', async () => {
    const publication = deferred<string>();
    mocks.publish.mockReturnValueOnce(publication.promise);
    const view = render(<SessionControls><div>content</div></SessionControls>);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Publishing...' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Remix' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'New' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Invite/ }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(mocks.createNew).not.toHaveBeenCalled();

    act(() => publication.resolve('https://example.test/published'));
    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith('https://example.test/published'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false));
    view.unmount();
  });

  it('releases shared ownership after an action fails', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('publication failed'));
    const view = render(<SessionControls><div>content</div></SessionControls>);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Remix' }));
    await waitFor(() => expect(mocks.remix).toHaveBeenCalledOnce());
    view.unmount();
  });

  it('copies canonical v2.4 notation through the shipped serializer', async () => {
    const view = render(<SessionControls><div>content</div></SessionControls>);
    const button = await screen.findByRole('button', { name: 'Copy Notation' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));

    fireEvent.click(button);

    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith(''));
    await screen.findByRole('button', { name: 'Notation Copied!' });
    view.unmount();
  });

  it('invalidates a stale share completion when the session changes', async () => {
    const sharing = deferred<string>();
    mocks.share.mockReturnValueOnce(sharing.promise);
    const view = render(<SessionControls><div>content</div></SessionControls>);

    fireEvent.click(screen.getByRole('button', { name: /Invite/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());

    mocks.sessionId = '22222222-2222-4222-8222-222222222222';
    view.rerender(<SessionControls><div>content</div></SessionControls>);
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remix' }));
    expect(mocks.remix).not.toHaveBeenCalled();

    act(() => sharing.resolve('https://example.test/stale-session'));
    await act(async () => { await sharing.promise; });
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    expect(screen.getByTestId('toasts').textContent).not.toContain('stale-session');
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false);
  });
});
