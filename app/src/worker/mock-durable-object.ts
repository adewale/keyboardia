/**
 * Phase 7: Mock Durable Object for local development and testing
 *
 * This mock simulates a LiveSession Durable Object without requiring
 * Cloudflare infrastructure. It enables:
 *
 * 1. Local development with WebSocket simulation
 * 2. Multi-client integration testing
 * 3. Network failure simulation
 * 4. Latency testing
 */

import type { SessionState } from './types';

export interface MockWebSocket {
  id: string;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: Error) => void) | null;
}

export interface MockMessage {
  type: string;
  playerId: string;
  payload?: unknown;
  timestamp: number;
}

/**
 * Mock LiveSession Durable Object
 *
 * Simulates the server-side WebSocket handling that will be implemented
 * in Phase 8 (Cloudflare Backend Setup) and Phase 9 (Multiplayer State Sync).
 */
export class MockLiveSession {
  private clients: Map<string, MockWebSocket> = new Map();
  private state: SessionState;
  private messageHistory: MockMessage[] = [];
  private simulatedLatency: number = 0;
  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private sessionId: string;

  constructor(sessionId: string, initialState?: SessionState) {
    this.sessionId = sessionId;
    this.state = initialState ?? {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    };
  }

  /**
   * Get current session state
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected player IDs
   */
  getConnectedPlayers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Connect a new client
   */
  connect(playerId: string): MockWebSocket {
    if (this.clients.size >= 10) {
      throw new Error('Maximum connections reached (10)');
    }

    const ws: MockWebSocket = {
      id: playerId,
      readyState: 1, // OPEN
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data: string) => {
        // Simulate latency
        setTimeout(() => {
          this.handleMessage(playerId, data);
        }, this.simulatedLatency);
      },
      close: (code = 1000, reason = 'Normal closure') => {
        this.disconnect(playerId, code, reason);
      },
    };

    this.clients.set(playerId, ws);

    // Log connection
    this.messageHistory.push({
      type: 'connect',
      playerId,
      timestamp: Date.now(),
    });

    // Send current state to new client
    setTimeout(() => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: 'state_sync',
            state: this.state,
            playerCount: this.clients.size,
          }),
        });
      }
    }, this.simulatedLatency);

    // Notify other clients
    this.broadcast(
      { type: 'player_joined', playerId, playerCount: this.clients.size },
      playerId
    );

    return ws;
  }

  /**
   * Disconnect a client
   */
  disconnect(playerId: string, code: number = 1000, reason: string = 'Normal closure'): void {
    const ws = this.clients.get(playerId);
    if (ws) {
      ws.readyState = 3; // CLOSED
      if (ws.onclose) {
        ws.onclose({ code, reason });
      }
      this.clients.delete(playerId);

      // Log disconnection
      this.messageHistory.push({
        type: 'disconnect',
        playerId,
        payload: { code, reason },
        timestamp: Date.now(),
      });

      // Notify other clients
      this.broadcast(
        { type: 'player_left', playerId, playerCount: this.clients.size },
        playerId
      );
    }
  }

  /**
   * Handle incoming message from a client
   */
  private handleMessage(playerId: string, data: string): void {
    try {
      const message = JSON.parse(data);

      // Log message
      this.messageHistory.push({
        type: message.type,
        playerId,
        payload: message,
        timestamp: Date.now(),
      });

      switch (message.type) {
        case 'toggle_step':
          this.handleToggleStep(playerId, message);
          break;
        case 'set_tempo':
          this.handleSetTempo(playerId, message);
          break;
        case 'set_swing':
          this.handleSetSwing(playerId, message);
          break;
        case 'mute_track':
          this.handleMuteTrack(playerId, message);
          break;
        case 'play':
          this.handlePlay(playerId);
          break;
        case 'stop':
          this.handleStop(playerId);
          break;
        case 'state_hash':
          this.handleStateHash(playerId, message);
          break;
        default:
          console.log(`[MockDO] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[MockDO] Error handling message from ${playerId}:`, error);
    }
  }

  /**
   * Handle toggle_step message
   */
  private handleToggleStep(playerId: string, message: { trackId: number; step: number }): void {
    const track = this.state.tracks[message.trackId];
    if (track) {
      track.steps[message.step] = !track.steps[message.step];
      this.broadcast({
        type: 'step_toggled',
        playerId,
        trackId: message.trackId,
        step: message.step,
        value: track.steps[message.step],
      });
    }
  }

  /**
   * Handle set_tempo message
   */
  private handleSetTempo(playerId: string, message: { tempo: number }): void {
    this.state.tempo = message.tempo;
    this.broadcast({
      type: 'tempo_changed',
      playerId,
      tempo: message.tempo,
    });
  }

  /**
   * Handle set_swing message
   */
  private handleSetSwing(playerId: string, message: { swing: number }): void {
    this.state.swing = message.swing;
    this.broadcast({
      type: 'swing_changed',
      playerId,
      swing: message.swing,
    });
  }

  /**
   * Handle mute_track message
   */
  private handleMuteTrack(playerId: string, message: { trackId: number; muted: boolean }): void {
    const track = this.state.tracks[message.trackId];
    if (track) {
      track.muted = message.muted;
      this.broadcast({
        type: 'track_muted',
        playerId,
        trackId: message.trackId,
        muted: message.muted,
      });
    }
  }

  /**
   * Handle play message
   */
  private handlePlay(playerId: string): void {
    this.isPlaying = true;
    this.broadcast({
      type: 'playback_started',
      playerId,
      startStep: this.currentStep,
      serverTime: Date.now(),
    });
  }

  /**
   * Handle stop message
   */
  private handleStop(playerId: string): void {
    this.isPlaying = false;
    this.broadcast({
      type: 'playback_stopped',
      playerId,
    });
  }

  /**
   * Handle state_hash message (for consistency verification)
   */
  private handleStateHash(playerId: string, message: { hash: string }): void {
    // In production, compare with server hash and report mismatches
    console.log(`[MockDO] State hash from ${playerId}: ${message.hash}`);
  }

  /**
   * Broadcast a message to all clients (or all except sender)
   */
  broadcast(message: unknown, excludePlayerId?: string): void {
    const data = JSON.stringify(message);

    for (const [playerId, ws] of this.clients.entries()) {
      if (playerId === excludePlayerId) continue;
      if (ws.readyState !== 1) continue;

      setTimeout(() => {
        if (ws.onmessage) {
          ws.onmessage({ data });
        }
      }, this.simulatedLatency);
    }
  }

  /**
   * Simulate network latency
   */
  simulateLatency(ms: number): void {
    this.simulatedLatency = ms;
  }

  /**
   * Simulate disconnect for a specific player (for testing)
   */
  simulateDisconnect(playerId: string): void {
    this.disconnect(playerId, 1006, 'Connection lost');
  }

  /**
   * Get message history for debugging
   */
  getMessageHistory(): MockMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Clear message history
   */
  clearMessageHistory(): void {
    this.messageHistory = [];
  }

  /**
   * Get debug info
   */
  getDebugInfo(): {
    sessionId: string;
    connectedPlayers: number;
    isPlaying: boolean;
    currentStep: number;
    simulatedLatency: number;
    messageCount: number;
  } {
    return {
      sessionId: this.sessionId,
      connectedPlayers: this.clients.size,
      isPlaying: this.isPlaying,
      currentStep: this.currentStep,
      simulatedLatency: this.simulatedLatency,
      messageCount: this.messageHistory.length,
    };
  }
}

/**
 * Create a new mock session for testing
 */
export function createMockSession(
  sessionId: string = 'test-session',
  initialState?: SessionState
): MockLiveSession {
  return new MockLiveSession(sessionId, initialState);
}

/**
 * Create multiple mock clients connected to the same session
 */
export function createMockClients(
  session: MockLiveSession,
  count: number
): MockWebSocket[] {
  const clients: MockWebSocket[] = [];
  for (let i = 0; i < count; i++) {
    clients.push(session.connect(`player-${i}`));
  }
  return clients;
}
