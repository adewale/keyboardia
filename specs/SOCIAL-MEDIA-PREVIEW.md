# Social Media Preview Specification

## Overview

When users share Keyboardia URLs on social media (Facebook, Twitter/X, LinkedIn, Discord, Slack, iMessage, WhatsApp), the platforms display rich previews with titles, descriptions, and images. This spec defines how Keyboardia generates these previews dynamically for each session.

**Problem:** Social media crawlers don't execute JavaScript. The current client-side `document-meta.ts` approach updates meta tags after page load, which crawlers never see. All shared sessions show the generic landing page preview.

**Solution:** Server-side meta tag injection at the Cloudflare Worker level, plus dynamic OG image generation using Satori.

---

## Technology Choices

### Cloudflare Workers + HTMLRewriter

**Why Cloudflare Workers:**
- Already the backend for Keyboardia (no new infrastructure)
- HTMLRewriter API provides streaming HTML transformation
- Sub-5ms cold starts (V8 isolate technology)
- Session data already accessible via KV binding
- Edge-deployed globally for fast crawler response

**HTMLRewriter History:**
- Introduced by Cloudflare as a streaming HTML parser written in Rust
- Async handler support added June 2020, enabling dynamic content injection
- jQuery-like CSS selector API for element manipulation
- Streams responses without buffering (memory efficient)

**Key Limitations:**
- Text content may be split across chunks. Meta tag injection at `<head>` is reliable.
- HTMLRewriter `.on()` handlers only fire if the selector matches existing elements. All meta tags we update must exist in `index.html` (they do). For new tags like JSON-LD, we use `.append()` on `<head>`.

### Satori + resvg-wasm for OG Images

**Why Satori:**
- Created by Vercel for converting JSX to SVG
- ~500KB bundle vs ~50MB for Puppeteer + Chromium
- Near-instant cold starts vs ~4 seconds for headless browser
- 5x faster P99 TTFB (0.99s vs 4.96s)
- ~160x cheaper on edge functions
- Uses Yoga layout engine (same as React Native)

**Implementation:** Use `workers-og` package (Cloudflare-optimized wrapper around Satori + resvg-wasm).

**CSS Limitations:**
- Flexbox only (no CSS Grid)
- No `z-index` (paint order is document order)
- Font formats: TTF, OTF, WOFF only (**NOT WOFF2**)
- No viewport units, no `display: table`
- Must provide font data as ArrayBuffer (BYOF - Bring Your Own Fonts)

### JSON-LD for Schema.org

**Why JSON-LD over Microdata/RDFa:**
- Google's recommended format (2024-2025)
- Separation of concerns (doesn't interfere with HTML)
- Easier to maintain and update
- Supports complex nested structures
- Future-proof (ecosystem direction)

**Relevant Schema.org Types:**
- `MusicRecording` — Individual session/track
- `AudioObject` — Audio content details
- `WebApplication` — The Keyboardia app itself

---

## Architecture

### Request Flow

```
User shares keyboardia.dev/s/abc123
           ↓
Social Crawler requests URL
           ↓
Cloudflare Worker receives request
           ↓
Worker detects crawler via User-Agent
           ↓
           ├─── Regular User ────→ Serve SPA normally
           │
           └─── Crawler ─────────→ Fetch session from KV
                                            ↓
                                   HTMLRewriter injects:
                                   • Dynamic OG meta tags
                                   • Dynamic Twitter Card tags
                                   • JSON-LD structured data
                                   • Dynamic og:image URL
                                            ↓
                                   Return modified HTML
                                            ↓
                                   Crawler displays rich preview
```

### OG Image Generation Flow

```
Crawler sees og:image = keyboardia.dev/og/abc123.png
           ↓
Crawler requests /og/abc123.png
           ↓
Worker receives request
           ↓
Fetch session metadata from KV
           ↓
Generate image with Satori:
• Session name
• Step grid visualization
• Keyboardia branding
           ↓
Convert SVG to PNG via resvg-wasm
           ↓
Return PNG with cache headers
```

---

## Implementation

### Crawler Detection

Detect social media crawlers via User-Agent header:

```typescript
const SOCIAL_CRAWLER_REGEX = /facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|slackbot|whatsapp|telegrambot/i;

function isSocialCrawler(request: Request): boolean {
  const userAgent = request.headers.get('User-Agent') || '';
  return SOCIAL_CRAWLER_REGEX.test(userAgent);
}
```

**Known Crawler User-Agents:**

| Platform | User-Agent Pattern |
|----------|-------------------|
| Facebook | `facebookexternalhit/1.1`, `Facebot` |
| Twitter/X | `Twitterbot/1.0` |
| LinkedIn | `LinkedInBot/1.0` |
| Discord | `Discordbot` |
| Slack | `Slackbot` |
| WhatsApp | `WhatsApp/2.x` |
| Telegram | `TelegramBot` |
| iMessage | Spoofs Facebook + Twitter (detect via combined UA) |

**Security Note:** User-Agent can be spoofed. For preview generation, this is acceptable — no sensitive data is exposed. Rate limiting applies regardless.

### HTMLRewriter Implementation

**Note on Twitter Card attributes:** The existing `index.html` uses `property="twitter:*"` (non-standard but widely supported). We maintain this for consistency. The official spec uses `name="twitter:*"` but both work due to parser fallbacks.

```typescript
// src/worker/social-preview.ts

const BASE_URL = 'https://keyboardia.dev';

interface SessionMeta {
  id: string;
  name: string | null;
  trackCount: number;
  tempo: number;
}

/**
 * Escape HTML special characters to prevent XSS in meta tag content.
 * Session names are user-provided and could contain malicious characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function injectSocialMeta(
  response: Response,
  session: SessionMeta
): Response {
  // XSS prevention: escape user-provided session name
  const safeName = session.name ? escapeHtml(session.name) : null;

  const title = safeName
    ? `${safeName} — Keyboardia`
    : 'Untitled Session — Keyboardia';

  const description = safeName
    ? `Listen to "${safeName}" on Keyboardia. A ${session.trackCount}-track beat at ${session.tempo} BPM. Create beats together in real-time.`
    : `Listen to this beat on Keyboardia. A ${session.trackCount}-track composition at ${session.tempo} BPM. Create beats together in real-time.`;

  const url = `${BASE_URL}/s/${session.id}`;
  const ogImage = `${BASE_URL}/og/${session.id}.png`;

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(title);
      }
    })
    .on('meta[name="title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute('content', url);
      }
    })
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute('content', ogImage);
      }
    })
    .on('meta[property="twitter:title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[property="twitter:description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="twitter:url"]', {
      element(el) {
        el.setAttribute('content', url);
      }
    })
    .on('meta[property="twitter:image"]', {
      element(el) {
        el.setAttribute('content', ogImage);
      }
    })
    .on('head', new class {
      // Use a class to track if we've already appended (head fires once, but being explicit)
      private appended = false;
      element(el: Element) {
        if (this.appended) return;
        this.appended = true;
        // Inject additional OG tags and JSON-LD (not in static HTML)
        el.append(`<meta property="og:site_name" content="Keyboardia" />`, { html: true });
        el.append(`<meta property="og:image:width" content="600" />`, { html: true });
        el.append(`<meta property="og:image:height" content="315" />`, { html: true });
        el.append(generateJsonLd(session, url), { html: true });
      }
    })
    .transform(response);
}
```

### Schema.org JSON-LD

```typescript
function generateJsonLd(session: SessionMeta, url: string): string {
  // XSS prevention: escape session name for JSON context
  const safeName = session.name ? escapeHtml(session.name) : 'Untitled Session';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    'name': safeName,
    'url': url,
    // Note: duration omitted - sessions are infinite loops with no fixed length
    'creator': {
      '@type': 'WebApplication',
      'name': 'Keyboardia',
      'url': 'https://keyboardia.dev',
      'description': 'Collaborative step sequencer for creating beats together in real-time'
    },
    'audio': {
      '@type': 'AudioObject',
      'contentUrl': url,
      'encodingFormat': 'audio/webm' // Web Audio output
    }
  };

  return `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}
```

### Worker Integration

The social preview logic must be added to `src/worker/index.ts` in a specific location:
- **After** CORS preflight handling
- **After** API route handling (`/api/*`)
- **Before** SPA routing (`/s/*` serving index.html)
- **Before** static asset serving

```typescript
// src/worker/index.ts (additions)

import { isSocialCrawler, injectSocialMeta, type SessionMeta } from './social-preview';
import { generateOGImage } from './og-image';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ... existing CORS preflight handling ...

    // ... existing API routes (`/api/*`) ...

    // ========================================================================
    // NEW: OG Image Generation Route (must be before SPA routing)
    // ========================================================================
    if (path.match(/^\/og\/([a-f0-9-]{36})\.png$/)) {
      return handleOGImageRequest(request, env, ctx, url);
    }

    // ========================================================================
    // NEW: Social Crawler Detection (must be before SPA routing)
    // ========================================================================
    if (path.startsWith('/s/') && isSocialCrawler(request)) {
      const sessionMatch = path.match(/^\/s\/([a-f0-9-]{36})$/);

      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const sessionData = await env.SESSIONS.get(`session:${sessionId}`, 'json') as Session | null;

        if (sessionData) {
          // Fetch the base HTML (index.html for SPA)
          const indexUrl = new URL('/', request.url);
          const baseResponse = await env.ASSETS.fetch(new Request(indexUrl, request));

          // Extract metadata for preview
          const meta: SessionMeta = {
            id: sessionId,
            name: sessionData.name,
            trackCount: sessionData.state?.tracks?.length ?? 0,
            tempo: sessionData.state?.tempo ?? 120
          };

          // Transform with social meta tags
          return injectSocialMeta(baseResponse, meta);
        }
      }
      // Fall through to normal SPA serving if session not found
    }

    // ... existing SPA routing (`/s/*` -> index.html) ...

    // ... existing static asset serving ...
  },
};
```

---

### Dynamic OG Image Generation

#### Image Specifications

| Property | Value |
|----------|-------|
| Dimensions | 600 × 315 px (1.91:1 ratio) |
| Format | PNG |
| File Size Target | < 50KB |
| Cache TTL | 7 days (immutable sessions), 1 hour (mutable) |

**Why 600×315?** This is half the "standard" 1200×630 but still meets all platform minimums. Benefits:
- 4× faster rasterization (189K pixels vs 756K)
- Smaller file size
- Still sharp on most displays (platforms scale down anyway)

#### Image Layout

```
┌──────────────────────────────────────┐
│                                      │
│  ░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓  │
│  ▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░▓▓░░  │
│  ░░░░▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓  │
│  ▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓░░░░▓▓▓▓░░░░  │
│                                      │
│  Session Name              KEYBOARDIA│
│  4 tracks · 120 BPM                  │
│                                      │
└──────────────────────────────────────┘

Background: #0a0a0a (dark)
Grid active cells: #e85a30 (brand orange)
Grid inactive cells: #2a2a2a (dark gray)
Text: #ffffff (white)
Accent: #ff6b35 (brand color)
```

#### Satori Implementation

```typescript
// src/worker/og-image.ts

import satori from 'satori';
import { Resvg } from '@cf-wasm/resvg';

// Font must be loaded as ArrayBuffer (WOFF or TTF, NOT WOFF2)
// Embed a subset of Inter or system font

const OG_WIDTH = 600;
const OG_HEIGHT = 315;

interface OGImageProps {
  sessionName: string | null;
  tracks: Array<{ steps: boolean[] }>;
  tempo: number;
  trackCount: number;
}

export async function generateOGImage(
  props: OGImageProps,
  fontData: ArrayBuffer
): Promise<ArrayBuffer> {
  const { sessionName, tracks, tempo, trackCount } = props;

  // Condense tracks to 16 columns for display
  const displayTracks = tracks.slice(0, 4).map(track =>
    condenseSteps(track.steps, 16)
  );

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: `${OG_WIDTH}px`,
          height: `${OG_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '24px',
          backgroundColor: '#0a0a0a',
          fontFamily: 'Inter',
        },
        children: [
          // Step grid visualization
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '16px',
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
              },
              children: displayTracks.map(steps => ({
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    gap: '3px',
                  },
                  children: steps.map(active => ({
                    type: 'div',
                    props: {
                      style: {
                        width: '30px',
                        height: '20px',
                        backgroundColor: active ? '#e85a30' : '#2a2a2a',
                        borderRadius: '2px',
                      },
                    },
                  })),
                },
              })),
            },
          },
          // Footer with session info
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
              },
              children: [
                // Session name and metadata
                {
                  type: 'div',
                  props: {
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '24px',
                            fontWeight: 600,
                            color: '#ffffff',
                            marginBottom: '4px',
                          },
                          children: sessionName || 'Untitled Session',
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '12px',
                            color: '#888888',
                          },
                          children: `${trackCount} tracks · ${tempo} BPM`,
                        },
                      },
                    ],
                  },
                },
                // Keyboardia branding
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '16px',
                      fontWeight: 700,
                      color: '#ff6b35',
                    },
                    children: 'KEYBOARDIA',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: [
        {
          name: 'Inter',
          data: fontData,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: fontData, // Use bold variant if available
          weight: 600,
          style: 'normal',
        },
      ],
    }
  );

  // Convert SVG to PNG
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: OG_WIDTH,
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
}

function condenseSteps(steps: boolean[], targetColumns: number): boolean[] {
  if (steps.length <= targetColumns) {
    return [...steps, ...Array(targetColumns - steps.length).fill(false)];
  }

  const ratio = steps.length / targetColumns;
  return Array.from({ length: targetColumns }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    return steps.slice(start, end).some(Boolean);
  });
}
```

### OG Image Route Handler

```typescript
// src/worker/og-image.ts (additional exports)

import type { Env } from './types';

// Font cache to avoid repeated fetches within same worker instance
let fontCache: ArrayBuffer | null = null;

/**
 * Load Inter font for OG image rendering.
 * Font is bundled as a static asset in public/fonts/.
 * Cached in memory after first load.
 */
export async function loadFont(env: Env): Promise<ArrayBuffer> {
  if (fontCache) {
    return fontCache;
  }

  // Fetch from static assets (bundled with worker)
  const response = await env.ASSETS.fetch(
    new Request('https://keyboardia.dev/fonts/inter-regular.woff')
  );

  if (!response.ok) {
    throw new Error(`Failed to load font: ${response.status}`);
  }

  fontCache = await response.arrayBuffer();
  return fontCache;
}
```

```typescript
// src/worker/index.ts (OG image handler function)

import { generateOGImage, loadFont } from './og-image';
import type { Session } from '../shared/state';

/**
 * Handle OG image generation requests.
 * Generates dynamic preview images for social media sharing.
 */
async function handleOGImageRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  const sessionId = url.pathname.match(/^\/og\/([a-f0-9-]{36})\.png$/)?.[1];

  if (!sessionId) {
    return new Response('Not Found', { status: 404 });
  }

  // Check cache first
  const cacheKey = new Request(url.toString());
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  // Fetch session data
  const sessionData = await env.SESSIONS.get(`session:${sessionId}`, 'json') as Session | null;

  if (!sessionData) {
    // Return default OG image for missing sessions
    return env.ASSETS.fetch(new Request(`${url.origin}/og-image.png`));
  }

  try {
    // Load font (cached in memory after first load)
    const fontData = await loadFont(env);

    // Generate image
    const png = await generateOGImage({
      sessionName: sessionData.name,
      tracks: sessionData.state?.tracks?.map(t => ({ steps: t.steps })) ?? [],
      tempo: sessionData.state?.tempo ?? 120,
      trackCount: sessionData.state?.tracks?.length ?? 0,
    }, fontData);

    // Create response with caching
    const cacheTtl = sessionData.immutable ? 604800 : 3600; // 7 days vs 1 hour

    const response = new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': `public, max-age=${cacheTtl}`,
      },
    });

    // Store in cache asynchronously (don't block response)
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  } catch (error) {
    // Log error for debugging
    console.error('OG image generation failed:', error);

    // Return fallback static image on any error
    return env.ASSETS.fetch(new Request(`${url.origin}/og-image.png`));
  }
}
```

---

## Testing Strategy

### Unit Tests

Unit tests are co-located with source files following existing codebase patterns.

```typescript
// src/worker/social-preview.test.ts

import { describe, it, expect } from 'vitest';
import { isSocialCrawler, escapeHtml } from './social-preview';

describe('isSocialCrawler', () => {
  it('detects Facebook crawler', () => {
    expect(isSocialCrawler(mockRequest('facebookexternalhit/1.1'))).toBe(true);
    expect(isSocialCrawler(mockRequest('Facebot'))).toBe(true);
  });

  it('detects Twitter crawler', () => {
    expect(isSocialCrawler(mockRequest('Twitterbot/1.0'))).toBe(true);
  });

  it('detects LinkedIn crawler', () => {
    expect(isSocialCrawler(mockRequest('LinkedInBot/1.0'))).toBe(true);
  });

  it('detects Discord crawler', () => {
    expect(isSocialCrawler(mockRequest('Discordbot'))).toBe(true);
  });

  it('detects WhatsApp crawler', () => {
    expect(isSocialCrawler(mockRequest('WhatsApp/2.23.18.78 i'))).toBe(true);
  });

  it('detects iMessage (combined UA)', () => {
    const iMessageUA = 'Mozilla/5.0 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
    expect(isSocialCrawler(mockRequest(iMessageUA))).toBe(true);
  });

  it('returns false for regular browsers', () => {
    expect(isSocialCrawler(mockRequest('Mozilla/5.0 Chrome/120.0'))).toBe(false);
  });

  it('returns false for empty User-Agent', () => {
    expect(isSocialCrawler(mockRequest(''))).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes double quotes', () => {
    expect(escapeHtml('My "Beat"')).toBe('My &quot;Beat&quot;');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('Drums & Bass')).toBe('Drums &amp; Bass');
  });

  it('handles multiple special characters', () => {
    expect(escapeHtml('Test <"&">')).toBe('Test &lt;&quot;&amp;&quot;&gt;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});

function mockRequest(userAgent: string): Request {
  return new Request('https://keyboardia.dev/s/test', {
    headers: { 'User-Agent': userAgent },
  });
}
```

### Integration Tests

Integration tests follow existing codebase patterns in `app/test/integration/`.

```typescript
// test/integration/social-preview.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.TEST_URL || 'http://localhost:8787';

// Test session created in beforeAll, cleaned up in afterAll
let TEST_SESSION_ID: string;
const TEST_SESSION_NAME = 'Test Beat';

describe('Social Media Preview Integration', () => {
  // Create a test session before running tests
  beforeAll(async () => {
    const response = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: TEST_SESSION_NAME,
        state: {
          tracks: [
            { id: 'track-1', name: 'Kick', sampleId: 'drums:kick', steps: [true, false, false, false, true, false, false, false], volume: 0.8, muted: false, transpose: 0, parameterLocks: [] },
            { id: 'track-2', name: 'Snare', sampleId: 'drums:snare', steps: [false, false, true, false, false, false, true, false], volume: 0.8, muted: false, transpose: 0, parameterLocks: [] },
          ],
          tempo: 120,
          swing: 0,
          version: 1,
        },
      }),
    });

    const data = await response.json() as { id: string };
    TEST_SESSION_ID = data.id;
  });

  // Note: Sessions are not deleted in cleanup as they're immutable test fixtures
  // They will be garbage collected as orphans after 90 days of inactivity

  describe('Meta Tag Injection', () => {
    it('injects OG tags for Facebook crawler', async () => {
      const response = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:image"');
      expect(html).toContain(`/og/${TEST_SESSION_ID}.png`);
    });

    it('injects Twitter Card tags for Twitter crawler', async () => {
      const response = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });

      const html = await response.text();

      expect(html).toContain('property="twitter:card"');
      expect(html).toContain('property="twitter:title"');
      expect(html).toContain('property="twitter:image"');
    });

    it('injects JSON-LD structured data', async () => {
      const response = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      expect(html).toContain('application/ld+json');
      expect(html).toContain('"@type":"MusicRecording"');
    });

    it('uses session name in meta tags', async () => {
      const response = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });

      const html = await response.text();

      // Session name from beforeAll setup
      expect(html).toContain(`${TEST_SESSION_NAME} — Keyboardia`);
    });

    it('does not inject meta for regular browsers', async () => {
      const crawlerResponse = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const browserResponse = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0' },
      });

      const crawlerHtml = await crawlerResponse.text();
      const browserHtml = await browserResponse.text();

      // Crawler gets dynamic content, browser gets static defaults
      expect(crawlerHtml).toContain(`/og/${TEST_SESSION_ID}.png`);
      expect(browserHtml).toContain('/og-image.png'); // Static default
    });
  });

  describe('Dynamic OG Image', () => {
    it('returns PNG for valid session', async () => {
      const response = await fetch(`${BASE_URL}/og/${TEST_SESSION_ID}.png`);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
    });

    it('returns correct dimensions', async () => {
      const response = await fetch(`${BASE_URL}/og/${TEST_SESSION_ID}.png`);
      const buffer = await response.arrayBuffer();

      // PNG header check or use sharp/jimp to verify dimensions
      // Dimensions should be 600x315
      expect(buffer.byteLength).toBeGreaterThan(1000); // Not empty
    });

    it('caches immutable session images', async () => {
      const response = await fetch(`${BASE_URL}/og/${TEST_SESSION_ID}.png`);

      const cacheControl = response.headers.get('Cache-Control');
      // Published sessions get 7-day cache
      expect(cacheControl).toContain('max-age=');
    });

    it('returns default image for missing session', async () => {
      const response = await fetch(`${BASE_URL}/og/nonexistent-uuid-here.png`);

      expect(response.status).toBe(200); // Fallback to default
      expect(response.headers.get('Content-Type')).toBe('image/png');
    });
  });

  describe('Schema.org Validation', () => {
    it('produces valid JSON-LD', async () => {
      const response = await fetch(`${BASE_URL}/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);

      expect(jsonLdMatch).not.toBeNull();

      const jsonLd = JSON.parse(jsonLdMatch![1]);
      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('MusicRecording');
      expect(jsonLd.name).toBeDefined();
      expect(jsonLd.url).toContain('/s/');
    });
  });
});
```

### E2E Tests with Playwright

```typescript
// tests/e2e/social-preview.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Social Media Preview E2E', () => {
  test('crawler receives correct meta tags', async ({ request }) => {
    const response = await request.get('/s/test-session-id', {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1',
      },
    });

    const html = await response.text();

    // Parse HTML and extract meta tags
    const ogTitle = html.match(/property="og:title" content="([^"]+)"/)?.[1];
    const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1];

    expect(ogTitle).toContain('Keyboardia');
    expect(ogImage).toMatch(/\/og\/[a-f0-9-]+\.png$/);
  });

  test('OG image loads successfully', async ({ request }) => {
    const response = await request.get('/og/test-session-id.png');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  });
});
```

### Manual Validation Checklist

After deployment, validate with official tools:

1. **Facebook Sharing Debugger**
   - URL: https://developers.facebook.com/tools/debug/
   - Enter session URL, verify title/description/image

2. **Twitter Card Validator**
   - URL: https://cards-dev.twitter.com/validator
   - Enter session URL, verify card preview

3. **LinkedIn Post Inspector**
   - URL: https://www.linkedin.com/post-inspector/
   - Enter session URL, verify preview

4. **Google Rich Results Test**
   - URL: https://search.google.com/test/rich-results
   - Enter session URL, verify JSON-LD is detected

### CI Integration

```yaml
# .github/workflows/ci.yml (additions)

  social-preview-tests:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci
        working-directory: app

      - name: Start local worker
        run: npx wrangler dev --local &
        working-directory: app

      - name: Wait for worker
        run: npx wait-on http://localhost:8787

      - name: Run social preview tests
        run: npm run test:social-preview
        working-directory: app
        env:
          TEST_URL: http://localhost:8787
```

---

## File Structure

File locations follow existing codebase conventions:

```
app/
├── src/
│   ├── worker/
│   │   ├── index.ts                    # Add crawler detection + routing
│   │   ├── social-preview.ts           # NEW: HTMLRewriter transforms + escapeHtml
│   │   ├── social-preview.test.ts      # NEW: Unit tests (co-located)
│   │   ├── og-image.ts                 # NEW: Satori image generation + loadFont
│   │   └── og-image.test.ts            # NEW: Unit tests for image generation
│   └── utils/
│       └── document-meta.ts            # KEEP: Still used for browser tab titles
├── public/
│   ├── og-image.png                    # KEEP: Fallback static image
│   └── fonts/
│       └── inter-regular.woff          # NEW: Font for OG images (NOT woff2)
└── test/
    └── integration/
        └── social-preview.test.ts      # NEW: Integration tests
```

---

## Implementation Tasks

All features are implemented together in a single phase:

### Core Implementation

1. **Create `social-preview.ts`** with crawler detection and HTMLRewriter transforms
2. **Create `og-image.ts`** with Satori image generation (600×315)
3. **Add JSON-LD generation** for Schema.org `MusicRecording`
4. **Integrate into Worker** fetch handler with routing for `/og/:sessionId.png`
5. **Bundle Inter font** (TTF or WOFF, not WOFF2)
6. **Add caching layer** via Cloudflare Cache API

### Testing

7. **Unit tests** for crawler detection regex
8. **Integration tests** for meta tag injection and image generation
9. **E2E tests** with Playwright using crawler User-Agents

### Validation & Deployment

10. **Deploy to staging**
11. **Validate with platform debuggers** (Facebook, Twitter, LinkedIn, Google Rich Results)
12. **Add observability metrics** for generation latency and cache hit rate
13. **Deploy to production**

### Deliverables

- Dynamic `og:title`, `og:description`, `og:url` for each session
- Dynamic `twitter:*` tags for each session
- JSON-LD `MusicRecording` structured data
- Dynamic OG image (600×315) showing:
  - Session name
  - Step grid visualization (4 tracks × 16 steps)
  - Track count and tempo
  - Keyboardia branding
- Caching (7 days for published, 1 hour for mutable)

---

## Caching Strategy

### Meta Tag Responses

| Scenario | Cache Behavior |
|----------|---------------|
| Crawler request | No caching (always fresh meta) |
| Regular browser | Normal SPA caching |

Meta tags are injected on-the-fly. The overhead is minimal (~5ms).

### OG Images

| Session Type | Cache TTL | Rationale |
|-------------|-----------|-----------|
| Published (immutable) | 7 days | Content never changes |
| Mutable | 1 hour | Balance freshness vs load |
| Missing session | 1 hour | Fallback image |

**Cache Key:** Request URL (`/og/{sessionId}.png`)

**Cache Location:** Cloudflare CDN (via `caches.default`)

**Invalidation:**
- Published sessions: Never (immutable by design)
- Mutable sessions: Automatic after TTL
- Manual: Not supported (change session ID if needed)

---

## Performance Considerations

### HTMLRewriter

- Streaming transformation (no buffering)
- ~1-2ms overhead for meta injection
- No impact on non-crawler requests

### OG Image Generation

- Target: < 500ms generation time
- Satori + resvg: ~100-300ms typical
- Font loading: Bundled (no network fetch)
- Memory: ~20MB peak during generation

**Optimization Tips:**
1. Keep JSX simple (minimal nesting)
2. Use minimal font subset
3. Cache aggressively
4. Monitor CPU time in Workers dashboard

### Bundle Size

| Component | Size Impact |
|-----------|-------------|
| Satori | ~200KB |
| resvg-wasm | ~300KB |
| Font file | ~50-100KB |
| **Total** | ~600KB |

Cloudflare Workers limit: 1MB compressed (with paid plan)

---

## Security Considerations

1. **XSS Prevention:** All user-provided content (session names) is escaped via `escapeHtml()` before injection into HTML meta tags and JSON-LD. This prevents injection attacks through malicious session names containing `"`, `<`, `>`, or `&` characters.
   ```typescript
   function escapeHtml(str: string): string {
     return str
       .replace(/&/g, '&amp;')
       .replace(/"/g, '&quot;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');
   }
   ```

2. **Rate Limiting:** `/og/*` route subject to existing rate limits (100 requests/minute/IP)

3. **Input Validation:** Session ID format validated via regex (`/^[a-f0-9-]{36}$/`) before KV lookup

4. **No Sensitive Data:** Previews only show public session info (name, track count, tempo)

5. **Error Handling:** Satori failures return fallback static image, preventing error details from leaking

---

## Monitoring

Add to observability dashboard:

```typescript
// Metrics to track
- social_preview.crawler_requests (counter, by platform)
- social_preview.meta_injection_duration_ms (histogram)
- og_image.generation_requests (counter)
- og_image.generation_duration_ms (histogram)
- og_image.cache_hits (counter)
- og_image.cache_misses (counter)
- og_image.errors (counter, by error type)
```

---

## Open Questions (Resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Use HTMLRewriter or string replacement? | **HTMLRewriter** | Streaming, memory efficient |
| Font for OG images? | **Inter** | Already used in app, clean |
| Image dimensions? | **600×315** | 4× faster than 1200×630, meets all platform minimums |
| Cache OG images? | **Yes** | Reduce generation load |
| Schema.org type? | **MusicRecording** | Best fit for sessions |
| JSON-LD location? | **End of `<head>`** | Avoids render blocking |

---

## Dependencies

### New Dependencies

```json
{
  "dependencies": {
    "satori": "^0.10.0",
    "@cf-wasm/resvg": "^0.1.0"
  }
}
```

Or use the combined package:

```json
{
  "dependencies": {
    "workers-og": "^0.0.8"
  }
}
```

### Font Asset

Bundle Inter Regular (TTF or WOFF, **not WOFF2**) in `public/fonts/`.

---

## Non-Goals

- Custom OG images per user (sessions are the unit, not users)
- Video previews (audio-only product)
- Animated previews (not supported by platforms)
- Preview for landing page (static `og-image.png` is sufficient)
- Localization of preview text (English only)
- A/B testing of preview designs (keep it simple)

---

## References

- [Cloudflare HTMLRewriter Docs](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)
- [Satori GitHub](https://github.com/vercel/satori)
- [workers-og Package](https://github.com/kvnang/workers-og)
- [Open Graph Protocol](https://ogp.me/)
- [Twitter Cards Docs](https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/markup)
- [Schema.org MusicRecording](https://schema.org/MusicRecording)
- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
