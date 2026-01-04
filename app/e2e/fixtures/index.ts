/**
 * Test Fixtures Index
 *
 * Export all fixtures for easy importing in tests.
 */

export {
  test as networkTest,
  mockSessionsAPI,
  createMockSession,
  getMockSession,
  clearMockSessions,
  trackWebSocketConnections,
  getWebSocketTrackerState,
  type WebSocketTracker,
} from './network.fixture';

export {
  test as sessionTest,
  createTrack,
  waitForSessionLoad,
  verifySessionState,
  DEFAULT_TRACKS,
  type TrackData,
  type SessionFixture,
  type SessionWithTracksFixture,
} from './session.fixture';

export {
  test as multiplayerTest,
  navigateBothClients,
  waitForSync,
  verifyStepSync,
  verifyTrackCountSync,
  simulateDisconnect,
  simulateReconnect,
  simulateSlowNetwork,
  resetNetworkConditions,
  type TwoClientFixture,
} from './multiplayer.fixture';
