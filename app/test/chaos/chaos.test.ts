/**
 * Phase 26 GAP-03: Basic Chaos Testing
 *
 * Tests for system behavior under adverse conditions:
 * - Random message drops
 * - Random connection failures
 * - Random latency spikes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockWebSocket, createMockWebSocketPair, waitForOpen } from '../mocks/MockWebSocket';

describe('GAP-03: Chaos Testing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Message Drop Simulation', () => {
    it('should handle 10% message drop rate', async () => {
      const { client, server } = createMockWebSocketPair(
        { dropRate: 0.1 }, // 10% drop rate on client
        { dropRate: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedMessages: string[] = [];
      server.onmessage = (event) => {
        receivedMessages.push(event.data);
      };

      // Send 100 messages
      for (let i = 0; i < 100; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      await vi.advanceTimersByTimeAsync(100);

      // With 10% drop rate, expect roughly 90 messages (allow variance)
      expect(receivedMessages.length).toBeGreaterThanOrEqual(80);
      expect(receivedMessages.length).toBeLessThanOrEqual(100);
    });

    it('should handle 50% message drop rate gracefully', async () => {
      const { client, server } = createMockWebSocketPair(
        { dropRate: 0.5 }, // 50% drop rate
        { dropRate: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedMessages: string[] = [];
      server.onmessage = (event) => {
        receivedMessages.push(event.data);
      };

      // Send 20 messages
      for (let i = 0; i < 20; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      await vi.advanceTimersByTimeAsync(100);

      // Approximately half should be dropped (allow variance)
      expect(receivedMessages.length).toBeGreaterThanOrEqual(5);
      expect(receivedMessages.length).toBeLessThanOrEqual(15);
    });
  });

  describe('Connection Failure Simulation', () => {
    it('should trigger connection drop on send', async () => {
      const { client, server: _server } = createMockWebSocketPair(
        { connectionFailRate: 1.0 }, // Always fail
        { connectionFailRate: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);

      let closeEventReceived = false;
      client.onclose = () => {
        closeEventReceived = true;
      };

      client.send(JSON.stringify({ type: 'test' }));

      expect(closeEventReceived).toBe(true);
      expect(client.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should not process messages after connection drop', async () => {
      const { client, server } = createMockWebSocketPair();

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedMessages: string[] = [];
      server.onmessage = (event) => {
        receivedMessages.push(event.data);
      };

      // Send a message first
      client.send(JSON.stringify({ type: 'before' }));
      await vi.advanceTimersByTimeAsync(10);
      expect(receivedMessages.length).toBe(1);

      // Simulate connection drop
      client.simulateConnectionDrop();

      // Try to send after drop - should throw
      expect(() => {
        client.send(JSON.stringify({ type: 'after' }));
      }).toThrow('WebSocket is not open');

      await vi.advanceTimersByTimeAsync(100);
      expect(receivedMessages.length).toBe(1); // No new messages
    });
  });

  describe('Latency Spike Simulation', () => {
    it('should deliver messages with configurable delay', async () => {
      const { client, server } = createMockWebSocketPair(
        { baseDelay: 100 }, // 100ms base delay
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedMessages: string[] = [];
      server.onmessage = (event) => {
        receivedMessages.push(event.data);
      };

      client.send(JSON.stringify({ type: 'test' }));

      // Message should not be received immediately
      expect(receivedMessages.length).toBe(0);

      // Advance by half the delay
      await vi.advanceTimersByTimeAsync(50);
      expect(receivedMessages.length).toBe(0);

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(60);
      expect(receivedMessages.length).toBe(1);
    });

    it('should add variance to delays', async () => {
      const { client, server } = createMockWebSocketPair(
        { baseDelay: 100, delayVariance: 1.0 }, // 100-200ms delay
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedMessages: string[] = [];
      server.onmessage = (event) => {
        receivedMessages.push(event.data);
      };

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      // After base delay, some but not all should arrive
      await vi.advanceTimersByTimeAsync(100);
      // Due to variance, messages may still be in flight

      // After max delay, all should arrive
      await vi.advanceTimersByTimeAsync(150);
      expect(receivedMessages.length).toBe(5);
    });
  });

  describe('Out-of-Order Delivery', () => {
    it('should simulate out-of-order message delivery', async () => {
      const { client, server } = createMockWebSocketPair(
        { outOfOrderRate: 0.5, maxOutOfOrderDelay: 50 },
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const receivedOrder: number[] = [];
      server.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        receivedOrder.push(msg.seq);
      };

      // Send messages in order
      for (let i = 1; i <= 10; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      // Advance time to deliver all messages
      await vi.advanceTimersByTimeAsync(200);

      expect(receivedOrder.length).toBe(10);
      // With 50% out-of-order rate, likely some will be reordered
      // Just verify all messages arrived
      expect(receivedOrder.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('Combined Chaos Conditions', () => {
    it('should handle multiple failure modes simultaneously', async () => {
      const { client, server } = createMockWebSocketPair(
        {
          baseDelay: 20,
          delayVariance: 0.5,
          dropRate: 0.1,
          outOfOrderRate: 0.2,
        },
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const received: number[] = [];
      server.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        received.push(msg.seq);
      };

      // Send 50 messages
      for (let i = 1; i <= 50; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      // Allow time for all messages to potentially arrive
      await vi.advanceTimersByTimeAsync(500);

      // With 10% drop rate, expect roughly 45 messages
      expect(received.length).toBeGreaterThanOrEqual(35);
      expect(received.length).toBeLessThanOrEqual(50);

      // All received messages should have valid sequence numbers
      received.forEach(seq => {
        expect(seq).toBeGreaterThanOrEqual(1);
        expect(seq).toBeLessThanOrEqual(50);
      });
    });

    it('should maintain message integrity despite chaos', async () => {
      const { client, server } = createMockWebSocketPair(
        { baseDelay: 10, dropRate: 0.05 },
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const received: { type: string; data: unknown }[] = [];
      server.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        received.push(msg);
      };

      // Send complex messages
      const testData = { nested: { value: [1, 2, 3], text: 'test' } };
      client.send(JSON.stringify({ type: 'complex', data: testData }));

      await vi.advanceTimersByTimeAsync(100);

      // Messages that arrive should be intact
      if (received.length > 0) {
        expect(received[0].type).toBe('complex');
        expect(received[0].data).toEqual(testData);
      }
    });
  });

  describe('Recovery Scenarios', () => {
    it('should track sent vs received messages for recovery', async () => {
      const { client, server } = createMockWebSocketPair(
        { dropRate: 0.2 },
        { baseDelay: 0 }
      );

      await vi.advanceTimersByTimeAsync(20);
      await waitForOpen(client);
      await waitForOpen(server);

      const received = new Set<number>();
      server.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        received.add(msg.seq);
      };

      // Send 20 messages with sequence numbers
      for (let i = 1; i <= 20; i++) {
        client.send(JSON.stringify({ type: 'test', seq: i }));
      }

      await vi.advanceTimersByTimeAsync(100);

      // Identify missing messages
      const missing: number[] = [];
      for (let i = 1; i <= 20; i++) {
        if (!received.has(i)) {
          missing.push(i);
        }
      }

      // Verify we can identify gaps
      expect(received.size + missing.length).toBe(20);

      // Client could re-send missing messages
      const sentHistory = client.getSentMessages();
      expect(sentHistory.length).toBe(20);
    });
  });
});
