import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitHttpRequestEvent,
  emitWsSessionEvent,
  type HttpRequestEvent,
  type WsSessionEvent,
} from './observability';

const commonContext = {
  deploy: { versionId: 'version-1', deployedAt: '2026-07-27T00:00:00.000Z' },
  infra: { colo: 'LHR', country: 'GB' },
  service: { name: 'keyboardia', environment: 'production' },
};

const httpEvent: HttpRequestEvent = {
  event: 'http_request',
  requestId: 'request-1',
  method: 'GET',
  path: '/api/health',
  deviceType: 'desktop',
  timestamp: '2026-07-27T00:00:00.000Z',
  duration_ms: 3,
  status: 200,
  routePattern: '/api/health',
  action: 'health',
  outcome: 'ok',
  ...commonContext,
};

const wsEvent: WsSessionEvent = {
  event: 'ws_session',
  connectionId: 'connection-1',
  sessionId: 'session-1',
  playerId: 'player-1',
  isCreator: true,
  isPublished: false,
  connectedAt: '2026-07-27T00:00:00.000Z',
  disconnectedAt: '2026-07-27T00:00:01.000Z',
  duration_ms: 1000,
  messageCount: 1,
  messagesByType: { play: 1 },
  peakConcurrentPlayers: 1,
  playersSeenCount: 1,
  playCount: 1,
  totalPlayTime_ms: 500,
  syncRequestCount: 0,
  syncErrorCount: 0,
  outcome: 'ok',
  disconnectReason: 'normal_close',
  ...commonContext,
};

describe('wide-event emission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits HTTP and WebSocket events by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    emitHttpRequestEvent(httpEvent, {});
    emitWsSessionEvent(wsEvent, {});

    expect(log).toHaveBeenNthCalledWith(1, JSON.stringify(httpEvent));
    expect(log).toHaveBeenNthCalledWith(2, JSON.stringify(wsEvent));
  });

  it('suppresses both event types when the runtime disables log transport', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const env = { OBSERVABILITY_LOGS_ENABLED: 'false' };

    emitHttpRequestEvent(httpEvent, env);
    emitWsSessionEvent(wsEvent, env);

    expect(log).not.toHaveBeenCalled();
  });
});
