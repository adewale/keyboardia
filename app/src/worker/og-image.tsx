/**
 * OG Image Generation Module
 *
 * Generates dynamic Open Graph images for social media sharing using Satori.
 * Images are 600x315 (1.91:1 ratio) for optimal platform compatibility.
 */

import { ImageResponse } from 'workers-og';
import type { Env } from './types';
import type { Session } from '../shared/state';

const OG_WIDTH = 600;
const OG_HEIGHT = 315;

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

// Brand colors
const COLORS = {
  background: '#0a0a0a',
  gridBackground: '#1a1a1a',
  activeStep: '#e85a30',
  inactiveStep: '#2a2a2a',
  text: '#ffffff',
  textMuted: '#888888',
  brand: '#ff6b35',
};

/**
 * OG image generation options
 */
interface OGImageProps {
  sessionName: string | null;
  tracks: Array<{ steps: boolean[] }>;
  tempo: number;
  trackCount: number;
}

/**
 * Condense steps to a fixed number of columns for display
 * Uses OR reduction: if any step in a segment is active, the column is active
 */
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

/**
 * Generate the OG image as an ImageResponse
 * Uses workers-og package which wraps Satori + resvg-wasm
 */
export async function generateOGImage(props: OGImageProps, fontData?: ArrayBuffer): Promise<Response> {
  const { sessionName, tracks, tempo, trackCount } = props;

  // Condense tracks to 16 columns for display (max 4 tracks shown)
  const displayTracks = tracks.slice(0, 4).map(track =>
    condenseSteps(track.steps, 16)
  );

  // Pad to 4 tracks if fewer
  while (displayTracks.length < 4) {
    displayTracks.push(Array(16).fill(false));
  }

  // Create the image using workers-og's ImageResponse
  // This uses Satori under the hood with a React-like JSX API
  return new ImageResponse(
    (
      <div
        style={{
          width: `${OG_WIDTH}px`,
          height: `${OG_HEIGHT}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '24px',
          backgroundColor: COLORS.background,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Step grid visualization */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '16px',
            backgroundColor: COLORS.gridBackground,
            borderRadius: '8px',
          }}
        >
          {displayTracks.map((steps, trackIndex) => (
            <div
              key={trackIndex}
              style={{
                display: 'flex',
                gap: '3px',
              }}
            >
              {steps.map((active, stepIndex) => (
                <div
                  key={stepIndex}
                  style={{
                    width: '30px',
                    height: '20px',
                    backgroundColor: active ? COLORS.activeStep : COLORS.inactiveStep,
                    borderRadius: '2px',
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Footer with session info */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          {/* Session name and metadata */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: '24px',
                fontWeight: 600,
                color: COLORS.text,
                marginBottom: '4px',
              }}
            >
              {sessionName || 'Untitled Session'}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: COLORS.textMuted,
              }}
            >
              {trackCount} tracks · {tempo} BPM
            </div>
          </div>

          {/* Keyboardia branding */}
          <div
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: COLORS.brand,
            }}
          >
            KEYBOARDIA
          </div>
        </div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: fontData ? [
        {
          name: 'Inter',
          data: fontData,
          weight: 400,
          style: 'normal' as const,
        },
        {
          name: 'Inter',
          data: fontData,
          weight: 600,
          style: 'normal' as const,
        },
        {
          name: 'Inter',
          data: fontData,
          weight: 700,
          style: 'normal' as const,
        },
      ] : undefined,
    }
  );
}

/**
 * Handle OG image generation requests
 * Route: /og/:sessionId.png
 */
export async function handleOGImageRequest(
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
    let fontData: ArrayBuffer | undefined;
    try {
      fontData = await loadFont(env);
    } catch (fontError) {
      console.warn('Failed to load font, using fallback:', fontError);
      // Continue without custom font - workers-og will use system fonts
    }

    // Generate image
    const response = await generateOGImage({
      sessionName: sessionData.name,
      tracks: sessionData.state?.tracks?.map(t => ({ steps: t.steps })) ?? [],
      tempo: sessionData.state?.tempo ?? 120,
      trackCount: sessionData.state?.tracks?.length ?? 0,
    }, fontData);

    // Create response with caching headers
    const cacheTtl = sessionData.immutable ? 604800 : 3600; // 7 days vs 1 hour

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${cacheTtl}`);

    const cachedResp = new Response(response.body, {
      status: response.status,
      headers,
    });

    // Store in cache asynchronously (don't block response)
    ctx.waitUntil(cache.put(cacheKey, cachedResp.clone()));

    return cachedResp;
  } catch (error) {
    // Log error for debugging
    console.error('OG image generation failed:', error);

    // Return fallback static image on any error
    return env.ASSETS.fetch(new Request(`${url.origin}/og-image.png`));
  }
}
