# QR Modifier Specification

## Overview

The `?qr=1` URL parameter transforms any Keyboardia URL into a QR-prominent display mode. This is a composable modifier that works on any existing URL rather than a separate sharing flow.

---

## Goals

1. **Composable** — Works on any URL (`/s/{id}`, `/p/{id}`, future URLs)
2. **Context-aware** — Adapts to screen size (overlay vs. takeover)
3. **Non-destructive** — Original UI remains functional where space permits
4. **Scannable** — QR code sized for scanning from reasonable distance (3-10 feet)
5. **Informative** — Shows relevant context (session name, player count, what scanning does)

---

## URL Behavior

### Supported URLs

| URL Pattern | QR Modifier | Encodes |
|-------------|-------------|---------|
| `/s/{uuid}` | `/s/{uuid}?qr=1` | Same URL (join live session) |
| `/s/{uuid}?qr=1&intent=copy` | — | `/s/{uuid}?copy=1` (auto-remix on scan) |
| `/s/{uuid}?qr=1&intent=spectate` | — | `/s/{uuid}?spectate=1` (view-only) |
| `/p/{snapId}` | `/p/{snapId}?qr=1` | Same URL (view snapshot) |

### Intent Parameter

The `intent` parameter modifies what URL gets encoded in the QR:

```
?qr=1                    → QR encodes current URL as-is
?qr=1&intent=copy        → QR encodes URL + ?copy=1 (scanner gets their own remix)
?qr=1&intent=spectate    → QR encodes URL + ?spectate=1 (scanner watches only)
```

This allows the host to show a QR that grants different access than they have.

### Query Parameter Handling

When generating the QR code URL:
1. Start with current URL (origin + pathname)
2. Remove `qr=1` and `intent=*` from query params
3. Add intent-specific params if specified
4. Encode resulting URL in QR

```typescript
function getQRTargetURL(currentURL: URL, intent?: 'copy' | 'spectate'): string {
  const target = new URL(currentURL.origin + currentURL.pathname);

  // Preserve non-QR query params
  for (const [key, value] of currentURL.searchParams) {
    if (key !== 'qr' && key !== 'intent') {
      target.searchParams.set(key, value);
    }
  }

  // Add intent param
  if (intent === 'copy') {
    target.searchParams.set('copy', '1');
  } else if (intent === 'spectate') {
    target.searchParams.set('spectate', '1');
  }

  return target.toString();
}
```

---

## Display Modes

### Large Display (≥1024px viewport width)

Split view: QR panel on right, sequencer UI on left.

```
┌─────────────────────────────────────────────────────┬───────────────────────┐
│                                                     │                       │
│   Sequencer UI (fully functional)                   │   ┌───────────────┐   │
│                                                     │   │               │   │
│   ┌──────────────────────────────────────────┐      │   │               │   │
│   │  Track controls    │ Step grid           │      │   │   QR CODE     │   │
│   │  ──────────────────│─────────────────    │      │   │   (200x200)   │   │
│   │  kick         ♪    │ ●   ●   ●   ●      │      │   │               │   │
│   │  snare        ♪    │   ●       ●        │      │   │               │   │
│   │  hihat        ♪    │ ● ● ● ● ● ● ● ●    │      │   └───────────────┘   │
│   └──────────────────────────────────────────┘      │                       │
│                                                     │   Scan to join        │
│   [▶ Play] [Stop]  BPM: 120                        │   "Funky Beat"        │
│                                                     │   3 people jamming    │
│                                                     │                       │
│                                                     │   ─────────────────   │
│                                                     │   [ Copy Link ]       │
│                                                     │   [ Exit QR Mode ]    │
└─────────────────────────────────────────────────────┴───────────────────────┘
```

**Panel width:** 280px fixed
**QR size:** 200x200px (scannable from ~8 feet)
**Sequencer:** Remaining width, fully interactive

### Medium Display (768px - 1023px)

Floating overlay in corner, sequencer UI visible but partially obscured.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Sequencer UI (functional, slightly compressed)                            │
│                                                     ┌───────────────────┐   │
│   ┌──────────────────────────────────────────┐      │  ┌───────────┐    │   │
│   │  kick         │ ●   ●   ●   ●           │      │  │  QR CODE  │    │   │
│   │  snare        │   ●       ●             │      │  │  (150px)  │    │   │
│   │  hihat        │ ● ● ● ● ● ● ● ●         │      │  └───────────┘    │   │
│   └──────────────────────────────────────────┘      │  Scan to join     │   │
│                                                     │  3 people         │   │
│   [▶ Play] [Stop]  BPM: 120                        │  [ ✕ ]            │   │
│                                                     └───────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Overlay size:** 200px x 240px
**QR size:** 150x150px
**Position:** Bottom-right, 16px margin
**Dismiss:** ✕ button (removes `?qr=1` from URL)

### Small Display (<768px / Mobile)

QR takes over the screen. Tap anywhere to dismiss.

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│      ┌─────────────────┐        │
│      │                 │        │
│      │                 │        │
│      │    QR CODE      │        │
│      │    (240x240)    │        │
│      │                 │        │
│      │                 │        │
│      └─────────────────┘        │
│                                 │
│       Scan to join              │
│       "Funky Beat"              │
│       3 people jamming          │
│                                 │
│      ───────────────────        │
│                                 │
│        [ Copy Link ]            │
│                                 │
│      Tap anywhere to close      │
│                                 │
└─────────────────────────────────┘
```

**QR size:** 240x240px (optimized for close-range phone scanning)
**Dismiss:** Tap outside QR, or swipe down
**Background:** Semi-transparent overlay over sequencer

---

## QR Panel Content

### Information Displayed

```
┌─────────────────────────┐
│                         │
│   ┌─────────────────┐   │
│   │                 │   │
│   │    QR CODE      │   │
│   │                 │   │
│   └─────────────────┘   │
│                         │
│   {action verb}         │  ← "Scan to join" / "Scan to get a copy" / "Scan to watch"
│   "{session name}"      │  ← From session.name, or "Untitled Session"
│   {player count}        │  ← "3 people jamming" / "Just you" / hidden if snapshot
│                         │
│   ─────────────────     │
│                         │
│   [ Copy Link ]         │  ← Copies QR target URL to clipboard
│   [ Exit QR Mode ]      │  ← Removes ?qr=1 from URL (large display only)
│                         │
└─────────────────────────┘
```

### Action Verb by Intent

| Intent | Action Text |
|--------|-------------|
| (none) | "Scan to join" |
| `copy` | "Scan to get your own copy" |
| `spectate` | "Scan to watch" |
| Snapshot URL | "Scan to listen" |

### Player Count Display

| State | Display |
|-------|---------|
| 1 player (just host) | "Just you" |
| 2+ players | "{n} people jamming" |
| Snapshot (no live session) | Hidden |

---

## Component Architecture

### New Components

```
app/src/components/
├── QROverlay/
│   ├── QROverlay.tsx        # Main container, handles display modes
│   ├── QRPanel.tsx          # The QR code + metadata panel
│   ├── QRCode.tsx           # QR code generation wrapper
│   └── QROverlay.css        # Styles for all display modes
```

### QROverlay.tsx

```typescript
interface QROverlayProps {
  targetURL: string;
  sessionName: string | null;
  playerCount: number;
  intent?: 'copy' | 'spectate';
  onClose: () => void;
}

export function QROverlay({
  targetURL,
  sessionName,
  playerCount,
  intent,
  onClose
}: QROverlayProps) {
  const displayMode = useDisplayMode(); // 'large' | 'medium' | 'small'

  // Render based on display mode
  switch (displayMode) {
    case 'large':
      return <QRSidePanel {...props} />;
    case 'medium':
      return <QRFloatingOverlay {...props} />;
    case 'small':
      return <QRFullscreen {...props} />;
  }
}
```

### QRCode.tsx

```typescript
interface QRCodeProps {
  value: string;
  size: number;
  // Error correction level - 'M' is good balance of density vs. reliability
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
}

export function QRCode({ value, size, errorCorrection = 'M' }: QRCodeProps) {
  // Uses qrcode library to generate SVG
  // SVG preferred over canvas for crisp scaling
}
```

### Hook: useQRMode

```typescript
interface QRModeState {
  isActive: boolean;
  intent: 'join' | 'copy' | 'spectate';
  targetURL: string;
  activate: (intent?: 'copy' | 'spectate') => void;
  deactivate: () => void;
}

export function useQRMode(): QRModeState {
  const [searchParams, setSearchParams] = useSearchParams();

  const isActive = searchParams.get('qr') === '1';
  const intent = searchParams.get('intent') as 'copy' | 'spectate' | null;

  const activate = (newIntent?: 'copy' | 'spectate') => {
    setSearchParams(params => {
      params.set('qr', '1');
      if (newIntent) params.set('intent', newIntent);
      return params;
    });
  };

  const deactivate = () => {
    setSearchParams(params => {
      params.delete('qr');
      params.delete('intent');
      return params;
    });
  };

  const targetURL = useMemo(() => getQRTargetURL(window.location, intent), [intent]);

  return { isActive, intent: intent ?? 'join', targetURL, activate, deactivate };
}
```

---

## Integration with Existing UI

### Share Button Enhancement

The existing share buttons gain a QR sub-option:

```
┌──────────────────────────────────────────────────────────────────┐
│  [Invite ▾]   [Send Copy ▾]   [Remix]   [New]                   │
└──────────────────────────────────────────────────────────────────┘

Clicking "Invite ▾" shows dropdown:
┌─────────────────────┐
│  Copy Link          │  ← Existing behavior
│  Show QR Code       │  ← Adds ?qr=1 to URL
└─────────────────────┘

Clicking "Send Copy ▾" shows dropdown:
┌─────────────────────┐
│  Copy Link          │  ← Existing behavior (creates remix, copies URL)
│  Show QR Code       │  ← Adds ?qr=1&intent=copy to URL
└─────────────────────┘
```

### App.tsx Integration

```typescript
function App() {
  const { isActive: qrMode, targetURL, deactivate: closeQR } = useQRMode();
  const { session, playerCount } = useSession();

  return (
    <div className="app">
      {/* Existing UI */}
      <Header />
      <StepSequencer />
      <Transport />

      {/* QR Overlay - renders based on qrMode */}
      {qrMode && (
        <QROverlay
          targetURL={targetURL}
          sessionName={session?.name}
          playerCount={playerCount}
          onClose={closeQR}
        />
      )}
    </div>
  );
}
```

---

## QR Code Generation

### Library Choice

**Recommended:** `qrcode` (npm package)

```json
{
  "dependencies": {
    "qrcode": "^1.5.3"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5"
  }
}
```

**Rationale:**
- Mature, well-maintained
- Supports SVG output (crisp at any size)
- Small bundle size (~12KB gzipped)
- No canvas dependency (works in SSR if needed)

### Generation Settings

```typescript
import QRCode from 'qrcode';

async function generateQRCodeSVG(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',  // ~15% error correction
    margin: 2,                   // Quiet zone (2 modules)
    width: 200,                  // Will be scaled by CSS
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}
```

### Error Correction Levels

| Level | Error Correction | Use Case |
|-------|------------------|----------|
| L | ~7% | Maximum data density |
| M | ~15% | **Recommended** — good balance |
| Q | ~25% | Damaged/dirty codes |
| H | ~30% | Logos embedded in QR |

Use **M** for Keyboardia URLs. UUID-based URLs are long but not extreme.

---

## URL Length Considerations

### Typical URL Lengths

```
Base URL:     https://keyboardia.adewale-883.workers.dev
Session:      /s/f47ac10b-58cc-4372-a567-0e02b2c3d479
With intent:  ?copy=1

Total:        ~75 characters
```

This is well within QR code capacity:
- Version 3 QR (29x29): ~77 alphanumeric chars
- Version 4 QR (33x33): ~114 alphanumeric chars

### If URLs Get Longer

For future features that might add more query params, consider:
1. URL shortener service (maps short code → full URL)
2. Higher QR version (larger code, still scannable)
3. Shorter session IDs (nanoid instead of UUID)

For now, standard URLs work fine.

---

## Responsive Breakpoints

```css
/* QR display mode breakpoints */
:root {
  --qr-breakpoint-large: 1024px;
  --qr-breakpoint-medium: 768px;
}

/* Large: side panel */
@media (min-width: 1024px) {
  .qr-overlay { /* side panel styles */ }
}

/* Medium: floating overlay */
@media (min-width: 768px) and (max-width: 1023px) {
  .qr-overlay { /* floating styles */ }
}

/* Small: fullscreen takeover */
@media (max-width: 767px) {
  .qr-overlay { /* fullscreen styles */ }
}
```

---

## Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Escape` | Close QR overlay |
| `Tab` | Navigate to "Copy Link" and "Exit" buttons |
| `Enter`/`Space` | Activate focused button |

### Screen Reader

```html
<div
  role="dialog"
  aria-modal="true"
  aria-label="QR code for sharing session"
>
  <img
    role="img"
    alt="QR code linking to {sessionName}. {actionText}."
  />
  <!-- Or for inline SVG: -->
  <svg role="img" aria-label="QR code linking to {sessionName}">
    ...
  </svg>
</div>
```

### Focus Management

- When QR overlay opens, focus moves to the overlay
- When closed, focus returns to the button that opened it
- Focus trapped within overlay on mobile (fullscreen mode)

---

## Analytics Events

Track QR mode usage for understanding adoption:

```typescript
interface QRAnalyticsEvents {
  'qr_mode_activated': {
    intent: 'join' | 'copy' | 'spectate';
    display_mode: 'large' | 'medium' | 'small';
    session_player_count: number;
  };
  'qr_mode_closed': {
    method: 'button' | 'escape' | 'tap_outside';
    duration_ms: number;
  };
  'qr_link_copied': {
    intent: 'join' | 'copy' | 'spectate';
  };
}
```

---

## Edge Cases

### 1. Session Not Found

If QR mode is active but session fails to load:
- Show QR overlay anyway (URL is valid)
- Display "Session" instead of session name
- Hide player count

### 2. Offline

If offline:
- QR code still generates (URL-based, no network needed)
- Show warning: "You're offline — scanners may not be able to connect"

### 3. Very Long Session Names

Truncate at 30 characters with ellipsis:
```
"My Super Amazing Conference De…"
```

### 4. Direct Navigation to ?qr=1

User pastes URL with `?qr=1` directly:
- QR mode activates immediately on page load
- Works as expected (no special handling needed)

### 5. Multiple Query Params

Preserve existing params when adding QR mode:
```
/s/{id}?foo=bar       →  /s/{id}?foo=bar&qr=1
/s/{id}?foo=bar&qr=1  →  QR encodes /s/{id}?foo=bar (without qr=1)
```

---

## Implementation Phases

### Phase 1: Core QR Overlay (MVP)
- [ ] Add `qrcode` dependency
- [ ] Create `QRCode` component (SVG generation)
- [ ] Create `QROverlay` component (large display mode only)
- [ ] Create `useQRMode` hook
- [ ] Add `?qr=1` URL parameter handling
- [ ] Integrate into `App.tsx`
- [ ] Basic styling

### Phase 2: Responsive Modes
- [ ] Implement medium display mode (floating overlay)
- [ ] Implement small display mode (fullscreen)
- [ ] Add display mode detection hook
- [ ] Responsive CSS

### Phase 3: Share Button Integration
- [ ] Add dropdown to Invite button
- [ ] Add dropdown to Send Copy button
- [ ] "Show QR Code" option in dropdowns
- [ ] Intent parameter support (`?qr=1&intent=copy`)

### Phase 4: Polish
- [ ] Keyboard navigation (Escape to close)
- [ ] Focus management
- [ ] Screen reader support
- [ ] Analytics events
- [ ] Copy Link button in QR panel
- [ ] Player count display
- [ ] Session name display

### Phase 5: Future Enhancements (Optional)
- [ ] QR code with Keyboardia logo embedded (error correction H)
- [ ] Animated QR appearance
- [ ] "Scan successful" detection (via WebSocket player join)
- [ ] Booth mode (auto-cycle intents, larger display)

---

## Testing

### Unit Tests

```typescript
describe('useQRMode', () => {
  it('detects ?qr=1 in URL', () => {});
  it('returns correct target URL without qr param', () => {});
  it('adds intent param to target URL', () => {});
  it('activate() adds qr=1 to URL', () => {});
  it('deactivate() removes qr and intent from URL', () => {});
});

describe('QRCode', () => {
  it('generates valid SVG for URL', () => {});
  it('handles long URLs', () => {});
  it('applies correct error correction level', () => {});
});

describe('getQRTargetURL', () => {
  it('removes qr=1 from target', () => {});
  it('preserves other query params', () => {});
  it('adds copy=1 for copy intent', () => {});
  it('adds spectate=1 for spectate intent', () => {});
});
```

### E2E Tests (Playwright)

```typescript
test('QR mode activates via URL', async ({ page }) => {
  await page.goto('/s/test-session?qr=1');
  await expect(page.locator('.qr-overlay')).toBeVisible();
});

test('QR mode closes on Escape', async ({ page }) => {
  await page.goto('/s/test-session?qr=1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.qr-overlay')).not.toBeVisible();
  expect(page.url()).not.toContain('qr=1');
});

test('QR encodes correct URL for copy intent', async ({ page }) => {
  await page.goto('/s/test-session?qr=1&intent=copy');
  // Verify QR contains ?copy=1 (would need QR decoder in test)
});
```

### Manual Testing Checklist

- [ ] QR scannable from phone at 3 feet (large display)
- [ ] QR scannable from phone at 1 foot (mobile display)
- [ ] Correct URL opens after scanning
- [ ] Copy Link copies correct URL
- [ ] Player count updates in real-time
- [ ] Session name displays and truncates correctly
- [ ] Escape key closes overlay
- [ ] Tap outside closes overlay (mobile)
- [ ] Overlay doesn't block sequencer interaction (large display)

---

## File Changes Summary

### New Files
```
app/src/components/QROverlay/
├── QROverlay.tsx
├── QRPanel.tsx
├── QRCode.tsx
├── QROverlay.css
└── index.ts

app/src/hooks/useQRMode.ts
app/src/hooks/useDisplayMode.ts
app/src/utils/qr.ts
```

### Modified Files
```
app/package.json          # Add qrcode dependency
app/src/App.tsx           # Integrate QROverlay
app/src/App.css           # Layout adjustments for side panel
app/src/components/Header.tsx  # Share button dropdowns (Phase 3)
```

---

## Open Questions

1. **Domain for QR URLs** — Should QR codes use a shorter domain (e.g., `kbrd.io/s/{id}`) for smaller codes? Requires DNS setup.

2. **QR Code Styling** — Plain black/white, or branded with colors/logo? Logo requires error correction H (30%), making code denser.

3. **Spectate Mode Implementation** — The `?spectate=1` intent assumes a spectator mode exists. Should this spec include spectator mode, or should that be a separate spec?

4. **Copy Intent Behavior** — Should `?copy=1` auto-remix immediately on load, or show a "Get Your Copy" button first?
