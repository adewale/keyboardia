#!/usr/bin/env npx tsx
/**
 * Staging E2E Test Tool
 *
 * Comprehensive end-to-end testing for staging deployments.
 * Covers: API endpoints, WebSocket connections, hybrid persistence,
 * multi-player sync, and error handling.
 *
 * Usage:
 *   npx tsx scripts/staging-e2e-test.ts [--env staging|production]
 *
 * Examples:
 *   npx tsx scripts/staging-e2e-test.ts                    # Test staging
 *   npx tsx scripts/staging-e2e-test.ts --env production   # Test production
 */

import WebSocket from 'ws';

// =============================================================================
// Configuration
// =============================================================================

const args = process.argv.slice(2);
const envArg = args.find(a => a.startsWith('--env='))?.split('=')[1] ||
               (args.includes('--env') ? args[args.indexOf('--env') + 1] : 'staging');

const ENVIRONMENTS: Record<string, string> = {
  staging: 'https://keyboardia-staging.adewale-883.workers.dev',
  production: 'https://keyboardia.adewale-883.workers.dev',
  local: 'http://localhost:8788',
};

const BASE_URL = ENVIRONMENTS[envArg] || ENVIRONMENTS.staging;
const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
const API_BASE_URL = `${BASE_URL}/api`;

// =============================================================================
// Types
// =============================================================================

interface SessionTrack {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  muted: boolean;
  soloed?: boolean;
  transpose: number;
  stepCount?: number;
}

interface SessionState {
  tracks: SessionTrack[];
  tempo: number;
  swing: number;
  version: number;
}

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

// =============================================================================
// Test Runner
// =============================================================================

class StagingTestRunner {
  private results: TestResult[] = [];
  private sessionIds: string[] = [];

  async run(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              STAGING E2E TEST SUITE                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Environment: ${envArg}`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`WebSocket URL: ${WS_BASE_URL}`);
    console.log('');
    console.log('─'.repeat(70));

    // Run all test categories
    await this.runApiTests();
    await this.runWebSocketTests();
    await this.runHybridPersistenceTests();
    await this.runMultiPlayerTests();

    // Cleanup
    await this.cleanup();

    // Print summary
    this.printSummary();
  }

  // ===========================================================================
  // API Tests
  // ===========================================================================

  private async runApiTests(): Promise<void> {
    console.log('\n📡 API ENDPOINT TESTS\n');

    await this.runTest('POST /api/sessions - Create session', async () => {
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { tracks: [], tempo: 120, swing: 0, version: 1 } }),
      });
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      const data = await response.json() as { id: string };
      if (!data.id) throw new Error('No session ID returned');
      this.sessionIds.push(data.id);
      return `Created session: ${data.id.slice(0, 8)}...`;
    });

    await this.runTest('GET /api/sessions/:id - Get session', async () => {
      if (!this.sessionIds[0]) throw new Error('No session to get');
      const response = await fetch(`${API_BASE_URL}/sessions/${this.sessionIds[0]}`);
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      const data = await response.json() as { state: SessionState };
      if (!data.state) throw new Error('No state in response');
      return `Got session with tempo: ${data.state.tempo}`;
    });

    await this.runTest('PATCH /api/sessions/:id - Update session', async () => {
      if (!this.sessionIds[0]) throw new Error('No session to update');
      const response = await fetch(`${API_BASE_URL}/sessions/${this.sessionIds[0]}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Session' }),
      });
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      return 'Updated session name';
    });
  }

  // ===========================================================================
  // WebSocket Tests
  // ===========================================================================

  private async runWebSocketTests(): Promise<void> {
    console.log('\n🔌 WEBSOCKET TESTS\n');

    await this.runTest('WebSocket connect and receive snapshot', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);
      if (!player.sessionState) throw new Error('No snapshot received');
      player.disconnect();
      return `Received snapshot with ${player.sessionState.tracks.length} tracks`;
    });

    await this.runTest('WebSocket add track and receive broadcast', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);

      const trackId = `test-${Date.now()}`;
      await player.addTrack(this.createTrack(trackId));

      // Wait for state to be updated
      await this.delay(100);

      if (!player.sessionState!.tracks.find(t => t.id === trackId)) {
        throw new Error('Track not added');
      }
      player.disconnect();
      return `Added track: ${trackId.slice(0, 20)}...`;
    });

    await this.runTest('WebSocket toggle step and receive broadcast', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);

      const trackId = `test-${Date.now()}`;
      await player.addTrack(this.createTrack(trackId));
      await this.delay(100);
      await player.toggleStep(trackId, 0);
      await this.delay(100);

      const track = player.sessionState!.tracks.find(t => t.id === trackId);
      if (!track?.steps[0]) throw new Error('Step not toggled');
      player.disconnect();
      return 'Step 0 toggled on';
    });
  }

  // ===========================================================================
  // Hybrid Persistence Tests
  // ===========================================================================

  private async runHybridPersistenceTests(): Promise<void> {
    console.log('\n💾 HYBRID PERSISTENCE TESTS\n');

    await this.runTest('DO storage preserves state across reconnection', async () => {
      const sessionId = await this.createSession();
      const player1 = await this.connectPlayer(sessionId);

      // Make changes
      const trackId = `persist-${Date.now()}`;
      await player1.addTrack(this.createTrack(trackId));
      await this.delay(100);
      // Toggle 8 steps (matches old test volume)
      for (let i = 0; i < 8; i++) {
        await player1.toggleStep(trackId, i);
      }

      // Wait for all broadcasts to be processed
      await this.delay(200);

      const expectedSteps = player1.sessionState!.tracks[0]?.steps.filter(s => s).length ?? 0;
      player1.disconnect();

      await this.delay(500);

      // Reconnect
      const player2 = await this.connectPlayer(sessionId);
      const reconnectSteps = player2.sessionState!.tracks[0]?.steps.filter(s => s).length ?? 0;
      player2.disconnect();

      if (reconnectSteps !== expectedSteps) {
        throw new Error(`Expected ${expectedSteps} steps, got ${reconnectSteps}`);
      }
      return `${expectedSteps} steps preserved across reconnection`;
    });

    await this.runTest('KV is stale during active session', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);

      // Make changes (matches old test: track + 4 step toggles)
      const trackId = `stale-${Date.now()}`;
      await player.addTrack(this.createTrack(trackId));
      for (let step = 0; step < 4; step++) {
        await player.toggleStep(trackId, step);
      }
      await this.delay(200);

      // Check KV (should be stale despite multiple mutations)
      const kvState = await this.getSessionFromKV(sessionId);
      player.disconnect();

      if (kvState.tracks.length !== 0) {
        throw new Error(`Expected 0 tracks in KV, got ${kvState.tracks.length}`);
      }
      return 'KV correctly stale during session (1 track + 4 step mutations)';
    });

    await this.runTest('KV updated after last client disconnects', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);

      // Make changes - toggle specific steps for position verification
      const trackId = `flush-${Date.now()}`;
      await player.addTrack(this.createTrack(trackId));
      await player.toggleStep(trackId, 0);
      await player.toggleStep(trackId, 4);
      await this.delay(100);

      // GAP 1 FIX: Check KV BEFORE disconnect (must be stale)
      const kvBefore = await this.getSessionFromKV(sessionId);
      if (kvBefore.tracks.length !== 0) {
        throw new Error(`KV should be stale before disconnect, got ${kvBefore.tracks.length} tracks`);
      }

      player.disconnect();
      await this.delay(1000); // Wait for KV flush

      // Check KV AFTER disconnect (should be updated)
      const kvAfter = await this.getSessionFromKV(sessionId);
      if (kvAfter.tracks.length !== 1) {
        throw new Error(`Expected 1 track in KV, got ${kvAfter.tracks.length}`);
      }

      // GAP 2 FIX: Verify exact step positions, not just count
      const track = kvAfter.tracks[0];
      if (!track.steps[0] || !track.steps[4]) {
        const activePositions = track.steps.map((s, i) => s ? i : null).filter(x => x !== null);
        throw new Error(`Expected steps [0,4] active, got: [${activePositions}]`);
      }
      const activeCount = track.steps.filter(s => s).length;
      if (activeCount !== 2) {
        throw new Error(`Expected exactly 2 active steps, got ${activeCount}`);
      }

      return 'KV: 0 tracks → disconnect → 1 track with steps [0,4]';
    });

    // GAP 3 FIX: High-volume stress test (matches old test volume)
    await this.runTest('Rapid mutations all persisted to DO storage', async () => {
      const sessionId = await this.createSession();
      const player = await this.connectPlayer(sessionId);

      // Add 5 tracks rapidly (matches old test volume)
      const trackIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const trackId = `rapid-${Date.now()}-${i}`;
        trackIds.push(trackId);
        await player.addTrack(this.createTrack(trackId));
      }

      // Toggle 3 steps on each track (15 step mutations)
      for (const trackId of trackIds) {
        await player.toggleStep(trackId, 0);
        await player.toggleStep(trackId, 4);
        await player.toggleStep(trackId, 8);
      }

      await this.delay(100);

      // Verify player state reflects all mutations
      if (player.sessionState!.tracks.length !== 5) {
        throw new Error(`Expected 5 tracks, got ${player.sessionState!.tracks.length}`);
      }

      const totalActiveSteps = player.sessionState!.tracks.reduce(
        (sum, t) => sum + t.steps.filter(s => s).length, 0
      );
      if (totalActiveSteps !== 15) {
        throw new Error(`Expected 15 active steps, got ${totalActiveSteps}`);
      }

      // Disconnect and reconnect to verify DO persistence
      player.disconnect();
      await this.delay(500);

      const player2 = await this.connectPlayer(sessionId);

      if (player2.sessionState!.tracks.length !== 5) {
        throw new Error(`Reconnect: expected 5 tracks, got ${player2.sessionState!.tracks.length}`);
      }

      const reconnectSteps = player2.sessionState!.tracks.reduce(
        (sum, t) => sum + t.steps.filter(s => s).length, 0
      );
      if (reconnectSteps !== 15) {
        throw new Error(`Reconnect: expected 15 active steps, got ${reconnectSteps}`);
      }

      player2.disconnect();
      return '20 mutations (5 tracks × 4 ops), 15 steps preserved';
    });
  }

  // ===========================================================================
  // Multi-Player Tests
  // ===========================================================================

  private async runMultiPlayerTests(): Promise<void> {
    console.log('\n👥 MULTI-PLAYER TESTS\n');

    await this.runTest('Two players see same state', async () => {
      const sessionId = await this.createSession();
      const player1 = await this.connectPlayer(sessionId);

      // Player 1 adds track
      const trackId = `multi-${Date.now()}`;
      await player1.addTrack(this.createTrack(trackId));

      // Player 2 connects
      const player2 = await this.connectPlayer(sessionId);

      if (!player2.sessionState!.tracks.find(t => t.id === trackId)) {
        throw new Error('Player 2 missing track added by Player 1');
      }

      player1.disconnect();
      player2.disconnect();
      return 'Both players see same track';
    });

    await this.runTest('Player 2 receives Player 1 changes', async () => {
      const sessionId = await this.createSession();
      const player1 = await this.connectPlayer(sessionId);
      const player2 = await this.connectPlayer(sessionId);

      // Player 1 adds track (both should receive broadcast)
      const trackId = `sync-${Date.now()}`;
      await player1.addTrack(this.createTrack(trackId));
      await this.delay(200);

      if (!player2.sessionState!.tracks.find(t => t.id === trackId)) {
        throw new Error('Player 2 did not receive broadcast');
      }

      player1.disconnect();
      player2.disconnect();
      return 'Broadcasts received by all players';
    });

    // GAP 4 FIX: Enhanced multi-client disconnect timing with explicit assertions
    await this.runTest('KV stays stale until LAST client disconnects', async () => {
      const sessionId = await this.createSession();
      const player1 = await this.connectPlayer(sessionId);

      // Player 1 adds track
      const trackId = `multi-stale-${Date.now()}`;
      await player1.addTrack(this.createTrack(trackId));
      await this.delay(100);

      // Player 2 connects
      const player2 = await this.connectPlayer(sessionId);

      // Verify Player 2 sees the track via snapshot
      if (player2.sessionState!.tracks.length !== 1) {
        throw new Error(`Player 2 should see 1 track, got ${player2.sessionState!.tracks.length}`);
      }

      // Player 1 disconnects, but Player 2 is STILL connected
      player1.disconnect();
      await this.delay(500);

      // INVARIANT: KV must STILL be stale because Player 2 is connected
      const kvMidway = await this.getSessionFromKV(sessionId);
      if (kvMidway.tracks.length !== 0) {
        throw new Error(
          `INVARIANT VIOLATED: KV updated while Player 2 still connected! ` +
          `Expected 0 tracks, got ${kvMidway.tracks.length}`
        );
      }

      // Player 2 disconnects (LAST client)
      player2.disconnect();
      await this.delay(1000);

      // NOW KV should be updated (last client left)
      const kvFinal = await this.getSessionFromKV(sessionId);
      if (kvFinal.tracks.length !== 1) {
        throw new Error(`KV not updated after last client! Expected 1 track, got ${kvFinal.tracks.length}`);
      }

      return 'P1 leaves → KV stale (0) → P2 leaves → KV updated (1)';
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async runTest(name: string, fn: () => Promise<string>): Promise<void> {
    const start = Date.now();
    try {
      const message = await fn();
      const duration = Date.now() - start;
      this.results.push({ name, passed: true, message, duration });
      console.log(`  ✅ ${name} (${duration}ms)`);
      console.log(`     └─ ${message}`);
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, message, duration });
      console.log(`  ❌ ${name} (${duration}ms)`);
      console.log(`     └─ ${message}`);
    }
  }

  private async createSession(): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { tracks: [], tempo: 120, swing: 0, version: 1 } }),
    });
    if (!response.ok) throw new Error(`Failed to create session: ${response.status}`);
    const data = await response.json() as { id: string };
    this.sessionIds.push(data.id);
    return data.id;
  }

  private async getSessionFromKV(sessionId: string): Promise<SessionState> {
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
    if (!response.ok) throw new Error(`Failed to get session: ${response.status}`);
    const data = await response.json() as { state: SessionState };
    return data.state;
  }

  private async connectPlayer(sessionId: string): Promise<TestPlayer> {
    const player = new TestPlayer(sessionId);
    await player.connect();
    return player;
  }

  private createTrack(id: string): SessionTrack {
    return {
      id,
      name: `Track ${id}`,
      sampleId: 'kick',
      steps: Array(16).fill(false),
      parameterLocks: Array(16).fill(null),
      volume: 1,
      muted: false,
      soloed: false,
      transpose: 0,
      stepCount: 16,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    // Sessions will naturally expire, no cleanup needed
  }

  private printSummary(): void {
    console.log('\n' + '═'.repeat(70));
    console.log('SUMMARY');
    console.log('═'.repeat(70));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\nTotal: ${total} tests | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
    console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);

    if (failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      for (const result of this.results.filter(r => !r.passed)) {
        console.log(`   • ${result.name}: ${result.message}`);
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log(failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
    console.log('═'.repeat(70));

    process.exit(failed === 0 ? 0 : 1);
  }
}

// =============================================================================
// Test Player Class
// =============================================================================

type ServerMessage =
  | { type: 'snapshot'; state: SessionState; playerId: string }
  | { type: 'step_toggled'; trackId: string; step: number; value: boolean }
  | { type: 'track_added'; track: SessionTrack }
  | { type: 'error'; message: string };

class TestPlayer {
  private ws: WebSocket | null = null;
  private messageQueue: ServerMessage[] = [];
  private messageWaiters: ((msg: ServerMessage) => void)[] = [];
  public sessionState: SessionState | null = null;
  public playerId: string | null = null;
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${WS_BASE_URL}/api/sessions/${this.sessionId}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (msg.type === 'snapshot') {
          this.sessionState = msg.state;
          this.playerId = msg.playerId;
          resolve();
        } else {
          if (msg.type === 'step_toggled' && this.sessionState) {
            const track = this.sessionState.tracks.find(t => t.id === msg.trackId);
            if (track) track.steps[msg.step] = msg.value;
          } else if (msg.type === 'track_added' && this.sessionState) {
            this.sessionState.tracks.push(msg.track);
          }
        }

        const waiter = this.messageWaiters.shift();
        if (waiter) waiter(msg);
        else this.messageQueue.push(msg);
      });

      this.ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async waitForMessage(): Promise<ServerMessage> {
    const queued = this.messageQueue.shift();
    if (queued) return queued;
    return new Promise(resolve => {
      this.messageWaiters.push(resolve);
    });
  }

  async addTrack(track: SessionTrack): Promise<void> {
    this.send({ type: 'add_track', track });
    await this.waitForMessage();
  }

  async toggleStep(trackId: string, step: number): Promise<void> {
    this.send({ type: 'toggle_step', trackId, step });
    await this.waitForMessage();
  }
}

// =============================================================================
// Run Tests
// =============================================================================

const runner = new StagingTestRunner();
runner.run().catch(console.error);
