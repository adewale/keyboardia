/**
 * Network Mocking Fixtures
 *
 * Provides API and WebSocket mocking for reliable E2E tests.
 * Key insight: mock the backend in CI for determinism, use real backend locally.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test as base, Page, Route } from '@playwright/test';
import { SessionState } from '../test-utils';

/**
 * Mock session data store - simulates backend state
 */
const mockSessions = new Map<string, { state: SessionState; version: number }>();

/**
 * Generate a random session ID
 */
function generateSessionId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Default session state for new sessions
 */
function createDefaultState(): SessionState {
  return {
    tracks: [],
    tempo: 120,
    swing: 0,
    version: 1,
  };
}

/**
 * Mock the sessions API endpoints
 *
 * Intercepts:
 * - POST /api/sessions - Create new session
 * - GET /api/sessions/:id - Get session
 * - PUT /api/sessions/:id - Update session
 * - GET /api/debug/session/:id - Debug endpoint
 */
export async function mockSessionsAPI(page: Page): Promise<void> {
  await page.route('**/api/sessions', async (route: Route) => {
    const method = route.request().method();

    if (method === 'POST') {
      // Create new session
      const body = await route.request().postDataJSON();
      const id = generateSessionId();
      const state: SessionState = {
        tracks: body.tracks || [],
        tempo: body.tempo ?? 120,
        swing: body.swing ?? 0,
        version: body.version ?? 1,
      };
      mockSessions.set(id, { state, version: 1 });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/sessions/*', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Extract session ID from URL
    const match = url.match(/\/api\/sessions\/([^/?]+)/);
    if (!match) {
      await route.continue();
      return;
    }
    const sessionId = match[1];

    if (method === 'GET') {
      const session = mockSessions.get(sessionId);
      if (session) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: sessionId,
            exists: true,
            state: session.state,
          }),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session not found' }),
        });
      }
    } else if (method === 'PUT') {
      const body = await route.request().postDataJSON();
      const existing = mockSessions.get(sessionId);
      if (existing) {
        existing.state = { ...existing.state, ...body };
        existing.version++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session not found' }),
        });
      }
    } else {
      await route.continue();
    }
  });

  // Debug endpoint
  await page.route('**/api/debug/session/*', async (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/debug\/session\/([^/?]+)/);
    if (!match) {
      await route.continue();
      return;
    }
    const sessionId = match[1];
    const session = mockSessions.get(sessionId);

    if (session) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: sessionId,
          state: session.state,
          version: session.version,
          debug: true,
        }),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Session not found' }),
      });
    }
  });
}

/**
 * Create a mock session directly (bypasses API)
 */
export function createMockSession(state?: Partial<SessionState>): string {
  const id = generateSessionId();
  mockSessions.set(id, {
    state: { ...createDefaultState(), ...state },
    version: 1,
  });
  return id;
}

/**
 * Get mock session state
 */
export function getMockSession(id: string): SessionState | undefined {
  return mockSessions.get(id)?.state;
}

/**
 * Clear all mock sessions
 */
export function clearMockSessions(): void {
  mockSessions.clear();
}

/**
 * WebSocket connection tracker for testing connection behavior
 */
export interface WebSocketTracker {
  connectionCount: number;
  messagesSent: string[];
  messagesReceived: string[];
  lastCloseCode?: number;
}

/**
 * Track WebSocket connections and messages
 *
 * Injects a tracking layer to count connections (for detecting connection storms)
 * and log messages (for debugging sync issues).
 */
export async function trackWebSocketConnections(page: Page): Promise<WebSocketTracker> {
  const tracker: WebSocketTracker = {
    connectionCount: 0,
    messagesSent: [],
    messagesReceived: [],
  };

  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket;

    // @ts-expect-error - Overriding WebSocket constructor
    window.WebSocket = class TrackedWebSocket extends RealWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);

        // Track connection
        (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker.connectionCount++;

        // Track messages
        const originalSend = this.send.bind(this);
        this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
          if (typeof data === 'string') {
            (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker.messagesSent.push(data);
          }
          return originalSend(data);
        };

        this.addEventListener('message', (event) => {
          if (typeof event.data === 'string') {
            (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker.messagesReceived.push(event.data);
          }
        });

        this.addEventListener('close', (event) => {
          (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker.lastCloseCode = event.code;
        });
      }
    };

    // Initialize tracker on window
    (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker = {
      connectionCount: 0,
      messagesSent: [],
      messagesReceived: [],
    };
  });

  // Sync tracker state after page interactions
  const getTrackerState = async (): Promise<WebSocketTracker> => {
    return page.evaluate(() => {
      return (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker;
    });
  };

  // Return a proxy that fetches current state
  return new Proxy(tracker, {
    get(target, prop) {
      if (prop === 'then') return undefined; // Not a promise
      // For async access, caller should use getTrackerState
      return target[prop as keyof WebSocketTracker];
    },
  }) as WebSocketTracker;
}

/**
 * Get current WebSocket tracker state from page
 */
export async function getWebSocketTrackerState(page: Page): Promise<WebSocketTracker> {
  return page.evaluate(() => {
    return (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker || {
      connectionCount: 0,
      messagesSent: [],
      messagesReceived: [],
    };
  });
}

/**
 * Network fixture that extends base test with mocking capabilities
 */
export const test = base.extend<{
  mockAPI: () => Promise<void>;
  createMockSession: (state?: Partial<SessionState>) => string;
  wsTracker: () => Promise<WebSocketTracker>;
}>({
  mockAPI: async ({ page }, use) => {
    await use(async () => {
      await mockSessionsAPI(page);
    });
  },

  createMockSession: async ({}, use) => {
    await use((state?: Partial<SessionState>) => {
      return createMockSession(state);
    });

    // Cleanup after test
    clearMockSessions();
  },

  wsTracker: async ({ page }, use) => {
    await trackWebSocketConnections(page);
    await use(async () => getWebSocketTrackerState(page));
  },
});

export { expect } from '@playwright/test';
