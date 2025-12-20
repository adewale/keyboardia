/**
 * GAP-01: Robust MockWebSocket Utility
 *
 * A mock WebSocket implementation for testing multiplayer sync scenarios.
 * Features:
 * - Simulates connection lifecycle (CONNECTING → OPEN → CLOSED)
 * - Message queue for inspection
 * - Event handlers (onopen, onmessage, onclose, onerror)
 * - Configurable latency simulation
 * - Connection failure simulation
 */

export type WebSocketReadyState = 0 | 1 | 2 | 3;

export const WebSocketState = {
  CONNECTING: 0 as const,
  OPEN: 1 as const,
  CLOSING: 2 as const,
  CLOSED: 3 as const,
};

export interface MockWebSocketConfig {
  /** Delay before connection opens (ms) */
  connectDelay?: number;
  /** Simulate connection failure */
  shouldFail?: boolean;
  /** Delay for message sending (ms) */
  messageDelay?: number;
  /** Auto-respond to certain message types */
  autoRespond?: boolean;
}

export interface SentMessage {
  data: string;
  timestamp: number;
}

export class MockWebSocket {
  // WebSocket interface
  readonly url: string;
  readyState: WebSocketReadyState = WebSocketState.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  // Mock-specific properties
  private config: MockWebSocketConfig;
  private sentMessages: SentMessage[] = [];
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Static constants matching WebSocket interface
  static readonly CONNECTING = WebSocketState.CONNECTING;
  static readonly OPEN = WebSocketState.OPEN;
  static readonly CLOSING = WebSocketState.CLOSING;
  static readonly CLOSED = WebSocketState.CLOSED;

  constructor(url: string, _protocols?: string | string[], config: MockWebSocketConfig = {}) {
    this.url = url;
    this.config = config;

    // Simulate async connection
    const connectDelay = config.connectDelay ?? 0;

    this.connectTimeout = setTimeout(() => {
      if (config.shouldFail) {
        this.readyState = WebSocketState.CLOSED;
        this.onerror?.({ type: 'error' } as Event);
        this.onclose?.({
          type: 'close',
          code: 1006,
          reason: 'Connection failed',
          wasClean: false,
        } as CloseEvent);
      } else {
        this.readyState = WebSocketState.OPEN;
        this.onopen?.({ type: 'open' } as Event);
      }
    }, connectDelay);
  }

  /**
   * Send a message through the WebSocket
   */
  send(data: string): void {
    if (this.readyState !== WebSocketState.OPEN) {
      throw new Error('WebSocket is not open');
    }

    const message: SentMessage = {
      data,
      timestamp: Date.now(),
    };
    this.sentMessages.push(message);

    // Auto-respond if configured
    if (this.config.autoRespond) {
      this.autoRespond(data);
    }
  }

  /**
   * Close the WebSocket connection
   */
  close(code: number = 1000, reason: string = 'Normal closure'): void {
    if (this.readyState === WebSocketState.CLOSED) return;

    this.readyState = WebSocketState.CLOSING;

    // Clear any pending connect timeout
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }

    // Async close
    setTimeout(() => {
      this.readyState = WebSocketState.CLOSED;
      this.onclose?.({
        type: 'close',
        code,
        reason,
        wasClean: code === 1000,
      } as CloseEvent);
    }, 0);
  }

  // =============================================================================
  // Mock-specific methods (not part of WebSocket interface)
  // =============================================================================

  /**
   * Simulate receiving a message from the server
   */
  simulateMessage(data: string | object): void {
    if (this.readyState !== WebSocketState.OPEN) return;

    const messageData = typeof data === 'string' ? data : JSON.stringify(data);
    const delay = this.config.messageDelay ?? 0;

    setTimeout(() => {
      if (this.readyState === WebSocketState.OPEN) {
        this.onmessage?.({
          type: 'message',
          data: messageData,
        } as MessageEvent);
      }
    }, delay);
  }

  /**
   * Simulate server-side connection close
   */
  simulateServerClose(code: number = 1000, reason: string = 'Server closed'): void {
    if (this.readyState === WebSocketState.CLOSED) return;

    this.readyState = WebSocketState.CLOSED;
    this.onclose?.({
      type: 'close',
      code,
      reason,
      wasClean: code === 1000,
    } as CloseEvent);
  }

  /**
   * Simulate connection error
   */
  simulateError(message: string = 'Connection error'): void {
    this.onerror?.({
      type: 'error',
      message,
    } as unknown as Event);
  }

  /**
   * Get all sent messages
   */
  getSentMessages(): SentMessage[] {
    return [...this.sentMessages];
  }

  /**
   * Get sent messages of a specific type
   */
  getSentMessagesOfType(type: string): SentMessage[] {
    return this.sentMessages.filter(msg => {
      try {
        const parsed = JSON.parse(msg.data);
        return parsed.type === type;
      } catch {
        return false;
      }
    });
  }

  /**
   * Clear sent message history
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Get the last sent message
   */
  getLastSentMessage(): SentMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Get the last sent message parsed as JSON
   */
  getLastSentMessageParsed<T = unknown>(): T | undefined {
    const last = this.getLastSentMessage();
    if (!last) return undefined;
    try {
      return JSON.parse(last.data) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Auto-respond to certain message types
   */
  private autoRespond(data: string): void {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'clock_sync_request':
          // Respond with clock sync response
          setTimeout(() => {
            this.simulateMessage({
              type: 'clock_sync_response',
              clientTime: msg.clientTime,
              serverTime: Date.now(),
            });
          }, this.config.messageDelay ?? 10);
          break;

        case 'state_hash':
          // Respond with hash match
          setTimeout(() => {
            this.simulateMessage({
              type: 'state_hash_match',
            });
          }, this.config.messageDelay ?? 10);
          break;

        case 'request_snapshot':
          // Respond with minimal snapshot
          setTimeout(() => {
            this.simulateMessage({
              type: 'snapshot',
              state: { tracks: [], tempo: 120, swing: 0, version: 1 },
              players: [],
              playerId: 'test-player',
              snapshotTimestamp: Date.now(),
            });
          }, this.config.messageDelay ?? 10);
          break;
      }
    } catch {
      // Ignore non-JSON messages
    }
  }
}

/**
 * Create a MockWebSocket factory that tracks all created instances
 */
export function createMockWebSocketFactory(config: MockWebSocketConfig = {}) {
  const instances: MockWebSocket[] = [];

  const factory = function MockWebSocketConstructor(url: string, protocols?: string | string[]) {
    const ws = new MockWebSocket(url, protocols, config);
    instances.push(ws);
    return ws;
  } as unknown as typeof WebSocket;

  // Add static properties
  Object.defineProperty(factory, 'CONNECTING', { value: WebSocketState.CONNECTING });
  Object.defineProperty(factory, 'OPEN', { value: WebSocketState.OPEN });
  Object.defineProperty(factory, 'CLOSING', { value: WebSocketState.CLOSING });
  Object.defineProperty(factory, 'CLOSED', { value: WebSocketState.CLOSED });

  return {
    MockWebSocket: factory,
    instances,
    getLastInstance: () => instances[instances.length - 1],
    clearInstances: () => { instances.length = 0; },
  };
}
