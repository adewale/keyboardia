# Landing Page Specification

## Product Vision

Keyboardia is a real-time multiplayer collaborative music synthesizer with GitHub-style sharing, remixing, and publishing.

**Tagline:** Create/Collaborate. Remix. Share.

- **Create/Collaborate** — The Glitch angle: instant creation, real-time multiplayer
- **Remix** — The GitHub angle: fork any session, build on others' work
- **Share** — The SoundCloud angle: publish and discover music

---

## Design Philosophy

### What We Kept
- Solid dark background (#0a0a0a)
- Solid brand color (#ff6b35, #e85a30)
- Staggered entrance animations
- Animated step grid demo at bottom
- Three-word colored tagline

### What We Removed
- Gradients (too busy)
- Pulsing animations (distracting)
- Floating music notes (cheesy)
- Glowing orb (unnecessary)
- Subtitle (redundant)

### Core Principle
The landing page should feel **confident and minimal**. Let the product speak. The step grid demo at the bottom provides visual interest without overwhelming.

---

## Layout

### Desktop (≥768px)

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                         KEYBOARDIA                             │
│                                                                │
│              Create/Collaborate. Remix. Share.                 │
│                (orange)  (purple)  (teal)                      │
│                                                                │
│                  [ Start your first session → ]                │
│                                                                │
│  ────────────────────────────────────────────────────────────  │
│                                                                │
│   Instant Creation     Multiplayer        Remix Anything       │
│   Jump straight into   Share a link.      Fork any session.   │
│   a step sequencer.    Jam together       Build on others'    │
│                        in real-time.      work.               │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                     ┌────────────────┐                         │
│                     │ ▓░░░▓░░░▓░░░▓░ │  ← Step grid demo       │
│                     │ ░░▓░░░▓░░░▓░░░ │    (animated)           │
│                     │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │                         │
│                     │ ░░░░▓░░░░░░░▓░ │                         │
│                     └────────────────┘                         │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                    Examples to remix                           │
│                                                                │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│   │ ▓▓░░▓▓░░▓▓░░ │   │ ▓░▓░▓░▓░▓░▓░ │   │ ▓▓▓░░░▓▓▓░░░ │      │
│   │ ░░▓▓░░▓▓░░▓▓ │   │ ░▓░▓░▓░▓░▓░▓ │   │ ░░░▓▓▓░░░▓▓▓ │      │
│   │ ▓░▓░▓░▓░▓░▓░ │   │ ▓▓░░▓▓░░▓▓░░ │   │ ▓░░▓░░▓░░▓░░ │      │
│   │ ░▓░▓░▓░▓░▓░▓ │   │ ░░▓▓░░▓▓░░▓▓ │   │ ░▓▓░▓▓░▓▓░▓▓ │      │
│   ├──────────────┤   ├──────────────┤   ├──────────────┤      │
│   │ Four on the  │   │ Polyrhythmic │   │ Trap Beat    │      │
│   │ Floor        │   │ Evolution    │   │              │      │
│   │ 120 BPM      │   │ 118 BPM      │   │ 140 BPM      │      │
│   └──────────────┘   └──────────────┘   └──────────────┘      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Mobile (<768px)

```
┌─────────────────────┐
│                     │
│      KEYBOARDIA     │
│                     │
│  Create/Collaborate │
│   Remix. Share.     │
│                     │
│ [Start first session]│
│                     │
├─────────────────────┤
│                     │
│  Instant Creation   │
│  Jump straight into │
│  a step sequencer.  │
│                     │
│  Multiplayer        │
│  Share a link.      │
│  Jam in real-time.  │
│                     │
│  Remix Anything     │
│  Fork any session.  │
│                     │
├─────────────────────┤
│  ┌───────────────┐  │
│  │ ▓░░░▓░░░▓░░░▓ │  │
│  │ ░░▓░░░▓░░░▓░░ │  │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓ │  │
│  │ ░░░░▓░░░░░░░▓ │  │
│  └───────────────┘  │
│   (step grid demo)  │
│                     │
├─────────────────────┤
│                     │
│  Examples to remix  │
│                     │
│ ←────────────────→  │  (horizontal scroll)
│ ┌────────┐┌────────┐│
│ │▓▓░░▓▓░░││▓░▓░▓░▓░││
│ │░░▓▓░░▓▓││░▓░▓░▓░▓││
│ │▓░▓░▓░▓░││▓▓░░▓▓░░││
│ ├────────┤├────────┤│
│ │Four on ││Poly-   ││
│ │Floor   ││rhythmic││
│ │120 BPM ││118 BPM ││
│ └────────┘└────────┘│
│                     │
└─────────────────────┘
```

---

## Current Implementation

### What Exists (`app/src/components/LandingPage.tsx`)

**LandingPage.tsx**
- Brand name ("Keyboardia")
- Tagline with colored words (Create · Remix · Share)
- CTA button ("Start Session")
- Three feature cards (Instant Creation, Multiplayer, Remix Anything) - no emoji
- Animated step grid demo (4-track pattern, 300ms playhead)
- Example sessions carousel (10 curated sessions)
- Dynamic SEO meta tags (resets on landing page)

**LandingPage.css**
- Uses CSS variables for theming
- Mobile responsive breakpoint at 768px
- Features section: 3-column grid on desktop, stacked on mobile
- Carousel: CSS Grid layout with fixed-width cards

**document-meta.ts**
- `setSessionMeta()` - Updates title and Open Graph for session pages
- `resetDocumentMeta()` - Resets to landing page defaults

### Colors

| Element | Color |
|---------|-------|
| Background | #0a0a0a |
| Brand text | #ff6b35 |
| CTA button | #e85a30 (slight variation) |
| Create word | #ff6b35 (orange) |
| Remix word | #9b59b6 (purple) |
| Share word | #4ecdc4 (teal) |
| Separators | rgba(255,255,255,0.3) |
| Active step | #e85a30 |
| Inactive step | #2a2a2a |

---

## Example Sessions Feature

### Overview

The landing page showcases a curated selection of example sessions to inspire new users. These are hardcoded, published (immutable) sessions that demonstrate what's possible with Keyboardia.

### Design Goals

1. **Inspire** — Show creative potential through diverse musical examples
2. **Simple** — No API calls, no featured session management, just data
3. **Fresh** — Random subset on each page load keeps experience varied
4. **Action-oriented** — One click to listen, then remix

### Data Structure

```typescript
// app/src/data/example-sessions.ts

interface ExampleSession {
  uuid: string;           // Published session UUID (links to /s/{uuid})
  name: string;           // Display name
  tempo: number;          // BPM for display
  tracks: ExampleTrack[]; // Simplified track data for thumbnail
}

interface ExampleTrack {
  steps: boolean[];       // Step pattern (up to 16 for thumbnail)
}

// UUIDs are generated by the seed script and committed to this file.
// These placeholder UUIDs will be replaced with real ones after seeding.
export const EXAMPLE_SESSIONS: ExampleSession[] = [
  {
    uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",  // Placeholder - replaced by seed script
    name: "Four on the Floor",
    tempo: 120,
    tracks: [
      { steps: [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false] },
      { steps: [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false] },
      { steps: [true,false,true,false,true,false,true,false,true,false,true,false,true,false,true,false] },
      { steps: [false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false] },
    ]
  },
  {
    uuid: "b2c3d4e5-f678-90ab-cdef-234567890abc",  // Placeholder - replaced by seed script
    name: "Polyrhythmic Evolution",
    tempo: 118,
    tracks: [
      { steps: [true,false,false,false,false,false,true,false,false,false,false,false,false,true,false,false] },
      { steps: [false,false,true,false,false,true,false,false,true,false,false,false,false,true,false,false] },
      { steps: [true,false,true,false,true,false,true,true,false,true,false,true,false,true,true,false] },
      { steps: [true,false,true,true,false,true,false,true,true,false,true,false,true,true,false,true] },
    ]
  },
  // ... 10-15 total examples (UUIDs generated by seed script)
];
```

### Random Selection

On each page load, select 3 random sessions from the pool:

```typescript
function getRandomExamples(count: number = 3): ExampleSession[] {
  const shuffled = [...EXAMPLE_SESSIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Usage in component
function LandingPage() {
  // Compute once on mount, stable for session
  const [examples] = useState(() => getRandomExamples(3));
  // ...
}
```

### Grid Thumbnail Component

The step pattern becomes the session's visual identity — like album art.

**Condensing Logic (for tracks with >16 steps)**

```typescript
function condenseSteps(steps: boolean[], targetColumns: number = 16): boolean[] {
  if (steps.length <= targetColumns) {
    return [...steps, ...Array(targetColumns - steps.length).fill(false)];
  }

  const ratio = steps.length / targetColumns;
  const condensed: boolean[] = [];

  for (let i = 0; i < targetColumns; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    condensed.push(steps.slice(start, end).some(Boolean)); // OR logic
  }

  return condensed;
}
```

**Component**

```typescript
function GridThumbnail({ tracks }: { tracks: ExampleTrack[] }) {
  const displayTracks = tracks.slice(0, 4); // Max 4 rows

  return (
    <div className="grid-thumbnail">
      {displayTracks.map((track, i) => (
        <div key={i} className="thumbnail-row">
          {condenseSteps(track.steps).map((active, j) => (
            <div
              key={j}
              className={`thumbnail-cell ${active ? 'active' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Styles**

```css
.grid-thumbnail {
  display: grid;
  grid-template-rows: repeat(4, 1fr);
  gap: 2px;
  padding: 12px;
  background: #1a1a1a;
  border-radius: 8px 8px 0 0;
  aspect-ratio: 16 / 4;
}

.thumbnail-row {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 2px;
}

.thumbnail-cell {
  aspect-ratio: 1;
  background: #2a2a2a;
  border-radius: 2px;
}

.thumbnail-cell.active {
  background: #e85a30;
}
```

### Example Card Component

```typescript
function ExampleCard({ session }: { session: ExampleSession }) {
  const navigate = () => {
    window.location.href = `/s/${session.uuid}`;
  };

  return (
    <button className="example-card" onClick={navigate}>
      <GridThumbnail tracks={session.tracks} />
      <div className="example-info">
        <span className="example-name">{session.name}</span>
        <span className="example-tempo">{session.tempo} BPM</span>
      </div>
    </button>
  );
}
```

### Click Behavior

1. User clicks example card
2. Navigate to `/s/{uuid}` (published session)
3. User sees full grid (read-only, published session)
4. User can press play to listen
5. User clicks "Remix" to create their own editable copy

### Examples Section Styles

```css
.examples-section {
  width: 100%;
  max-width: 900px;
  margin: 40px 0;
}

.examples-section h2 {
  text-align: center;
  color: #888;
  font-size: 1rem;
  font-weight: 400;
  margin-bottom: 20px;
}

.examples-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.example-card {
  background: none;
  border: 1px solid #333;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  overflow: hidden;
}

.example-card:hover {
  border-color: #ff6b35;
  transform: translateY(-2px);
}

.example-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.example-name {
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
}

.example-tempo {
  color: #666;
  font-size: 0.8rem;
}

/* Mobile: horizontal scroll */
@media (max-width: 768px) {
  .examples-grid {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    gap: 12px;
    padding-bottom: 12px;
  }

  .example-card {
    flex: 0 0 200px;
    scroll-snap-align: start;
  }
}
```

### Source Content

Example sessions are derived from existing JSON files in `app/scripts/sessions/`:

| File | Example Name | Key Feature |
|------|-------------|-------------|
| `polyrhythmic-evolution.json` | Polyrhythmic Evolution | Odd-length patterns (5,7,11,13,17,19,23 steps) |
| `afrobeat-groove.json` | Afrobeat Groove | Polyrhythmic groove |
| `ambient-soundscape.json` | Ambient Soundscape | Slow evolving textures |
| `edm-drop-section.json` | EDM Drop | Build and release |
| `progressive-house-build.json` | Progressive House | Layered progression |
| (to be created) | Four on the Floor | Classic house pattern |
| (to be created) | Trap Beat | Hi-hat rolls, 808 patterns |
| (to be created) | Breakbeat | Syncopated drums |
| (to be created) | Lo-Fi Beat | Relaxed, dusty |

---

## Example Session Lifecycle

### Overview

Example sessions follow a **pre-commit workflow**:

1. Create/edit JSON file in `app/scripts/sessions/`
2. Run seed script to publish to production server
3. Commit the resulting UUIDs to `app/src/data/example-sessions.ts`

UUIDs are stable and permanent. Once published, an example session cannot be modified (immutable).

### Seeding Process

**Step 1: Create the seed script**

```typescript
// app/scripts/seed-examples.ts

import { readFileSync, readdirSync } from 'fs';

const API_BASE = 'https://keyboardia.com/api/sessions';
const EXAMPLES_TO_SEED = [
  'polyrhythmic-evolution.json',
  'afrobeat-groove.json',
  'ambient-soundscape.json',
  // ... add files to seed
];

async function seedExamples() {
  const results = [];

  for (const filename of EXAMPLES_TO_SEED) {
    const json = readFileSync(`./sessions/${filename}`, 'utf-8');
    const data = JSON.parse(json);

    // 1. Create session
    const createRes = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          tracks: data.tracks,
          tempo: data.tempo,
          swing: data.swing ?? 0,
          version: 1,
        },
        name: data.name,
      }),
    });
    const { id } = await createRes.json();

    // 2. Publish (make immutable)
    await fetch(`${API_BASE}/${id}/publish`, { method: 'POST' });

    // 3. Extract thumbnail data (first 4 tracks, condensed to 16 steps)
    const thumbnailTracks = data.tracks.slice(0, 4).map(track => ({
      steps: condenseToThumbnail(track.steps, track.stepCount || 16),
    }));

    results.push({
      uuid: id,
      name: data.name,
      tempo: data.tempo,
      tracks: thumbnailTracks,
    });

    console.log(`✓ ${data.name} → ${id}`);
  }

  // Output TypeScript for example-sessions.ts
  console.log('\n// Copy to app/src/data/example-sessions.ts:\n');
  console.log(`export const EXAMPLE_SESSIONS = ${JSON.stringify(results, null, 2)};`);
}

function condenseToThumbnail(steps: boolean[], stepCount: number): boolean[] {
  const actualSteps = steps.slice(0, stepCount);
  if (actualSteps.length <= 16) {
    return [...actualSteps, ...Array(16 - actualSteps.length).fill(false)];
  }
  // Condense using OR logic
  const ratio = actualSteps.length / 16;
  return Array.from({ length: 16 }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    return actualSteps.slice(start, end).some(Boolean);
  });
}

seedExamples();
```

**Step 2: Run the script**

```bash
cd app/scripts
npx ts-node seed-examples.ts
```

**Step 3: Commit the output**

Copy the generated TypeScript to `app/src/data/example-sessions.ts` and commit.

### Updating an Example

Examples are **immutable once published**. To update:

1. Modify the JSON file
2. Run seed script (creates NEW UUID)
3. Update `example-sessions.ts` with new UUID
4. Old UUID continues to work (redirects or shows archived version)

---

## Nominating New Examples

### Criteria

An example session should:

1. **Demonstrate a genre or technique** — Not just random notes
2. **Sound good on first play** — Immediately engaging
3. **Be visually distinctive** — Thumbnail should look different from others
4. **Use 4-8 tracks** — Enough complexity, not overwhelming
5. **Be 16-128 steps** — Long enough to develop, short enough to loop

### Diversity Goals

The example set should cover:

- [ ] Classic 4/4 (house, techno)
- [ ] Breakbeat/hip-hop
- [ ] Polyrhythmic/world
- [ ] Ambient/atmospheric
- [ ] Melodic/synth-heavy
- [ ] Experimental/glitchy

### How to Nominate

1. **Create the session** in Keyboardia
2. **Export to JSON** (or create manually in `app/scripts/sessions/`)
3. **Add to the seed list** in `seed-examples.ts`
4. **Open a PR** with:
   - The JSON file
   - Updated `EXAMPLES_TO_SEED` array
   - Brief description of what makes it a good example

### JSON File Format

```json
{
  "name": "Example Name",
  "description": "Why this is a good example",
  "tracks": [
    {
      "id": "unique-track-id",
      "name": "Track Name",
      "sampleId": "kick",
      "steps": [true, false, ...],
      "parameterLocks": [null, {"pitch": 5}, ...],
      "volume": 0.8,
      "muted": false,
      "playbackMode": "oneshot",
      "transpose": 0,
      "stepCount": 16
    }
  ],
  "tempo": 120,
  "swing": 0
}
```

---

## Published Session View

When a user navigates to a published session (`/s/{uuid}` where `immutable: true`):

### Visual Changes

| Element | Normal Session | Published Session |
|---------|---------------|-------------------|
| Header | Session name (editable) | Session name + "Published" badge |
| Edit controls | Visible | Hidden |
| Step cells | Clickable (toggle) | Not clickable (display only) |
| Add track button | Visible | Hidden |
| Delete track button | Visible | Hidden |
| Transport | Play/Pause/Tempo/Swing | Play/Pause only (no editing) |
| Primary CTA | Share | **Remix** (prominent) |

### Remix Button

```
┌─────────────────────────────────────────────────────┐
│  [Published]  Polyrhythmic Evolution                │
│                                                     │
│  [▶ Play]                    [ Remix → ]            │
│                                                     │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐ │
│  │ ██  │     │     │ ██  │     │ ██  │     │     │ │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘ │
│  ... (read-only step grid)                          │
└─────────────────────────────────────────────────────┘
```

### Remix Flow

1. User clicks "Remix"
2. `POST /api/sessions/{uuid}/remix` creates editable copy
3. URL updates to new session ID
4. User now has full edit controls
5. "Remixed from: [Original Name]" shown in header

---

## Error Handling

### Example Sessions

Example sessions are hardcoded and committed to the repository. No runtime validation is performed on the landing page — the data is trusted.

If an example UUID becomes invalid (e.g., session was deleted from the database), the user will see a "Session not found" error when clicking through. This is acceptable because:

1. Example UUIDs are stable (published sessions are immutable)
2. Deletions would be intentional and rare
3. The fix is to update `example-sessions.ts` and redeploy

**No API calls are made on the landing page to validate examples.**

### Published Session Not Found

If user navigates directly to a published session that doesn't exist:

1. Show "Session not found" message
2. Offer "Create new session" button
3. Do NOT auto-create (user may have mistyped URL)

---

## Open Questions

### All Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| Seed at deploy vs pre-commit? | **Pre-commit** | UUIDs committed to repo, stable across deploys |
| How many examples? | **10-15** total, show **3** | Enough variety, not overwhelming |
| Click behavior? | Navigate to published session | User clicks Remix when ready |
| Random selection algorithm | **True random** | Simple, no genre weighting needed |
| Session name in URL | **No** — `/s/{uuid}` only | Keep URLs clean, avoid slug complexity |
| Analytics | **No** | Non-goal, not tracking example clicks |
| Audio preview on hover | **No** | Keep it simple, user clicks to hear |
| Localization | **No** | English only for example names |

---

## Component Structure

```
LandingPage/
├── LandingPage.tsx          # Main layout (exists)
├── LandingPage.css          # Styles (exists)
├── GridThumbnail.tsx        # Reusable grid preview (to create)
├── GridThumbnail.css
├── ExamplesSection.tsx      # Examples grid (to create)
├── ExamplesSection.css
└── index.ts                 # Exports (exists)
```

---

## Implementation Phases

### Phase 1: Static Examples
1. Create `app/src/data/example-sessions.ts` with 3-5 initial examples
2. Create `GridThumbnail` component (static thumbnail)
3. Create `ExampleCard` component (click navigates to session)
4. Create `ExamplesSection` component
5. Add examples section to `LandingPage`
6. Style for desktop and mobile

### Phase 2: Full Content
1. Create additional JSON session files (10-15 total)
2. Create seed script (`app/scripts/seed-examples.ts`)
3. Publish sessions to production with stable UUIDs
4. Update `EXAMPLE_SESSIONS` array with all sessions
5. Test random selection and navigation

### Phase 3: Published Session View
1. Ensure published sessions load correctly at `/s/{uuid}`
2. Show "Published" badge on published sessions
3. Enable "Remix" button to create editable copy
4. Hide edit controls on published sessions
5. Make step cells read-only (non-interactive)

---

## Dependencies

### Existing (no changes needed)
- `LandingPage` component
- Session loading at `/s/{uuid}`
- CSS architecture

### Changes Required
- Published session support (immutable flag) — exists in API
- Remix functionality from published sessions — exists
- Read-only mode for step cells — new

---

## Non-Goals

- No API to fetch featured sessions (hardcoded data only)
- No admin interface to manage examples
- No analytics on which examples are clicked
- No user-generated featured content
- No templates section (keep it simple — users start blank or remix an example)
- No weighted/smart random selection (true random only)
- No session name slugs in URLs (`/s/{uuid}` only)
- No localization of example names
- No audio preview on hover (user clicks through to hear)

---

## Routing

```typescript
// main.tsx (current implementation)
const [showApp, setShowApp] = useState(false);
const [sessionId, setSessionId] = useState<string | null>(null);

useEffect(() => {
  const path = window.location.pathname;
  // UUIDs are 36 characters: 8-4-4-4-12 hex digits
  const match = path.match(/^\/s\/([a-f0-9-]{36})$/);
  if (match) {
    setSessionId(match[1]);
    setShowApp(true);
  }
}, []);

// "/" shows LandingPage
// "/s/{uuid}" shows App with session (UUID format only)
```

---

## Animation Timings

Staggered entrance sequence:
1. **0.0s** — Logo entrance (scale + fade)
2. **0.2s** — Brand name (slide up + fade)
3. **0.4s** — Tagline (slide up + fade)
4. **0.6s** — CTA button (slide up + fade)
5. **0.8s** — Features section (slide up + fade)
6. **1.0s** — Step grid demo (slide up + fade)
7. **1.2s** — Examples section (to be added)

All animations use `ease-out` timing.
