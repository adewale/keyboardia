# QR Modifier Specification

> **Related:** [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) — Complete sharing model with Publish/Invite/Remix/New actions

## Overview

The `?qr=1` URL parameter transforms any Keyboardia URL into a QR-prominent display mode. This is a composable modifier that works on any existing URL rather than a separate sharing flow.

QR code sharing is accessed through the **Invite** button dropdown (desktop) or action sheet (mobile), extending the Invite functionality with a visual, scannable option for in-person sharing scenarios.

---

## Goals

1. **Composable** — Works on any URL (`/s/{id}`, future URL schemes)
2. **Context-aware** — Adapts to screen size (overlay vs. takeover)
3. **Non-destructive** — Original UI remains functional where space permits
4. **Scannable** — QR code sized for scanning from reasonable distance (3-10 feet)
5. **Informative** — Shows relevant context (session name, player count, what scanning does)

---

## Design Direction

### Context & Purpose

The QR overlay serves two distinct contexts:

1. **Conference/booth mode** — The QR is the star. It needs to be visible from 10+ feet, scannable from 3-6 feet, and communicate "this is a music thing, scan to join" at a glance.

2. **Casual sharing** — Quick way to get someone nearby into your session. Less theatrical, more utilitarian.

The design should excel at booth mode (the harder case) while not feeling overwrought for casual use.

### Aesthetic Direction: Industrial Warmth

Keyboardia's visual language is **dark, warm, utilitarian** — a focused instrument, not a toy. The QR overlay should feel like part of the same tool:

- **Dark canvas** (#121212) with warm orange accents (#e85a30)
- **The grid stays visible** — music keeps playing, the session is alive
- **QR code as functional object** — not decorative, but commanding
- **Typography that works at distance** — high contrast, no fuss

### Visual Treatment

**The QR Code itself:**
```
┌─────────────────────────────────────┐
│                                     │
│   ┌─────────────────────────────┐   │
│   │ ▓▓▓▓▓▓▓ ░░░░░ ▓▓▓▓▓▓▓      │   │
│   │ ▓░░░░░▓ ░▓▓▓░ ▓░░░░░▓      │   │  ← White QR on dark surface
│   │ ▓░▓▓▓░▓ ░░░░░ ▓░▓▓▓░▓      │   │    Maximum contrast for scanning
│   │ ▓░▓▓▓░▓ ▓░▓░▓ ▓░▓▓▓░▓      │   │
│   │ ▓░▓▓▓░▓ ░░▓░░ ▓░▓▓▓░▓      │   │
│   │ ▓░░░░░▓ ░▓░▓░ ▓░░░░░▓      │   │
│   │ ▓▓▓▓▓▓▓ ░▓░▓░ ▓▓▓▓▓▓▓      │   │
│   └─────────────────────────────┘   │
│                                     │
│   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   │  ← Subtle orange accent line
│                                     │
│   SCAN TO JOIN                      │  ← All caps, high contrast
│   "Funky Beat"                      │  ← Session name, slightly muted
│   3 people jamming                  │  ← Live count, green accent
│                                     │
└─────────────────────────────────────┘
```

**Color system:**
| Element | Color | Reasoning |
|---------|-------|-----------|
| QR code | Pure white `#FFFFFF` | Maximum scan reliability |
| QR background | Near-black `#1a1a1a` | Contrast, matches Keyboardia surface |
| Accent line | Orange `#e85a30` | Brand connection |
| "Scan to join" | White `rgba(255,255,255,0.9)` | Primary action, high visibility |
| Session name | Muted `#888888` | Secondary info |
| Player count | Green `#4ade80` | Matches existing player count style |
| Panel background | `#121212` | Seamless with app background |

**Typography:**
- "SCAN TO JOIN": System sans-serif, all caps, 600 weight, letter-spacing 0.05em
- Session name: System sans-serif, normal case, 400 weight
- Player count: Smaller, with the green pill treatment from existing UI

### Motion

**Entrance (QR mode activates):**
1. Panel slides in from right (large) or fades up from bottom (mobile)
2. QR code fades in with subtle scale (1.02 → 1.0) over 200ms
3. Text staggers in: action text (0ms) → session name (50ms) → player count (100ms)

**Exit:**
- Quick fade out (150ms), no theatrics

**Idle state:**
- Subtle pulse on the orange accent line (opacity 0.6 → 1.0, 2s cycle)
- Indicates "this is live, something is happening"

### Spatial Composition

**Large display — side panel, not overlay:**
```
┌───────────────────────────────────────────────┬─────────────────┐
│                                               │                 │
│   ┌─────────────────────────────────────┐     │   QR PANEL      │
│   │                                     │     │                 │
│   │         SEQUENCER GRID              │     │   (280px)       │
│   │         (still playing)             │     │                 │
│   │                                     │     │                 │
│   └─────────────────────────────────────┘     │                 │
│                                               │                 │
│   [▶ Play] [Stop]  BPM: 120                  │                 │
│                                               │                 │
└───────────────────────────────────────────────┴─────────────────┘
```

The sequencer grid compresses slightly but remains fully functional. The music keeps playing. This is key for booth demos — you're not "pausing to show a QR", you're showing the QR while the jam continues.

**Mobile — fullscreen but transparent:**
```
┌─────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Sequencer visible through
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │    semi-transparent backdrop
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ │          QR CODE            │ │
│ │                             │ │
│ └─────────────────────────────┘ │
│                                 │
│     SCAN TO JOIN                │
│     "Funky Beat"                │
│                                 │
│     Tap anywhere to close       │
│                                 │
└─────────────────────────────────┘
```

Backdrop: `rgba(18, 18, 18, 0.92)` — dark enough to make QR pop, transparent enough to hint at the living session beneath.

### What Makes It Memorable

At a conference booth, the memorable moment is:

**"The music is playing, the grid is pulsing, and there's this big QR code on the side. I scan it and suddenly I'm IN the music."**

The QR isn't a separate "sharing screen" — it's integrated into the live session view. The session stays alive. That's the differentiator.

---

## URL Behavior

### Supported URLs

| URL Pattern | QR Modifier | Encodes |
|-------------|-------------|---------|
| `/s/{uuid}` | `/s/{uuid}?qr=1` | `/s/{uuid}` (join live session) |
| `/s/{uuid}?foo=bar` | `/s/{uuid}?foo=bar&qr=1` | `/s/{uuid}?foo=bar` (preserves other params) |

### Query Parameter Handling

When generating the QR code URL:
1. Start with current URL (origin + pathname + query params)
2. Remove only `qr=1` from query params
3. Encode resulting URL in QR

```typescript
function getQRTargetURL(currentURL: URL): string {
  const target = new URL(currentURL.toString());
  target.searchParams.delete('qr');
  return target.toString();
}
```

Simple: the QR encodes whatever URL you're on, minus the `?qr=1` display modifier.

---

## Display Modes

See [Design Direction → Spatial Composition](#spatial-composition) for visual layouts.

Display mode is determined by **both** viewport width and height:

```typescript
function getDisplayMode(width: number, height: number): DisplayMode {
  // Mobile landscape: width may be 800+, but height is ~300-400px
  // Use fullscreen modal for better UX
  if (height < 500) return 'small';

  if (width >= 1024) return 'large';
  if (width >= 768) return 'medium';
  return 'small';
}
```

**Why check height?** On mobile phones in landscape orientation, `window.innerWidth` is often 800-900px, which would incorrectly trigger "medium" mode (floating card). But mobile landscape has very limited vertical space (~300-400px), so we use height < 500px to detect this case and force "small" mode (fullscreen modal).

### Large Display (≥1024px viewport width)

Side panel that pushes content, not an overlay.

| Property | Value |
|----------|-------|
| Panel width | 280px fixed |
| QR size | 200×200px |
| Scan distance | ~8 feet |
| Sequencer | Remaining width, fully interactive |
| Animation | Slide in from right, 250ms ease-out |

### Medium Display (768px - 1023px width, height ≥500px)

Floating card in bottom-right corner. Used for tablets and smaller desktop windows.

| Property | Value |
|----------|-------|
| Card size | 220px × 280px |
| QR size | 160×160px |
| Position | Bottom-right, 16px margin |
| Dismiss | ✕ button |
| Animation | Fade + slide up, 200ms |

### Small Display (<768px width, OR height <500px)

Fullscreen modal with semi-transparent backdrop. Used for mobile phones in both portrait and landscape.

| Property | Value |
|----------|-------|
| QR size (portrait) | 240×240px |
| QR size (landscape) | 140×140px |
| Backdrop | `rgba(18, 18, 18, 0.92)` |
| Dismiss | Tap outside or ✕ button |
| Animation | Fade up from bottom, 200ms |
| Landscape behavior | Scrollable if content exceeds viewport |

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
│   Scan to join          │
│   "{session name}"      │  ← From session.name, or "Untitled Session"
│   {player count}        │  ← "3 people jamming" / "Just you"
│                         │
│   ─────────────────     │
│                         │
│   [ Copy Link ]         │  ← Copies QR target URL to clipboard
│   [ Exit QR Mode ]      │  ← Removes ?qr=1 from URL (large display only)
│                         │
└─────────────────────────┘
```

### Player Count Display

| State | Display |
|-------|---------|
| 1 player (just host) | "Just you" |
| 2+ players | "{n} people jamming" |

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
  onClose: () => void;
}

export function QROverlay({
  targetURL,
  sessionName,
  playerCount,
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
  targetURL: string;
  activate: () => void;
  deactivate: () => void;
}

export function useQRMode(): QRModeState {
  const [searchParams, setSearchParams] = useSearchParams();

  const isActive = searchParams.get('qr') === '1';

  const activate = () => {
    setSearchParams(params => {
      params.set('qr', '1');
      return params;
    });
  };

  const deactivate = () => {
    setSearchParams(params => {
      params.delete('qr');
      return params;
    });
  };

  const targetURL = useMemo(() => getQRTargetURL(window.location), []);

  return { isActive, targetURL, activate, deactivate };
}
```

---

## Integration with Existing UI

> **See also:** [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) for the complete sharing model and button ordering.

### Desktop: Share Button Enhancement

Add "Show QR Code" option to the Invite button dropdown:

```
┌──────────────────────────────────────────────────────────────────┐
│  [Publish]   [Remix]   [New]                        [Invite ▾]   │
│  ─────────────────────────                          ────────────  │
│       (filled)                                       (outline)   │
└──────────────────────────────────────────────────────────────────┘

Clicking "Invite ▾" shows dropdown:
┌─────────────────────┐
│  Copy Link          │  ← Copies session URL to clipboard
│  Show QR Code       │  ← Adds ?qr=1 to URL
└─────────────────────┘
```

### Mobile: Share Action Sheet

On mobile, the Invite button in the bottom action bar triggers an action sheet with sharing options:

```
┌─────────────────────────────┐
│ 🎵 Session Name             │
│ Remixed from "..."          │
├─────────────────────────────┤
│                             │
│   [Step Sequencer Grid]     │
│                             │
├─────────────────────────────┤
│ [📢]   [🔀]   [✨]    [👥]  │
│ Publish Remix  New   Invite │
└─────────────────────────────┘

Tapping [👥 Invite] opens action sheet:
┌─────────────────────────────────────┐
│                                     │
│   Invite to Session                 │
│   ─────────────────────────────     │
│                                     │
│   Copy Link                         │  ← Copies session URL to clipboard
│   Show QR Code                      │  ← Adds ?qr=1, shows fullscreen QR
│                                     │
│   ─────────────────────────────     │
│   Cancel                            │
│                                     │
└─────────────────────────────────────┘
```

**Why action sheet on mobile:**
- Individual buttons are cramped in mobile header
- Action sheet is native-feeling on iOS/Android
- Groups related sharing/invite actions together
- QR code is accessible but not primary (most mobile sharing is via copied links)

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

Total:        ~70 characters
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

## CSS Implementation

### Design Tokens

```css
:root {
  /* QR-specific tokens (extend existing Keyboardia palette) */
  --qr-bg: #121212;
  --qr-surface: #1a1a1a;
  --qr-code-light: #FFFFFF;
  --qr-code-dark: #1a1a1a;
  --qr-accent: var(--color-accent, #e85a30);
  --qr-text-primary: rgba(255, 255, 255, 0.9);
  --qr-text-secondary: #888888;
  --qr-player-count: #4ade80;
  --qr-backdrop: rgba(18, 18, 18, 0.92);

  /* Animation */
  --qr-enter-duration: 250ms;
  --qr-exit-duration: 150ms;
  --qr-ease: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### Accent Line Pulse Animation

```css
@keyframes accent-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.qr-accent-line {
  height: 2px;
  background: var(--qr-accent);
  animation: accent-pulse 2s ease-in-out infinite;
}
```

### Entrance Animations

```css
/* Large: slide from right */
@keyframes qr-slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* Mobile: fade up */
@keyframes qr-fade-up {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* QR code subtle scale */
@keyframes qr-code-enter {
  from {
    transform: scale(1.02);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* Staggered text reveal */
.qr-panel-text > * {
  opacity: 0;
  animation: qr-fade-up var(--qr-enter-duration) var(--qr-ease) forwards;
}

.qr-panel-text > :nth-child(1) { animation-delay: 0ms; }
.qr-panel-text > :nth-child(2) { animation-delay: 50ms; }
.qr-panel-text > :nth-child(3) { animation-delay: 100ms; }
```

### Typography

```css
.qr-action-text {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--qr-text-primary);
}

.qr-session-name {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 1rem;
  font-weight: 400;
  color: var(--qr-text-secondary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qr-player-count {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--qr-player-count);
  background: rgba(74, 222, 128, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
}
```

### Responsive Breakpoints

```css
/* Large: side panel */
@media (min-width: 1024px) {
  .qr-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 280px;
    background: var(--qr-bg);
    border-left: 1px solid var(--color-border);
    animation: qr-slide-in var(--qr-enter-duration) var(--qr-ease);
  }

  /* Push main content */
  .app.qr-active {
    margin-right: 280px;
  }
}

/* Medium: floating card */
@media (min-width: 768px) and (max-width: 1023px) {
  .qr-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: 220px;
    background: var(--qr-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: qr-fade-up var(--qr-enter-duration) var(--qr-ease);
  }
}

/* Small: fullscreen modal */
@media (max-width: 767px) {
  .qr-backdrop {
    position: fixed;
    inset: 0;
    background: var(--qr-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: qr-fade-up var(--qr-enter-duration) var(--qr-ease);
  }

  .qr-panel {
    background: transparent;
    text-align: center;
  }
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

## Mobile Best Practices

This section documents mobile-specific implementation patterns derived from research into Apple HIG, Material Design, and WCAG guidelines.

### Touch Target Sizing

**Minimum requirements:**
| Standard | Size | Notes |
|----------|------|-------|
| Apple HIG | 44×44pt | Buttons smaller than this are missed by >25% of users |
| Material Design | 48×48dp | Spacing: 8dp between targets |
| WCAG 2.5.5 (AAA) | 44×44 CSS px | Accessibility requirement |

**Implementation:**
- Close button: 44×44px minimum (not 32px)
- Action buttons: Full-width on mobile for easy tapping
- Use invisible hit area expansion if visual design requires smaller appearance

### Safe Area Handling

**Required meta tag:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

**CSS environment variables:**
```css
.qr-overlay-small {
  padding: env(safe-area-inset-top, 0)
           env(safe-area-inset-right, 0)
           env(safe-area-inset-bottom, 0)
           env(safe-area-inset-left, 0);
}

.qr-close-btn {
  top: max(8px, env(safe-area-inset-top, 8px));
  right: max(8px, env(safe-area-inset-right, 8px));
}
```

**Why this matters:**
- iPhone notch can obscure content in landscape
- Android gesture navigation requires bottom padding
- Browser URL bar changes viewport height dynamically

### Viewport Units (The 100vh Problem)

Mobile browsers calculate `100vh` based on the **maximum** viewport (URL bar hidden), causing content to extend beyond the visible area when the URL bar is visible.

**Modern viewport units (Safari 15.4+, Chrome 94+):**
| Unit | Meaning | Use case |
|------|---------|----------|
| `svh` | Small viewport (URL bar visible) | Most layouts (conservative) |
| `lvh` | Large viewport (URL bar hidden) | Full-screen experiences |
| `dvh` | Dynamic (adjusts in real-time) | Use sparingly, can cause layout thrashing |

**Recommended pattern:**
```css
.qr-overlay-small {
  min-height: 100svh;
  /* Fallback for older browsers */
  min-height: -webkit-fill-available;
}
```

### Orientation Change Handling

**Portrait to landscape transitions:**
- Content should reflow naturally without dismissing the modal
- Maintain scroll position when switching
- Use flexible layouts that adapt to available space

**Mobile landscape layout:**
```css
@media (max-width: 767px) and (orientation: landscape) {
  .qr-overlay-small {
    flex-direction: row; /* Horizontal layout */
  }

  .qr-overlay-small .qr-panel-content {
    flex-direction: row;
    gap: 24px;
  }

  .qr-overlay-small .qr-code {
    width: 140px;
    height: 140px;
  }
}
```

**Avoiding iOS zoom bug:**
The iOS Safari zoom bug on orientation change can be mitigated, but requires JavaScript intervention. For now, we accept this browser limitation.

### Backdrop Opacity Guidelines

| Context | Recommended opacity |
|---------|---------------------|
| Light UI | 40% black `rgba(0,0,0,0.4)` |
| Dark UI | 60-70% black |
| Media modals | 85% black |
| **Keyboardia QR** | 92% `rgba(18,18,18,0.92)` — intentionally heavy to maximize QR visibility |

**With backdrop blur (optional enhancement):**
```css
.qr-overlay-small {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

@supports not (backdrop-filter: blur(10px)) {
  .qr-overlay-small {
    background: rgba(0, 0, 0, 0.8); /* Darker fallback */
  }
}
```

**Performance note:** Backdrop blur is expensive on mobile — test on low-end devices.

### Body Scroll Lock

Prevent background scrolling while modal is open:

```typescript
useEffect(() => {
  document.body.style.overflow = 'hidden';
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;

  return () => {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  };
}, []);
```

### Focus Trap (Accessibility)

Modal should trap focus to prevent tabbing to background elements:

```typescript
const handleTabKey = (e: React.KeyboardEvent) => {
  if (e.key !== 'Tab') return;

  const focusableElements = overlayRef.current?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  // Cycle focus within modal
  // ... (see implementation in QROverlay.tsx)
};
```

### Common Mobile Pitfalls

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Text overlap on rotation | Absolute positioning without safe areas | Use relative positioning + safe area padding |
| Close button unreachable | Too close to notch/system UI | Use `max(8px, env(safe-area-inset-*))` |
| Content cut off by URL bar | Using `100vh` instead of `svh` | Use `svh` or `dvh` units |
| Touch target too small | Visual design override | Ensure 44×44px minimum |
| Background still scrollable | Missing scroll lock | Add `overflow: hidden` to body |

### References

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Material Design Touch Targets](https://m2.material.io/develop/web/supporting/touch-target)
- [New Viewport Units - Ahmad Shadeed](https://ishadeed.com/article/new-viewport-units/)
- [Safe Area Insets - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [WCAG 2.5.5 Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)

---

## Analytics Events

Track QR mode usage for understanding adoption:

```typescript
interface QRAnalyticsEvents {
  'qr_mode_activated': {
    display_mode: 'large' | 'medium' | 'small';
    session_player_count: number;
  };
  'qr_mode_closed': {
    method: 'button' | 'escape' | 'tap_outside';
    duration_ms: number;
  };
  'qr_link_copied': {};
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

### Phase 1: Core QR Overlay (MVP) ✅ Complete
- [x] Add `qrcode` dependency
- [x] Create `QRCode` component (SVG generation)
- [x] Create `QROverlay` component
- [x] Create `useQRMode` hook
- [x] Add `?qr=1` URL parameter handling
- [x] Integrate into `App.tsx`
- [x] Basic styling

### Phase 2: Responsive Modes ✅ Complete
- [x] Implement large display mode (side panel)
- [x] Implement medium display mode (floating overlay)
- [x] Implement small display mode (fullscreen)
- [x] Add display mode detection hook (`useDisplayMode`)
- [x] Responsive CSS

### Phase 3: Invite Button Integration ✅ Partial
- [x] Add dropdown to Invite button (desktop)
- [x] "Show QR Code" option in dropdown
- [ ] Create action sheet component (mobile) — *uses same dropdown currently*

### Phase 4: Polish ✅ Complete
- [x] Keyboard navigation (Escape to close)
- [x] Focus management
- [x] Copy Link button in QR panel
- [x] Player count display
- [x] Session name display
- [ ] Screen reader improvements (labels exist, could enhance)
- [ ] Analytics events

### Phase 5: Future Enhancements (Optional)
- [ ] Animated QR appearance
- [ ] "Scan successful" detection (via WebSocket player join)

---

## Testing

### Unit Tests

```typescript
describe('useQRMode', () => {
  it('detects ?qr=1 in URL', () => {});
  it('returns correct target URL without qr param', () => {});
  it('activate() adds qr=1 to URL', () => {});
  it('deactivate() removes qr from URL', () => {});
});

describe('QRCode', () => {
  it('generates valid SVG for URL', () => {});
  it('handles long URLs', () => {});
  it('applies correct error correction level', () => {});
});

describe('getQRTargetURL', () => {
  it('removes qr=1 from target', () => {});
  it('preserves other query params', () => {});
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

test('QR encodes URL without qr param', async ({ page }) => {
  await page.goto('/s/test-session?foo=bar&qr=1');
  // Verify QR contains /s/test-session?foo=bar (without qr=1)
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
- [ ] Mobile share action sheet works correctly

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

app/src/components/ShareActionSheet/
├── ShareActionSheet.tsx
├── ShareActionSheet.css
└── index.ts

app/src/hooks/useQRMode.ts
app/src/hooks/useDisplayMode.ts
app/src/utils/qr.ts
```

### Modified Files
```
app/package.json               # Add qrcode dependency
app/src/App.tsx                # Integrate QROverlay, Invite button dropdown
app/src/App.css                # Layout adjustments for side panel
```

---

## Philosophy Alignment

### How QR Fits Keyboardia's Core Principles

| Principle | How QR Supports It |
|-----------|-------------------|
| **"Everyone hears the same music"** | Scanners join the live session, hearing exactly what's playing |
| **Ephemeral jam sessions** | QR is a presentation layer, not a new data type or persistence model |
| **No accounts required** | Scan → join. Zero friction. |
| **Against mode switching** | `?qr=1` is a URL modifier, not a modal or separate view |
| **Direct manipulation** | QR is honest — it shows the URL it encodes, no magic |

### The Booth Tension

The spec optimizes for **conference booth** scenarios, but there's an inherent tension:

**Scenario:** You're demoing Keyboardia at a booth. You show a QR code. 20 people scan it.

**What happens:** All 20 people can now toggle steps in your demo. Your carefully crafted beat may get modified by strangers.

**Is this a problem?** Maybe not — Keyboardia's philosophy is collaborative. The "chaos" of 20 people editing together might be the *feature*, not the bug. It demonstrates real-time sync.

**If it is a problem:** The host should:
1. Use **Publish** first (creates an immutable copy)
2. Show QR for *that* published session
3. Visitors view the published session and can Remix to edit their own copy

This pattern preserves the "demo" in immutable form while still enabling derivation. See [SHARING-AND-PUBLISHING.md](./SHARING-AND-PUBLISHING.md) for the complete sharing model.

### Publishing Integration ✅

**Publishing (Immutable Sessions):** Now implemented. QR codes for published sessions lead to a read-only "museum glass" experience with a prominent "Remix" button. Visitors can listen and press Remix to create their own editable copy. This is ideal for booth demos where you want to showcase without vandalism risk.

**Session Provenance:** When a scanner joins via QR and later remixes, the lineage is preserved. The session shows "Remixed from [Conference Demo]" — the QR becomes part of the provenance story.

---

## Design Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12 | `?qr=1` as URL modifier | Composable, works with any URL, no new routes |
| 2025-12 | No intent parameter | Simplicity; use Publish for "give them a copy" flows (immutable), Invite for collaboration |
| 2025-12 | No spectate mode | Not implementing read-only; collaboration is the point |
| 2025-12 | Session stays visible | Differentiator — "the music is playing" while showing QR |
| 2025-12 | Mobile action sheet | Groups sharing options; native-feeling on iOS/Android |
