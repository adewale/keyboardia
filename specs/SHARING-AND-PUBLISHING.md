# Sharing & Publishing Specification

## Overview

Keyboardia uses a simplified sharing model with one core concept: **Sessions**. Sessions can be either editable (for collaboration) or published (immutable, for broadcast).

### Design Principles

1. **One entity type** — Everything is a Session
2. **Immutability at birth** — Published sessions are frozen at creation, not toggled
3. **Fork-based workflow** — Remix to get an editable copy of anything
4. **Clear intent** — Each action has a distinct purpose

---

## Core Concepts

### Session

A Session is the only first-class entity in Keyboardia. It contains tracks, tempo, swing, and all musical state.

```typescript
interface Session {
  id: string;                      // UUID v4
  name: string | null;             // User-editable name
  immutable: boolean;              // true = published (frozen forever)

  // Provenance
  remixedFrom: string | null;      // Parent session ID
  remixedFromName: string | null;  // Cached parent name for display
  remixCount: number;              // Times this session was remixed

  // Timestamps
  createdAt: number;               // Unix timestamp (ms)
  updatedAt: number;               // Unix timestamp (ms)
  lastAccessedAt: number;          // For orphan detection

  // Musical state
  state: SessionState;
}
```

### Editable vs Published

| Aspect | Editable Session | Published Session |
|--------|------------------|-------------------|
| `immutable` | `false` | `true` |
| Can edit | Yes | No |
| Can collaborate (Invite) | Yes | No |
| Can be remixed | Yes | Yes |
| Can publish from | Yes | No (already published) |
| Purpose | Working/jamming | Sharing finished work |

**Key insight:** You cannot convert an editable session to published. You can only create a published copy. This ensures your working session is always preserved.

---

## Four Actions

| Action | What It Does | Creates Copy? | Immutable? | Copies URL? | Navigates? |
|--------|--------------|:-------------:|:----------:|:-----------:|:----------:|
| **Publish** | Create frozen copy for broadcast | Yes | Yes | Yes | No |
| **Invite** | Share URL for real-time collaboration | No | N/A | Yes | No |
| **Remix** | Create editable copy for yourself | Yes | No | No | Yes |
| **New** | Create empty session | Yes | No | No | Yes |

### Publish

"Here's my finished work."

```
1. User clicks [Publish]
2. POST /api/sessions/{id}/publish
3. Server creates new session with immutable: true
4. Copy new URL to clipboard
5. User stays on current (editable) session
6. Toast: "Published! Link copied."
```

**Use cases:**
- Sharing on Twitter/social media
- Posting in Discord
- Building a portfolio
- Any 1:many broadcast

### Invite

"Come collaborate with me."

```
1. User clicks [Invite]
2. Copy current session URL to clipboard
3. Toast: "Session link copied! Anyone with this link can edit."
```

**Use cases:**
- Real-time jam sessions
- Working with trusted collaborators
- Pair music-making

**Warning:** Only use Invite with people you trust. Anyone with the link can edit.

### Remix

"I want to riff on this."

```
1. User clicks [Remix]
2. POST /api/sessions/{id}/remix
3. Server creates new session with immutable: false
4. Navigate to new session URL
5. Toast: "Remixed! You're now editing your own copy."
```

**Use cases:**
- Making your own variation of a published session
- Forking a collaborative session to experiment
- Creating a backup before major changes

### New

"Start fresh."

```
1. User clicks [New]
2. POST /api/sessions
3. Navigate to new session URL
```

---

## Sharing Patterns

### 1:1 (One creator → One recipient)

| Use Case | Flow |
|----------|------|
| "Check out what I made" | Publish → send URL → they view |
| "Here's a beat for you" | Publish → send URL → they Remix |
| "Let's work together" | Invite → real-time collaboration |

### 1:Many (One creator → Many recipients)

| Use Case | Flow |
|----------|------|
| Post on Twitter | Publish → share URL |
| Discord announcement | Publish → share URL |
| Portfolio piece | Publish → embed/link |

One URL, many viewers, nobody can vandalize. **This is the core Publish use case.**

### M:N (Many creators → Many recipients)

| Use Case | Flow |
|----------|------|
| Band jam → release | Invite (collaborate) → Publish (release) |
| Classroom project | Invite (students work) → Publish (present) |
| Open jam → showcase | Invite (create together) → Publish (share result) |

**Pattern: Invite for creation, Publish for distribution.**

### Versioning

You can publish multiple snapshots from the same working session:

```
Working Session (editable)
    ├── Publish → "v1" (immutable, Dec 1)
    ├── Publish → "v2" (immutable, Dec 5)
    └── Publish → "v3" (immutable, Dec 10)
```

Each Publish creates a new immutable snapshot. Your working session continues evolving.

### Remix Trees

Published sessions become stable branch points:

```
Alice's Working Session
    └── Published Beat (immutable)
            ├── Bob's Remix (editable)
            │       └── Bob publishes (immutable)
            ├── Carol's Remix (editable)
            └── Dave's Remix (editable)
```

---

## User Interface

### Editable Session UI

```
┌─────────────────────────────────────────────────────────────────┐
│  🎵 Working Draft                [Publish][Invite][Remix][New]  │
│  Remixed from "Original" • 3 remixes                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Full step sequencer - interactive]                            │
│                                                                 │
│  Tempo: [120] BPM    Swing: [15%]                              │
└─────────────────────────────────────────────────────────────────┘
```

All four action buttons visible. Full editing capability.

### Published Session UI

```
┌─────────────────────────────────────────────────────────────────┐
│  🎵 Funky Beat                                     [Remix][New] │
│  📢 Published • 47 remixes                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Step sequencer - visible but not interactive]                 │
│                                                                 │
│  Tempo: 120 BPM    Swing: 15%    [▶ Play]                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  💡 Want to edit? Click Remix to create your own copy   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key differences:**
- "📢 Published" badge (not "readonly" — matches the action name)
- No Publish button (already published)
- No Invite button (can't collaborate on published)
- Remix is primary action for visitors
- Playback works normally
- Step grid visible but not clickable
- Educational prompt guides users to Remix

### Teaching Affordances

Users arriving at a published session may expect to edit. We need clear guidance:

#### 1. Published Badge
Prominent "📢 Published" indicator signals this isn't a normal editing session.

#### 2. Disabled Controls with Visual Feedback
- Step grid cells don't respond to clicks
- Hover shows "not-allowed" cursor
- Subtle visual dimming of interactive elements

#### 3. Contextual Prompt
Persistent but dismissible hint:
```
💡 Want to edit? Click Remix to create your own copy
```

Options for prompt behavior:
- Show on first visit to any published session
- Dismiss permanently after clicking Remix once
- Show briefly when user attempts to click a step

#### 4. Click Interception
When user clicks on a step in a published session:
```
┌────────────────────────────────────────┐
│  This session is published.            │
│                                        │
│  [Remix to Edit]    [Just Viewing]     │
└────────────────────────────────────────┘
```

This intercept:
- Appears only once per visit
- Offers immediate path to editing
- Respects users who just want to view

---

## Lineage Display

### Current Phase (No Authentication)

Display lineage as **text only, no links**:

```
Remixed from "Parent Session Name" • 5 remixes
```

**Why no links:**
- Avoids exposing editable parent sessions to vandalism
- Simpler implementation
- No conditional logic needed

### Future Phase (With Authentication)

Once users have identity and ownership, lineage becomes richer:

```
Remixed from "Parent Session Name" by @alice • 5 remixes
                     ↑
              Clickable link to profile or session
```

**Future lineage features:**

| Feature | Requires | Description |
|---------|----------|-------------|
| Link to parent session | Auth | Safe if parent is also published |
| Link to creator profile | Auth | "@alice" links to their profile |
| Full remix tree view | Auth | Visualize entire ancestry/descendants |
| "Remix credits" | Auth | Published session shows all remixers |
| Notification on remix | Auth | Alert when someone remixes your work |

See [Future: Identity & Lineage](#future-identity--lineage) for detailed designs.

---

## API Endpoints

### Create Session

```
POST /api/sessions
Content-Type: application/json

Request body: (optional)
{
  "state": { ... }
}

Response: 201 Created
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "url": "/s/f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "immutable": false
}
```

### Get Session

```
GET /api/sessions/{uuid}

Response: 200 OK
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "name": "Funky Beat",
  "immutable": false,
  "remixedFrom": null,
  "remixedFromName": null,
  "remixCount": 5,
  "createdAt": 1733400000000,
  "updatedAt": 1733401234567,
  "state": { ... }
}
```

### Update Session

```
PUT /api/sessions/{uuid}
Content-Type: application/json

Request body:
{
  "state": { ... }
}

Response: 200 OK (if immutable: false)
{
  "id": "...",
  "updatedAt": 1733402000000
}

Response: 403 Forbidden (if immutable: true)
{
  "error": "Cannot edit published session"
}
```

### Remix Session (Create Editable Copy)

```
POST /api/sessions/{uuid}/remix

Response: 201 Created
{
  "id": "new-uuid",
  "url": "/s/new-uuid",
  "immutable": false,
  "remixedFrom": "original-uuid"
}
```

### Publish Session (Create Immutable Copy)

```
POST /api/sessions/{uuid}/publish

Response: 201 Created
{
  "id": "new-uuid",
  "url": "/s/new-uuid",
  "immutable": true,
  "remixedFrom": "original-uuid"
}

Response: 400 Bad Request (if source is already immutable)
{
  "error": "Cannot publish from a published session. Use Remix instead."
}
```

### Delete Session

```
DELETE /api/sessions/{uuid}

Response: 204 No Content
```

**Note:** Deletion will require authentication in a future phase to verify ownership.

---

## URL Scheme

```
/                           # Landing → creates new empty session
/s/{uuid}                   # Load session (editable or published)
```

No separate `/b/` or `/p/` routes. Published sessions use the same URL scheme — the `immutable` flag determines behavior.

---

## Data Flow Diagrams

### Publish Flow

```
┌──────────────┐    POST /publish    ┌──────────────┐
│   Editable   │ ─────────────────►  │  Published   │
│   Session    │                     │    Copy      │
│              │                     │              │
│ immutable:   │                     │ immutable:   │
│   false      │                     │   true       │
└──────────────┘                     └──────────────┘
       │                                    │
       │ (unchanged)                        │ (URL copied)
       ▼                                    ▼
   User stays                        Shared publicly
```

### Remix Flow (from Published)

```
┌──────────────┐    POST /remix      ┌──────────────┐
│  Published   │ ─────────────────►  │   Editable   │
│   Session    │                     │     Copy     │
│              │                     │              │
│ immutable:   │                     │ immutable:   │
│   true       │                     │   false      │
└──────────────┘                     └──────────────┘
       │                                    │
       │ (unchanged)                        │ (user navigates here)
       ▼                                    ▼
  Still published                   User's own copy
```

---

## Implementation Checklist

### Phase 1: Core Publishing ⬜ Not Started

- [ ] Add `immutable` field to Session data model
- [ ] Implement `POST /api/sessions/{id}/publish` endpoint
- [ ] Block `PUT` requests on immutable sessions (return 403)
- [ ] Add [Publish] button to editable session UI
- [ ] Remove Publish/Invite buttons from published session UI
- [ ] Show "📢 Published" badge on published sessions

### Phase 2: Published Session UX ⬜ Not Started

- [ ] Disable step grid interactions on published sessions
- [ ] Show "not-allowed" cursor on hover
- [ ] Add educational prompt ("Want to edit? Click Remix")
- [ ] Implement click interception modal
- [ ] Style published sessions distinctly (subtle visual treatment)

### Phase 3: Lineage Display ✅ Partially Complete

- [x] Store `remixedFrom` and `remixedFromName`
- [x] Display lineage text in header
- [x] Track and display `remixCount`
- [ ] Remove lineage links (convert to text-only)

### Phase 4: Button Reordering ⬜ Not Started

Current: `[Invite] [Send Copy] [Remix] [New]`
New: `[Publish] [Invite] [Remix] [New]`

- [ ] Replace "Send Copy" with "Publish"
- [ ] Reorder buttons
- [ ] Update button tooltips
- [ ] Update toast messages

---

## Migration

### Existing Sessions

All existing sessions have `immutable: undefined` or `immutable: false`. No migration needed — they're editable by default.

### "Send Copy" to "Publish"

The existing "Send Copy" flow creates an editable copy. The new "Publish" flow creates an immutable copy. This is a behavior change, not a migration.

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Vandalism of shared sessions | Publish creates immutable copy |
| Lineage traversal attacks | Text-only lineage (no links) |
| Unauthorized publishing | Anyone can publish (no auth yet) |
| Impersonation | Future: require auth for attribution |

---

## Future: Identity & Lineage

When authentication is added (Phase 16+), the sharing model gains new capabilities:

### Ownership

```typescript
interface Session {
  // ... existing fields
  ownerId: string | null;          // User who created this
  ownerName: string | null;        // Cached display name
}
```

### Enhanced Published Session UI

```
┌─────────────────────────────────────────────────────────────────┐
│  🎵 Funky Beat                                     [Remix][New] │
│  📢 Published by @alice • Dec 10, 2025 • 47 remixes             │
│                    ↑                                            │
│              Links to Alice's profile                           │
├─────────────────────────────────────────────────────────────────┤
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Safe Lineage Linking

With authentication, we can safely link to parent sessions:

| Parent State | Link Behavior |
|--------------|---------------|
| Published | Link to parent (safe, immutable) |
| Editable, owned by same user | Link to parent (their own) |
| Editable, owned by other user | Text only (protect their session) |
| Editable, no owner | Text only (protect from vandalism) |

### Remix Notifications

```
┌─────────────────────────────────────────────────────────────────┐
│  🔔 @bob remixed your "Funky Beat"                    [View]    │
└─────────────────────────────────────────────────────────────────┘
```

### Remix Tree Visualization

```
Your Sessions
└── 🎵 Funky Beat (published)
    ├── 🎵 Bob's Remix (by @bob)
    │   └── 🎵 Charlie's Version (by @charlie)
    ├── 🎵 Dance Edit (by @dave)
    └── 🎵 Lo-Fi Mix (by @eve)
```

### Creator Attribution

Published sessions can show remix credits:

```
Remixed by: @bob, @carol, @dave, and 44 others
```

---

## Terminology Reference

| Term | Meaning |
|------|---------|
| **Session** | Any Keyboardia project (editable or published) |
| **Published** | An immutable session, frozen at creation |
| **Editable** | A mutable session that can be modified |
| **Publish** | Create an immutable copy for broadcast |
| **Invite** | Share URL for real-time collaboration |
| **Remix** | Create an editable copy |
| **Lineage** | The parent-child relationship between sessions |

### Deprecated Terms

These terms are **not used** in Keyboardia:

| Deprecated | Why |
|------------|-----|
| Beat | Unnecessary abstraction; use "published session" |
| Share | Ambiguous; use "Publish" or "Invite" |
| Send Copy | Replaced by "Publish" |
| Lock/Unlock | Immutability is permanent, not toggled |
| Readonly | Technical jargon; use "Published" |

---

## Summary

The Keyboardia sharing model is built on four principles:

1. **One concept:** Everything is a Session
2. **Clear actions:** Publish, Invite, Remix, New
3. **Immutability at birth:** Published sessions are frozen forever
4. **Fork-based safety:** Remix to edit anything

This model handles all sharing patterns (1:1, 1:many, M:N) with minimal concepts and maximum clarity.
