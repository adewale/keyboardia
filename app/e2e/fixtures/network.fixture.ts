/**
 * WebSocket observation fixtures.
 *
 * Session HTTP requests deliberately go through the configured backend:
 * either the real Worker or Vite's single offline backend. Keeping a second
 * Playwright route implementation here previously let CI exercise a different
 * request/response contract from production.
 */
/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, Page } from '@playwright/test';

export interface WebSocketTracker {
  connectionCount: number;
  messagesSent: string[];
  messagesReceived: string[];
  lastCloseCode?: number;
}

/**
 * Wrap the browser's real WebSocket constructor to observe connections and
 * messages without implementing transport or server behavior.
 */
export async function trackWebSocketConnections(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket;

    // @ts-expect-error - Test instrumentation preserves the WebSocket surface.
    window.WebSocket = class TrackedWebSocket extends RealWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const tracker = (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker;
        tracker.connectionCount++;

        const originalSend = this.send.bind(this);
        this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
          if (typeof data === 'string') tracker.messagesSent.push(data);
          return originalSend(data);
        };

        this.addEventListener('message', (event) => {
          if (typeof event.data === 'string') tracker.messagesReceived.push(event.data);
        });
        this.addEventListener('close', (event) => {
          tracker.lastCloseCode = event.code;
        });
      }
    };

    (window as unknown as { __wsTracker: WebSocketTracker }).__wsTracker = {
      connectionCount: 0,
      messagesSent: [],
      messagesReceived: [],
    };
  });
}

export async function getWebSocketTrackerState(page: Page): Promise<WebSocketTracker> {
  return page.evaluate(() => (
    (window as unknown as { __wsTracker?: WebSocketTracker }).__wsTracker ?? {
      connectionCount: 0,
      messagesSent: [],
      messagesReceived: [],
    }
  ));
}

export const test = base.extend<{
  wsTracker: () => Promise<WebSocketTracker>;
}>({
  wsTracker: async ({ page }, use) => {
    await trackWebSocketConnections(page);
    await use(async () => getWebSocketTrackerState(page));
  },
});

export { expect } from '@playwright/test';
