# Ghost Avatar Fix Specification

## Problem Statement

When users leave a session open for extended periods (hours/days), the avatar stack accumulates "ghost" avatars that disappear on page refresh. This creates confusion about who is actually present in the session.

### Root Causes

1. **Zombie WebSocket connections**: Connections die without graceful close (network issues, laptop sleep, browser crashes). The server's `this.players` Map only removes players on explicit `webSocketClose()`.

2. **New playerId on every reconnect**: Client reconnects generate a new `crypto.randomUUID()` server-side, creating duplicate player entries instead of resuming the existing identity.

### Current Behavior

```
T=0:     User connects → playerId: abc-123
T=1h:    Network dies (no close event)
T=1h+5s: User reconnects → playerId: def-456 (NEW!)
Result:  Avatar stack shows 2 players (abc-123 zombie + def-456 active)
```

## Solution

A two-part fix addressing both root causes:

### Part 1: sessionStorage for playerId

**Client-side change**: Generate playerId on first connection, store in sessionStorage, reuse on reconnect.

```typescript
// In multiplayer.ts, before WebSocket connection:
const PLAYER_ID_KEY = `keyboardia:playerId:${sessionId}`;

function getOrCreatePlayerId(sessionId: string): string {
  const stored = sessionStorage.getItem(PLAYER_ID_KEY);
  if (stored) return stored;

  const newId = crypto.randomUUID();
  sessionStorage.setItem(PLAYER_ID_KEY, newId);
  return newId;
}

// Connection URL includes playerId:
const playerId = getOrCreatePlayerId(this.sessionId);
const wsUrl = `${protocol}//${host}/api/sessions/${sessionId}/ws?playerId=${playerId}`;
```

**Server-side change**: Accept playerId from query parameter, handle collision by closing old connection.

```typescript
// In live-session.ts webSocketOpen or handleWebSocket:
const url = new URL(request.url);
const requestedPlayerId = url.searchParams.get('playerId') || crypto.randomUUID();

// Close existing connection with same playerId (zombie replacement)
for (const [ws, player] of this.players.entries()) {
  if (player.id === requestedPlayerId && ws !== server) {
    ws.close(1000, 'Replaced by new connection');
    this.players.delete(ws);
    this.playerObservability.delete(ws);
  }
}

const playerId = requestedPlayerId;
```

### Part 2: Server-Side Stale Connection Pruning

**Server-side change**: Prune connections that haven't sent messages within threshold.

```typescript
// Constants (in live-session.ts)
const STALE_CONNECTION_THRESHOLD_MS = 120_000; // 2 minutes
const PRUNE_CHECK_INTERVAL_MS = 60_000; // 1 minute

// State
private lastPruneTime = 0;

// Called at start of webSocketMessage()
private pruneStaleConnections(): void {
  const now = Date.now();

  // Rate limit: only check every PRUNE_CHECK_INTERVAL_MS
  if (now - this.lastPruneTime < PRUNE_CHECK_INTERVAL_MS) return;
  this.lastPruneTime = now;

  const staleConnections: WebSocket[] = [];

  for (const [ws, player] of this.players.entries()) {
    const timeSinceLastMessage = now - player.lastMessageAt;
    if (timeSinceLastMessage > STALE_CONNECTION_THRESHOLD_MS) {
      staleConnections.push(ws);
      console.log(`[PRUNE] Closing stale connection: player=${player.id}, silent for ${Math.round(timeSinceLastMessage / 1000)}s`);
    }
  }

  for (const ws of staleConnections) {
    ws.close(1000, 'Connection stale');
  }
}

// In webSocketMessage(), add at start:
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  this.pruneStaleConnections();
  // ... rest of handler
}
```

## Behavior After Fix

```
T=0:     User connects with playerId: abc-123 (from sessionStorage)
T=1h:    Network dies (no close event)
T=1h+5s: User reconnects with playerId: abc-123 (from sessionStorage)
         Server closes zombie WebSocket, uses new connection
Result:  Avatar stack shows 1 player (abc-123)
```

```
T=0:     User connects with playerId: abc-123
T=1h:    Network dies, user closes laptop
T=1h+2m: Another user sends message, triggers prune
         Zombie abc-123 is closed (2min without messages)
Result:  Avatar stack shows only active players
```

## Thresholds Rationale

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `STALE_CONNECTION_THRESHOLD_MS` | 120,000 (2 min) | Industry standard (Google Docs, PartyKit). With 5s clock sync, this allows 24 missed heartbeats. |
| `PRUNE_CHECK_INTERVAL_MS` | 60,000 (1 min) | Balance between responsiveness and CPU. Worst case: zombie visible for 3 minutes. |

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Tab refresh | Same playerId (sessionStorage survives refresh) |
| Tab close + reopen | New playerId (sessionStorage cleared) |
| Multiple tabs same session | Different playerId per tab (correct) |
| Background tab playing music | Stays connected (audio keeps tab active, clock sync continues) |
| Mobile browser suspends tab | Pruned after 2min, reconnects with same ID when foregrounded |
| Laptop sleep/wake | Reconnects with same ID, old zombie closed or pruned |
| Network switch (wifi→cellular) | Reconnects with same ID |

## Files to Modify

1. **`app/src/sync/multiplayer.ts`**
   - Add `getOrCreatePlayerId()` function
   - Modify WebSocket URL construction to include `?playerId=`

2. **`app/src/worker/live-session.ts`**
   - Parse `playerId` from query parameter
   - Add zombie replacement logic (close old WS with same playerId)
   - Add `pruneStaleConnections()` method
   - Call prune at start of `webSocketMessage()`

3. **`app/src/worker/index.ts`** (if needed)
   - Ensure query params are passed through to DO

## Testing Strategy

See "Testing Plan" section below.

---

# Testing Plan

## Unit Tests

### 1. sessionStorage playerId generation (`multiplayer.test.ts`)

```typescript
describe('getOrCreatePlayerId', () => {
  beforeEach(() => sessionStorage.clear());

  it('generates new ID on first call', () => {
    const id = getOrCreatePlayerId('session-1');
    expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  });

  it('returns same ID on subsequent calls for same session', () => {
    const id1 = getOrCreatePlayerId('session-1');
    const id2 = getOrCreatePlayerId('session-1');
    expect(id1).toBe(id2);
  });

  it('returns different IDs for different sessions', () => {
    const id1 = getOrCreatePlayerId('session-1');
    const id2 = getOrCreatePlayerId('session-2');
    expect(id1).not.toBe(id2);
  });
});
```

### 2. Stale connection pruning (`live-session.test.ts`)

```typescript
describe('pruneStaleConnections', () => {
  it('does not prune connections within threshold', () => {
    const player = createMockPlayer({ lastMessageAt: Date.now() - 60_000 }); // 1 min ago
    session.players.set(mockWs, player);

    session.pruneStaleConnections();

    expect(mockWs.close).not.toHaveBeenCalled();
  });

  it('prunes connections beyond threshold', () => {
    const player = createMockPlayer({ lastMessageAt: Date.now() - 150_000 }); // 2.5 min ago
    session.players.set(mockWs, player);

    session.pruneStaleConnections();

    expect(mockWs.close).toHaveBeenCalledWith(1000, 'Connection stale');
  });

  it('respects rate limiting', () => {
    session.pruneStaleConnections(); // First call
    session.pruneStaleConnections(); // Immediate second call

    // Should only execute once (rate limited)
    expect(pruneExecutionCount).toBe(1);
  });
});
```

### 3. Zombie replacement (`live-session.test.ts`)

```typescript
describe('playerId collision handling', () => {
  it('closes existing connection when new one connects with same playerId', async () => {
    const oldWs = createMockWebSocket();
    const newWs = createMockWebSocket();

    // First connection
    await session.handleWebSocket(createRequest('?playerId=abc-123'), oldWs);

    // Second connection with same playerId
    await session.handleWebSocket(createRequest('?playerId=abc-123'), newWs);

    expect(oldWs.close).toHaveBeenCalledWith(1000, 'Replaced by new connection');
    expect(session.players.has(oldWs)).toBe(false);
    expect(session.players.has(newWs)).toBe(true);
  });

  it('preserves identity properties on reconnect', async () => {
    // Reconnecting player should keep same color/animal
    // (generated deterministically from playerId)
  });
});
```

## Integration Tests

### 4. MockDurableObject tests (`mock-durable-object.test.ts`)

```typescript
describe('Ghost avatar prevention', () => {
  it('reconnecting player replaces zombie connection', () => {
    const ws1 = mockDO.connect('player-abc');
    const ws2 = mockDO.connect('player-abc'); // Same ID

    expect(mockDO.getPlayerCount()).toBe(1); // Not 2
  });

  it('stale connections are pruned on activity', async () => {
    const zombieWs = mockDO.connect('zombie');

    // Simulate time passing
    jest.advanceTimersByTime(150_000); // 2.5 minutes

    // Another player sends a message (triggers prune)
    const activeWs = mockDO.connect('active');
    activeWs.send(JSON.stringify({ type: 'clock_sync_request', clientTime: Date.now() }));

    expect(mockDO.getPlayerCount()).toBe(1); // Zombie pruned
  });
});
```

## E2E Tests

### 5. Playwright tests (`e2e/ghost-avatar.spec.ts`)

```typescript
test.describe('Ghost avatar fix', () => {
  test('reconnecting user sees same avatar count', async ({ page, context }) => {
    // Connect to session
    await page.goto('/s/test-session');
    await expect(page.locator('[data-testid="avatar-stack"]')).toHaveCount(1);

    // Simulate disconnect by blocking WebSocket
    await context.route('**/ws', route => route.abort());

    // Wait for reconnect attempt
    await page.waitForTimeout(2000);

    // Re-enable WebSocket
    await context.unroute('**/ws');

    // Should still show 1 avatar (not 2)
    await expect(page.locator('[data-testid="avatar-stack"]')).toHaveCount(1);
  });

  test('multiple tabs show correct avatar count', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/s/test-session');
    await page2.goto('/s/test-session');

    // Each tab should see 2 players (themselves + other tab)
    await expect(page1.locator('[data-testid="player-count"]')).toHaveText('2');
    await expect(page2.locator('[data-testid="player-count"]')).toHaveText('2');
  });
});
```

## Manual Testing Checklist

### Scenario 1: Network Reconnect
- [ ] Open session in browser
- [ ] Note avatar color/animal
- [ ] Disconnect network (airplane mode or DevTools offline)
- [ ] Wait 5 seconds
- [ ] Reconnect network
- [ ] Verify: Same avatar, count = 1

### Scenario 2: Page Refresh
- [ ] Open session, note playerId in DevTools (sessionStorage)
- [ ] Refresh page
- [ ] Verify: Same playerId in sessionStorage
- [ ] Verify: Avatar count = 1

### Scenario 3: Multi-Tab
- [ ] Open session in Tab 1
- [ ] Open same session in Tab 2
- [ ] Verify: Each tab shows 2 players
- [ ] Verify: Different playerIds in each tab's sessionStorage

### Scenario 4: Long Session (Zombie Pruning)
- [ ] Open session in two browsers (different machines or incognito)
- [ ] In Browser A, disconnect network
- [ ] In Browser B, continue interacting
- [ ] Wait 3 minutes
- [ ] In Browser B, verify avatar count = 1 (Browser A pruned)

### Scenario 5: Background Tab with Audio
- [ ] Open session, start playback
- [ ] Switch to another tab, wait 3 minutes
- [ ] Return to session tab
- [ ] Verify: Still connected (not pruned because audio kept it active)

## Metrics to Monitor Post-Deploy

1. **Ghost avatar reports**: Should drop to zero
2. **`player_left` events without corresponding `webSocketClose`**: Indicates pruning working
3. **Connection replacement logs**: `[PRUNE] Closing stale connection` in worker logs
4. **Reconnect frequency**: May increase slightly (acceptable)
