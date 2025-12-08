# Session Lifecycle & Sharing Specification

## Overview

This document defines the session state machine, sharing modes, remix lineage, orphan handling, and admin observability requirements.

---

## Session State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

     Landing (/)
          │
          │ [New Session]
          ▼
    ┌───────────┐     GET /s/{id}      ┌───────────┐
    │  CREATE   │◄─────────────────────│   LOAD    │
    │  SESSION  │      (404)           │  SESSION  │
    └─────┬─────┘                      └─────┬─────┘
          │                                  │
          │ POST /api/sessions               │ GET /api/sessions/{id}
          │                                  │
          ▼                                  ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │                      ACTIVE SESSION                             │
    │                         /s/{id}                                 │
    │                                                                 │
    │   ┌─────────────────────────────────────────────────────────┐   │
    │   │  State: tracks, tempo, swing, parameterLocks            │   │
    │   │  Auto-save: PUT /api/sessions/{id} (debounced 2s)       │   │
    │   └─────────────────────────────────────────────────────────┘   │
    │                                                                 │
    └────────┬──────────────┬──────────────┬──────────────┬───────────┘
             │              │              │              │
             ▼              ▼              ▼              ▼
        [Invite]      [Send Copy]      [Remix]        [New]
             │              │              │              │
             │              │              │              │
             ▼              ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
      │ Copy URL │   │ Create   │   │ Create   │   │ Create   │
      │ to clip  │   │ remix,   │   │ remix,   │   │ empty    │
      │          │   │ copy URL │   │ redirect │   │ session  │
      │ Stay     │   │          │   │ to remix │   │          │
      │ here     │   │ Stay     │   │          │   │ Redirect │
      │          │   │ here     │   │ Back btn │   │ to it    │
      └──────────┘   └──────────┘   │ returns  │   └──────────┘
                                    └──────────┘
```

---

## Sharing Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHARING MODES                                        │
└─────────────────────────────────────────────────────────────────────────────┘

                         My Session (A)
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
     [Invite]           [Send Copy]           [Remix]
          │                   │                   │
          │                   │                   │
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │ Clipboard │       │ Clipboard │       │ Navigate  │
    │    (A)    │       │    (B)    │       │   to B    │
    └─────┬─────┘       └─────┬─────┘       └─────┬─────┘
          │                   │                   │
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │ Recipient │       │ Recipient │       │ I'm now   │
    │ joins MY  │       │ gets COPY │       │ editing   │
    │ session   │       │ (B)       │       │ copy (B)  │
    └───────────┘       └───────────┘       └───────────┘
          │                   │                   │
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │ We both   │       │ They edit │       │ Original  │
    │ edit A    │       │ B alone   │       │ (A) is    │
    │ together  │       │ (theirs   │       │ unchanged │
    │           │       │ to remix) │       │           │
    └───────────┘       └───────────┘       └───────────┘
```

---

## Three Sharing Modes

| Action | What Happens | URL Copied | User Redirected? | Recipient Gets |
|--------|--------------|------------|------------------|----------------|
| **Invite** | Copies current URL | Current session URL | No | Live collaborative session |
| **Send Copy** | Creates remix, copies remix URL | New session URL | No (stay on current) | Their own editable copy to remix |
| **Remix** | Creates remix, navigates to it | N/A | Yes → new session | N/A (for yourself) |

### Invite (live collaboration)

"Come jam with me in real-time."

```
1. User clicks [Invite]
2. Copy current URL to clipboard: /s/{current-id}
3. Toast: "Session link copied! Anyone with this link can edit."
4. No navigation, no API call
5. Recipient opens link → joins same session
6. (Future: WebSocket sync for real-time collaboration)
```

**UI State:**
- Button shows checkmark briefly
- Toast confirms copy
- No URL change

### Send Copy (give someone a copy to remix)

"Check out what I made — here's your own copy to remix."

```
1. User clicks [Send Copy]
2. POST /api/sessions/{id}/remix
3. Server creates new session (remixedFrom: originalId)
4. Response: { id: "new-uuid", url: "/s/new-uuid" }
5. Copy NEW URL to clipboard: /s/new-uuid
6. User stays on current session (no navigation)
7. Toast: "Copy link sent! Recipients get their own version to remix."
```

**UI State:**
- Button shows loading during API call
- Toast confirms with the new URL
- URL does NOT change (user stays on their session)
- Recipient gets independent session to edit/remix

### Remix (for yourself)

"I want to experiment without affecting my original."

```
1. User clicks [Remix]
2. POST /api/sessions/{id}/remix
3. Server creates new session (remixedFrom: originalId)
4. Response: { id: "new-uuid", url: "/s/new-uuid" }
5. Client navigates to /s/new-uuid (pushState, adds to history)
6. User is now editing the remix
7. Browser back button → returns to original session
```

**UI State:**
- Remix button shows loading state during API call
- URL changes to new session
- Toast: "Remixed! You're now editing a copy."

---

## Remix Lineage

### Data Model

```typescript
interface Session {
  // ... other fields
  remixedFrom: string | null;    // Parent session ID
  remixCount: number;            // How many times this was remixed
}
```

### Remix Tree Structure

```
                    Original Session
                         (root)
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
           Remix A       Remix B       Remix C
              │                         │
              │                    ┌────┴────┐
              ▼                    ▼         ▼
           Remix A1              Remix C1   Remix C2
                                             │
                                             ▼
                                          Remix C2a
```

### UI Display

Show remix lineage in the session header:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🎵 Untitled Session                                    [Invite] [Send   │
│  ↳ Remixed from "Funky Beat" • 3 remixes                 Copy] [Remix]   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Lineage Display Rules:**
- If `remixedFrom` is set: Show "Remixed from {parent name}" with link to parent
- If `remixCount > 0`: Show "{n} remixes" (indicates popularity)
- Parent name fetched on load (cache in session, fallback to "Unknown Session" if deleted)

**Clicking the parent link:**
- Opens parent session in same tab
- User can navigate back to their session via browser back button

---

## URL Management & Browser History

### Navigation Patterns

| Action | History Entry | Browser Back Behavior |
|--------|---------------|----------------------|
| New Session | `pushState` | Returns to previous page (outside app) |
| Load Session | `replaceState` | Previous page |
| Remix | `pushState` | Returns to original session |
| Invite | None | No change |
| Send Copy | None | No change |
| Edit (auto-save) | None | No change |

### URL Structure

```
/                     → Landing/new session (redirects to /s/{new-id})
/s/{uuid}             → Load existing session
/s/{uuid}?remix=true  → (Optional) Auto-remix on load (for "remix this" links)
```

### Handling Invalid Sessions

```
1. User navigates to /s/{invalid-id}
2. GET /api/sessions/{id} returns 404
3. Show error: "Session not found"
4. Options:
   - [Create New Session] → POST /api/sessions, redirect
   - [Go Home] → navigate to /
5. Do NOT auto-redirect (user may want to fix URL typo)
```

---

## Session Lifecycle

### Creation

```typescript
// New empty session
POST /api/sessions
Body: {} (optional initial state)
Response: { id, url, createdAt }

// Remix existing session (used by both Remix and Send Copy)
POST /api/sessions/{id}/remix
Response: { id, url, remixedFrom, createdAt }
```

### Active Editing

```typescript
// Auto-save (debounced 2s after last change)
PUT /api/sessions/{id}
Body: { state: { tracks, tempo, swing, ... } }
Response: { id, updatedAt }
```

### Lifecycle Events

| Event | Trigger | Side Effects |
|-------|---------|--------------|
| Created | POST /api/sessions | Increment session count |
| Loaded | GET /api/sessions/{id} | Update lastAccessedAt |
| Edited | PUT /api/sessions/{id} | Update updatedAt |
| Remixed | POST /api/sessions/{id}/remix | Create new, link to parent, increment parent's remixCount |
| Deleted | DELETE /api/sessions/{id} | Decrement session count |

---

## Orphan Detection & Handling

Sessions inactive for 90+ days are considered "orphaned" and flagged for review.

### Definition

```typescript
const ORPHAN_THRESHOLD_DAYS = 90;
const isOrphaned = (session: Session) => {
  const daysSinceAccess = (Date.now() - session.lastAccessedAt) / (1000 * 60 * 60 * 24);
  return daysSinceAccess >= ORPHAN_THRESHOLD_DAYS;
};
```

### Where Orphans Are Displayed

#### 1. Admin Dashboard (tagged/filterable)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ADMIN: Session List                                    Filter: [Orphaned ▾]│
├─────────────────────────────────────────────────────────────────────────────┤
│  ID          │ Created    │ Last Accessed │ Status     │ Actions           │
│──────────────│────────────│───────────────│────────────│───────────────────│
│  abc123...   │ 2025-06-01 │ 2025-06-15    │ 🟠 Orphan  │ [View] [Delete]   │
│  def456...   │ 2025-08-01 │ 2025-08-20    │ 🟠 Orphan  │ [View] [Delete]   │
│  ghi789...   │ 2025-12-01 │ 2025-12-05    │ 🟢 Active  │ [View] [Delete]   │
└─────────────────────────────────────────────────────────────────────────────┘

Orphaned sessions: 456 of 1,234 total (37%)
[Export Orphans] [Bulk Delete Orphans]
```

#### 2. Session Banner (shown to users accessing orphaned session)

When a user opens a session that hasn't been accessed in 90+ days:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️ This session hasn't been used in over 90 days.                      [✕] │
│    It's still here! Editing will mark it as active again.                   │
└─────────────────────────────────────────────────────────────────────────────┘
│                                                                             │
│                        [Normal session UI below]                            │
```

**Banner Behavior:**
- Dismissible (click X to close)
- Auto-dismissed after first edit (session becomes active again)
- Only shown once per session load (localStorage flag)
- Informational only — no action required from user

### Orphan Handling Policy

| Action | Who Can Do It | What Happens |
|--------|---------------|--------------|
| View orphan list | Admin only | `/admin/sessions?filter=orphaned` |
| Export orphans | Admin only | Download JSON of all orphaned sessions |
| Delete orphan | Admin only | Permanent deletion after confirmation |
| Bulk delete orphans | Admin only | Delete all orphans older than N days |
| Revive orphan | Any user | Access session → updates lastAccessedAt → no longer orphaned |

**Note:** Orphans are NEVER auto-deleted. Admin must explicitly review and delete.

---

## Data Model

```typescript
interface Session {
  // Identity
  id: string;                    // UUID v4
  createdAt: number;             // Unix timestamp (ms)
  updatedAt: number;             // Unix timestamp (ms)
  lastAccessedAt: number;        // For orphan detection

  // Provenance
  remixedFrom: string | null;     // Parent session ID
  remixedFromName: string | null; // Cached parent name (for display)
  remixCount: number;             // How many times this was remixed

  // State
  state: SessionState;

  // Metadata (future)
  ownerId: string | null;        // When auth is added (Phase 10)
  isPublic: boolean;             // Default true (anyone with link can access)
}
```

---

## Admin Dashboard Requirements

### Authentication

Admin endpoints require authentication via **BetterAuth** (Phase 10).

```typescript
// Admin role check
const isAdmin = await betterAuth.hasRole(request, 'admin');
if (!isAdmin) {
  return new Response('Forbidden', { status: 403 });
}
```

### Session Metrics

| Metric | Description | Query |
|--------|-------------|-------|
| Total Sessions | All sessions in KV | `SESSIONS.list()` count |
| Active Sessions (24h) | Sessions accessed in last 24h | Filter by lastAccessedAt |
| Created Today | Sessions created today | Filter by createdAt |
| Orphaned Sessions | No access in 90+ days | Filter by lastAccessedAt |
| Remix Tree Depth | Max remix chain length | Traverse remixedFrom |

### Storage Costs

```typescript
interface StorageMetrics {
  totalSessions: number;
  totalSizeBytes: number;           // Sum of all session JSON sizes
  averageSessionSizeBytes: number;

  // KV costs (approximation)
  estimatedMonthlyCost: {
    storage: number;    // $0.50/GB/month
    reads: number;      // $0.50/million
    writes: number;     // $5.00/million
  };
}
```

### Dashboard Endpoints

```
GET /admin/metrics
Authorization: Bearer {BetterAuth token}

Response:
{
  "sessions": {
    "total": 1234,
    "activeToday": 89,
    "createdToday": 12,
    "orphaned90Days": 456
  },
  "storage": {
    "totalBytes": 5242880,
    "averageBytes": 4251
  },
  "costs": {
    "storageMonthly": 0.0025,
    "estimatedReadsMonthly": 0.05,
    "estimatedWritesMonthly": 0.10
  }
}
```

### Admin UI Features

1. **Session List**
   - Paginated table of sessions
   - Columns: ID (truncated), created, updated, lastAccessed, size, remixCount, status
   - Sort by any column
   - Filter: orphaned, active, created date range

2. **Session Detail**
   - Full session JSON (readonly)
   - Remix tree visualization
   - Access history (if tracked)
   - [Delete] button with confirmation

3. **Bulk Actions**
   - Export all sessions (JSON)
   - Export orphaned sessions
   - Delete orphaned sessions (with confirmation + age threshold)
   - Recalculate storage metrics

4. **Alerts**
   - Storage approaching limit
   - Unusual session creation rate (potential abuse)
   - Large sessions (> 100KB)

---

## UI Component Changes

### Header Buttons

```
[Invite] [Send Copy] [Remix] [New]
```

| Button | Icon | Action | Toast Message |
|--------|------|--------|---------------|
| Invite | 🔗 | Copy current session URL | "Session link copied! Anyone with this link can edit." |
| Send Copy | 📤 | Create remix, copy remix URL, stay here | "Copy link sent! Recipients get their own version to remix." |
| Remix | 🍴 | Create remix, navigate to it | "Remixed! You're now editing a copy." |
| New | ✨ | Create empty session, navigate to it | (No toast, just navigate) |

### Remix Lineage Display

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🎵 Untitled Session                                                     │
│  ↳ Remixed from "Parent Session Name" • 3 remixes                       │
└──────────────────────────────────────────────────────────────────────────┘
```

- "Remixed from" links to parent session
- "N remixes" shows remix count (social proof)
- If parent deleted: "Remixed from an unknown session"

### Orphan Banner

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠️ This session hasn't been used in over 90 days.                      [✕] │
│    It's still here! Editing will mark it as active again.                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Lifecycle (Current)
- [x] Create session
- [x] Load session
- [x] Auto-save
- [x] Remix (with redirect)
- [ ] Add lastAccessedAt tracking
- [ ] Add remixCount tracking

### Phase 2: Send Copy & Lineage
- [ ] Implement Send Copy button (remix + clipboard, no redirect)
- [ ] Rename Share → Invite
- [ ] Display remix lineage in header ("Remixed from X")
- [ ] Show remix count ("N remixes")

### Phase 3: Orphan Handling
- [ ] Calculate orphan status on session load
- [ ] Display orphan banner in session UI
- [ ] Add orphan filter to admin dashboard
- [ ] Bulk export/delete orphans in admin

### Phase 4: Admin Dashboard (with BetterAuth)
- [ ] Integrate BetterAuth for admin auth
- [ ] Implement /admin/metrics endpoint
- [ ] Implement /admin/sessions list endpoint
- [ ] Build admin UI

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Naming for "share a copy" | **Send Copy** | Clear, action-oriented, pairs with "remix" language |
| Remix indicator in UI | **Yes** | "Remixed from X" with link to parent |
| Orphan handling | **Flag only** | Admin dashboard + session banner, no auto-delete |
| Admin auth | **BetterAuth** | Already planned for Phase 10 |
