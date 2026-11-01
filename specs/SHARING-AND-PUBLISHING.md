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
| **Remix** | Create editable copy for yourself | Yes | No | No | Yes |
| **New** | Create empty session | Yes | No | No | Yes |
| **Invite** | Share URL for real-time collaboration | No | N/A | Yes | No |

**Invite sub-options:**
| Option | What It Does |
|--------|--------------|
| Copy Link | Copy session URL to clipboard (default) |
| Show QR Code | Display scannable QR code for the session URL |

### Button Order & Styling

```
[Publish] [Remix] [New]                                          [Invite]
─────────────────────────                                        ─────────
    Filled buttons                                             Outline button
    (safe actions)                                            (exposes session)
```

**Order rationale:**

| Position | Button | Why |
|----------|--------|-----|
| 1st | **Publish** | Safe sharing is the default — creates protected copy |
| 2nd | **Remix** | Common action — creates your own editable copy |
| 3rd | **New** | Less frequent — grouped with Remix (both create sessions) |
| Last | **Invite** | Intentionally separated — only action that exposes your session |

**Visual distinction for Invite:**
- Outline/ghost button style (not filled)
- Positioned with gap from other buttons
- Signals "this one is different" without hiding it

**Why Invite is last:** It's the only "risky" action — sharing your actual editable session. The visual separation and outline style ensure collaboration is intentional, not accidental. Users who want to collaborate will find it; users sharing publicly will naturally click Publish first.

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

### QR Code Sharing

"Scan to join the jam."

The Invite button includes a **Show QR Code** option that displays a scannable QR code for the current session. This is accessed via a dropdown (desktop) or action sheet (mobile).

```
1. User clicks [Invite ▾] → "Show QR Code"
2. QR overlay appears (adapts to screen size)
3. Others scan → join the live session
4. Music keeps playing — session stays alive
```

**Use cases:**
- Conference booth demos (large screen + QR code)
- Classroom sessions (projector display)
- Quick in-person sharing (phone-to-phone)
- Collaborative events and jam sessions

The QR code is a **presentation layer** over Invite, not a separate sharing flow. It encodes the session URL without any special parameters, so scanners join the exact same session.

> **Full specification:** See [QR-MODIFIER.md](./QR-MODIFIER.md) for complete details on display modes, responsive layouts, component architecture, and implementation.

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
| "Scan my phone" | Invite → Show QR Code → they scan → join live |

### 1:Many (One creator → Many recipients)

| Use Case | Flow |
|----------|------|
| Post on Twitter | Publish → share URL |
| Discord announcement | Publish → share URL |
| Portfolio piece | Publish → embed/link |
| Conference booth demo | Invite → Show QR Code → attendees scan → live jam |
| Classroom session | Invite → Show QR Code (projector) → students scan → collaborative music |

One URL, many viewers, nobody can vandalize. **This is the core Publish use case.**

> **Note:** QR code sharing (via Invite) creates a collaborative session where everyone can edit. For broadcast scenarios where you want to protect the original, Publish first, then share the published URL via QR or link.

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

### Desktop: Editable Session

```
┌───────────────────────────────────────────────────────────────────────────┐
│  🎵 Working Draft          [Publish] [Remix] [New]           [Invite ▾]   │
│  Remixed from "Original" • 3 remixes                          ─────────   │
│                                                                (outline)  │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  [Full step sequencer - interactive]                                      │
│                                                                           │
│  Tempo: [120] BPM    Swing: [15%]                                        │
└───────────────────────────────────────────────────────────────────────────┘

Clicking [Invite ▾] shows dropdown:
┌─────────────────────┐
│  Copy Link          │  ← Copies session URL to clipboard
│  Show QR Code       │  ← Adds ?qr=1 to URL, displays QR overlay
└─────────────────────┘
```

- **Four action buttons:** Publish, Remix, New (filled) + Invite (outline, separated, dropdown)
- **Full editing capability**
- Invite visually distinct to signal "different intent"
- Invite dropdown provides QR code option for in-person sharing

### Desktop: Published Session

```
┌───────────────────────────────────────────────────────────────────────────┐
│  🎵 Funky Beat                                          [Remix] [New]     │
│  Published • 47 remixes                                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  Published • Press play to listen, then remix to make it yours            │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  [Step sequencer - "museum glass" treatment, playhead visible]            │
│                                                                           │
│  Tempo: 120 BPM    Swing: 15%    [▶ Play]                                │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key differences from editable:**
- **"Published" badge** — clear status indicator in header
- **Contextual subtitle** — guides user toward "listen, then remix" flow
- **No Publish button** — already published
- **No Invite button** — can't collaborate on published session
- **No SamplePicker** — can't add tracks
- **Remix is primary** — main action for visitors
- **"Museum glass" grid** — subtle visual treatment signals read-only

### Button Visibility by Session Type

| Session Type | Publish | Remix | New | Invite |
|--------------|:-------:|:-----:|:---:|:------:|
| **Editable** | ✅ | ✅ | ✅ | ✅ (outline) |
| **Published** | — | ✅ (primary) | ✅ | — |

---

## Mobile Layout

Mobile requires different layouts due to limited horizontal space (320-428px viewport).

### Mobile: Editable Session

```
┌─────────────────────────────┐
│ 🎵 Working Draft            │
│ Remixed from "Original"     │
├─────────────────────────────┤
│                             │
│   [Step Sequencer Grid]     │
│                             │
├─────────────────────────────┤
│ [📢]   [🔀]   [✨]    [👥]  │
│ Publish Remix  New   Invite │
│ ───────────────────  ────── │
│      (filled)       (outline)│
└─────────────────────────────┘

Tapping [👥 Invite] opens action sheet:
┌─────────────────────────────┐
│                             │
│   Invite to Session         │
│   ─────────────────────     │
│                             │
│   Copy Link                 │  ← Copies session URL
│   Show QR Code              │  ← Fullscreen QR overlay
│                             │
│   ─────────────────────     │
│   Cancel                    │
│                             │
└─────────────────────────────┘
```

**Mobile adaptations:**
- **Bottom action bar** — buttons in thumb zone for easy reach
- **Icon + label** — compact but clear
- **Same order** — Publish, Remix, New, then Invite (separated)
- **Invite still visually distinct** — outline style, right-aligned
- **Action sheet** — native-feeling on iOS/Android, groups sharing options together

### Mobile: Published Session

```
┌─────────────────────────────┐
│ 🎵 Funky Beat               │
│ 📢 Published • 47 remixes   │
├─────────────────────────────┤
│ 💡 Tap Remix to edit    [✕] │
├─────────────────────────────┤
│                             │
│ [Grid - view only, dimmed]  │
│                             │
├─────────────────────────────┤
│    [🔀 Remix]   [✨ New]    │
└─────────────────────────────┘
```

**Simpler with only 2 buttons:**
- Fits comfortably at any width
- Remix is visually primary (filled)
- New is secondary (outline or smaller)

### Mobile: Published Session Behavior

On mobile, published sessions use the same "museum glass" treatment as desktop:
- Visual scrim overlay communicates read-only state
- Taps on steps are silently ignored (no modal interruption)
- Subtitle guides users toward "listen, then remix" flow
- Remix button remains prominently accessible

> **Design note:** We chose not to implement click interception modals. The listening experience should be uninterrupted — users discover the Remix button naturally when they're ready to edit.

### Mobile Icon Reference

| Action | Icon | Rationale |
|--------|------|-----------|
| **Publish** | 📢 or ↑ | Megaphone = broadcast; Up arrow = upload/share out |
| **Remix** | 🔀 or ⑂ | Shuffle/fork symbol = branching |
| **New** | ✨ or + | Sparkle = fresh start; Plus = create |
| **Invite** | 👥 or 🔗 | People = collaboration; Link = sharing access |

Icons should be recognizable at 24x24px with labels below for clarity.

### Responsive Breakpoints

| Viewport | Layout |
|----------|--------|
| < 480px | Bottom action bar with icons + labels |
| 480-768px | Bottom bar or inline header (context-dependent) |
| > 768px | Inline header buttons (desktop layout) |

---

## Teaching Affordances

Users arriving at a published session may expect to edit. We use a layered approach that communicates read-only status without interrupting the listening experience.

#### 1. Published Badge ✅
Prominent "Published" indicator in the header signals this isn't a normal editing session.

#### 2. Subtitle Context ✅
The subtitle changes from "Click a cell to toggle, then press play" to:
```
Published • Press play to listen, then remix to make it yours
```
This guides users toward the intended flow (listen → remix) without modal interruption.

#### 3. Visual "Museum Glass" Treatment ✅
Published sessions receive subtle visual treatment that signals "look but don't touch":
- Slight desaturation of track controls
- Subtle purple-tinted scrim overlay
- Faint scan-line effect for "frozen in time" aesthetic
- Playhead remains vibrant for clear visibility during playback

#### 4. Hidden Edit Controls ✅
Rather than showing disabled controls, we hide them entirely:
- SamplePicker is not rendered (can't add tracks)
- Invite button is not rendered (can't share for collaboration)
- Publish button is not rendered (already published)
- Session name is disabled (can't rename)

#### 5. Remix as Primary Action ✅
The Remix button becomes the primary call-to-action, positioned prominently. Users who want to edit naturally discover the path forward.

### Design Decision: No Click Interception Modal

We evaluated click interception (showing a modal when users click steps on published sessions) but found better alternatives:

**Why we rejected modals:**
- Interrupts the listening experience — users often just want to hear the beat
- Adds friction before users even understand what the session sounds like
- Mobile bottom sheets feel heavy for a simple "you can't edit this" message
- The visual treatment already communicates read-only status

**Our approach instead:**
- Let clicks fall through silently (pointer-events: none on tracks)
- Visual treatment provides ambient awareness of read-only state
- Subtitle explicitly guides toward "listen, then remix"
- Remix button is always visible and prominent

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

### Phase QR: QR Code Sharing ✅ Complete

> See [QR-MODIFIER.md](./QR-MODIFIER.md) for full specification.

- ✅ Add `qrcode` npm dependency
- ✅ Create QRCode component (SVG generation)
- ✅ Create QROverlay component (3 display modes: large, medium, small)
- ✅ Create QRPanel component (QR + metadata display)
- ✅ Create useQRMode hook (URL state management)
- ✅ Create useDisplayMode hook (responsive breakpoint detection)
- ✅ Handle `?qr=1` URL parameter
- ✅ Integrate QROverlay into App.tsx
- ✅ Keyboard navigation (Escape to close)
- ✅ Session name and player count display
- ✅ Copy Link button in QR panel
- ✅ Responsive CSS for all display modes
- ✅ Add "Show QR Code" to Invite dropdown (desktop)
- [ ] Add "Show QR Code" to Invite action sheet (mobile)

### Phase 1: Core Publishing ✅ Complete

- ✅ Add `immutable` field to Session data model
- ✅ Implement `POST /api/sessions/{id}/publish` endpoint
- ✅ Block `PUT` requests on immutable sessions (return 403)
- ✅ Block `PATCH` requests on immutable sessions (return 403)
- ✅ Block WebSocket mutations on immutable sessions
- ✅ Add [Publish] button to editable session UI
- ✅ Remove Publish/Invite buttons from published session UI
- ✅ Show "Published" badge on published sessions

### Phase 2: Published Session UX ✅ Complete

- ✅ Disable step grid interactions on published sessions (pointer-events: none)
- ✅ Style published sessions distinctly ("museum glass" treatment)
- ✅ Update subtitle with "listen, then remix" guidance
- ✅ Hide SamplePicker on published sessions
- ✅ Disable session name editing on published sessions
- ✅ Keep transport controls functional (play/pause works)
- ✅ Tempo/swing controls disabled on published sessions
- [~] Click interception modal — **Rejected** (see Teaching Affordances section)
- [~] Dismissible educational prompt — **Rejected** (subtitle approach preferred)

### Phase 3: Lineage Display ✅ Complete

- ✅ Store `remixedFrom` and `remixedFromName`
- ✅ Display lineage text in header
- ✅ Track and display `remixCount`
- ✅ Remove lineage links (text-only, no `<a>` tags)

### Phase 4: Button Reordering & Desktop ✅ Complete

Button order: `[Publish] [Remix] [New]  ···  [Invite ▾]`

**Desktop:**
- ✅ Replace "Send Copy" with "Publish"
- ✅ Reorder to: Publish, Remix, New, Invite
- ✅ Style Invite with dropdown indicator (▾)
- ✅ Add dropdown to Invite button with "Copy Link" / "Show QR Code"
- ✅ Update button tooltips
- ✅ Update toast messages ("Session published! Link copied.")

### Phase 5: Mobile Optimization ⬜ Future

**Not yet implemented — current desktop UI works on mobile but isn't optimized:**
- [ ] Bottom action bar layout with icon + label buttons
- [ ] Action sheet for Invite (instead of dropdown)
- [ ] Responsive breakpoints (480px, 768px)

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

When authentication is added (Phase 22+), the sharing model gains new capabilities:

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
┌───────────────────────────────────────────────────────────────────────────┐
│  🎵 Funky Beat                                          [Remix] [New]     │
│  📢 Published by @alice • 2025-12-10 • 47 remixes                         │
│                    ↑                                                      │
│              Links to Alice's profile                                     │
├───────────────────────────────────────────────────────────────────────────┤
│  ...                                                                      │
└───────────────────────────────────────────────────────────────────────────┘
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
2. **Clear actions:** Publish, Remix, New (safe) + Invite (collaboration)
3. **Immutability at birth:** Published sessions are frozen forever
4. **Fork-based safety:** Remix to edit anything

**Button order:** `[Publish] [Remix] [New] ··· [Invite ▾]`
- Safe actions grouped and prominent
- Invite visually separated (outline style) since it exposes your session
- Invite dropdown offers "Copy Link" and "Show QR Code" options

**QR Code sharing** extends the Invite action with a visual, scannable way to share sessions:
- Accessed via Invite dropdown (desktop) or action sheet (mobile)
- `?qr=1` URL parameter activates QR display mode
- Three responsive layouts: side panel (large), floating card (medium), fullscreen (small)
- Session stays live and playable while QR is visible

This model handles all sharing patterns (1:1, 1:many, M:N) with minimal concepts and maximum clarity. The UI adapts to mobile with a bottom action bar while maintaining the same visual hierarchy.
