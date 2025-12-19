/**
 * Phase 26 GAP-01: Enhanced Mock WebSocket
 *
 * A configurable WebSocket mock for testing various network conditions:
 * - Configurable message delays
 * - Configurable connection drops
 * - Configurable out-of-order delivery
 * - Partial message delivery simulation
 */

export interface MockWebSocketConfig {
  /**
   * Base delay in milliseconds before messages are delivered
   * @default 0
   */
  baseDelay?: number;

  /**
   * Additional random delay variance (0-1)
   * Actual delay = baseDelay + (variance * baseDelay * Math.random())
   * @default 0
   */
  delayVariance?: number;

  /**
   * Probability of dropping a message (0-1)
   * @default 0
   */
  dropRate?: number;

  /**
   * Probability of delivering messages out of order (0-1)
   * @default 0
   */
  outOfOrderRate?: number;

  /**
   * Probability of connection failure during send (0-1)
   * @default 0
   */
  connectionFailRate?: number;

  /**
   * Maximum delay for out-of-order delivery (ms)
   * @default 100
   */
  maxOutOfOrderDelay?: number;
}

type MessageHandler = (event: { data: string }) => void;

interface QueuedMessage {
  data: string;
  timestamp: number;
  seq?: number;
}

export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;

  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  onmessage: MessageHandler | null = null;

  private config: Required<MockWebSocketConfig>;
  private pendingMessages: QueuedMessage[] = [];
  private sentMessages: string[] = [];
  private receivedMessages: string[] = [];
  private messageSeq = 0;
  private closed = false;

  // Peer WebSocket for simulating server responses
  private peer: MockWebSocket | null = null;

  constructor(url: string, config: MockWebSocketConfig = {}) {
    this.url = url;
    this.config = {
      baseDelay: config.baseDelay ?? 0,
      delayVariance: config.delayVariance ?? 0,
      dropRate: config.dropRate ?? 0,
      outOfOrderRate: config.outOfOrderRate ?? 0,
      connectionFailRate: config.connectionFailRate ?? 0,
      maxOutOfOrderDelay: config.maxOutOfOrderDelay ?? 100,
    };

    // Simulate async connection
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      }
    }, 10);
  }

  /**
   * Connect this WebSocket to a peer for simulating server responses
   */
  connectToPeer(peer: MockWebSocket): void {
    this.peer = peer;
    peer.peer = this;
  }

  /**
   * Send a message through this WebSocket
   */
  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

    // Check for simulated connection failure
    if (Math.random() < this.config.connectionFailRate) {
      this.simulateConnectionDrop();
      return;
    }

    this.messageSeq++;
    const message: QueuedMessage = {
      data,
      timestamp: Date.now(),
      seq: this.messageSeq,
    };

    this.sentMessages.push(data);

    // Check if message should be dropped
    if (Math.random() < this.config.dropRate) {
      return; // Message dropped
    }

    // Calculate delay
    let delay = this.config.baseDelay;
    if (this.config.delayVariance > 0) {
      delay += this.config.baseDelay * this.config.delayVariance * Math.random();
    }

    // Check for out-of-order delivery
    if (Math.random() < this.config.outOfOrderRate) {
      delay += Math.random() * this.config.maxOutOfOrderDelay;
    }

    // Queue message for delivery
    setTimeout(() => {
      if (!this.closed) {
        this.deliverToPeer(message);
      }
    }, delay);
  }

  /**
   * Deliver a message to the peer WebSocket
   */
  private deliverToPeer(message: QueuedMessage): void {
    if (this.peer && this.peer.readyState === MockWebSocket.OPEN) {
      this.peer.receiveMessage(message.data);
    }
  }

  /**
   * Receive a message from the peer WebSocket
   */
  receiveMessage(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN || this.closed) {
      return;
    }

    this.receivedMessages.push(data);
    this.onmessage?.({ data });
  }

  /**
   * Simulate a connection drop
   */
  simulateConnectionDrop(): void {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: 'Connection lost' });
  }

  /**
   * Simulate receiving a message directly (for testing)
   */
  simulateReceive(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.receiveMessage(data);
  }

  /**
   * Close the WebSocket
   */
  close(code = 1000, reason = 'Normal closure'): void {
    if (this.closed) return;

    this.closed = true;
    this.readyState = MockWebSocket.CLOSING;

    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    }, 10);
  }

  /**
   * Get all sent messages (for testing assertions)
   */
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  /**
   * Get all received messages (for testing assertions)
   */
  getReceivedMessages(): string[] {
    return [...this.receivedMessages];
  }

  /**
   * Clear message history
   */
  clearHistory(): void {
    this.sentMessages = [];
    this.receivedMessages = [];
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<MockWebSocketConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<MockWebSocketConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a pair of connected MockWebSockets for client-server testing
 */
export function createMockWebSocketPair(
  clientConfig?: MockWebSocketConfig,
  serverConfig?: MockWebSocketConfig
): { client: MockWebSocket; server: MockWebSocket } {
  const client = new MockWebSocket('ws://localhost/test', clientConfig);
  const server = new MockWebSocket('ws://localhost/test', serverConfig);
  client.connectToPeer(server);
  return { client, server };
}

/**
 * Helper to wait for WebSocket to be open
 */
export async function waitForOpen(ws: MockWebSocket): Promise<void> {
  if (ws.readyState === MockWebSocket.OPEN) return;

  return new Promise((resolve, reject) => {
    const originalOnOpen = ws.onopen;
    const originalOnError = ws.onerror;

    ws.onopen = () => {
      ws.onopen = originalOnOpen;
      ws.onerror = originalOnError;
      originalOnOpen?.();
      resolve();
    };

    ws.onerror = (error) => {
      ws.onopen = originalOnOpen;
      ws.onerror = originalOnError;
      originalOnError?.(error);
      reject(error);
    };
  });
}
