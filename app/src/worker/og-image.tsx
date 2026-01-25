/**
 * OG Image Generation Module
 *
 * Generates dynamic Open Graph images for social media sharing using Satori.
 * Images are 600x315 (1.91:1 ratio) for optimal platform compatibility.
 */

import React from 'react';
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

  // Build fonts array once
  const fonts = fontData ? [
    { name: 'Inter', data: fontData, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: fontData, weight: 600 as const, style: 'normal' as const },
    { name: 'Inter', data: fontData, weight: 700 as const, style: 'normal' as const },
  ] : undefined;

  // Helper to create ImageResponse - may need retry if WASM race condition occurs
  const createImageResponse = () => new ImageResponse(
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
                display: 'flex',
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
                display: 'flex',
                fontSize: '12px',
                color: COLORS.textMuted,
              }}
            >
              {`${trackCount} tracks · ${tempo} BPM`}
            </div>
          </div>

          {/* Keyboardia branding */}
          <div
            style={{
              display: 'flex',
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
      fonts,
    }
  );

  // Try to create the image, with retry for WASM initialization race condition
  // The "Already initialized" error occurs when concurrent requests both try to init WASM
  // On retry, WASM is already initialized so it succeeds
  try {
    return createImageResponse();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Already initialized')) {
      // WASM was initialized by another concurrent request - retry should work
      console.log('[OG] WASM already initialized, retrying...');
      return createImageResponse();
    }
    throw error;
  }
}

/**
 * Purge the cached OG image for a session.
 * Call this when a session is published to ensure fresh image generation.
 *
 * @param sessionId - The session ID to purge
 * @param baseUrl - The base URL (e.g., https://keyboardia.dev)
 * @returns true if cache was deleted, false if not found
 */
export async function purgeOGCache(sessionId: string, baseUrl: string): Promise<boolean> {
  try {
    const cache = caches.default;
    const cacheKey = new Request(`${baseUrl}/og/${sessionId}.png`);
    const deleted = await cache.delete(cacheKey);
    if (deleted) {
      console.log(`[OG] Cache purged for session ${sessionId}`);
    }
    return deleted;
  } catch (error) {
    console.error(`[OG] Failed to purge cache for ${sessionId}:`, error);
    return false;
  }
}

/**
 * Handle OG image generation requests
 * Route: /og/:sessionId.png
 * Phase 34: Routes through DO for latest state (includes pending changes)
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

  // Phase 34: Get session from DO (source of truth) instead of direct KV read
  // This ensures OG images show the latest state including pending changes
  let sessionData: Session | null = null;
  try {
    const doId = env.LIVE_SESSIONS.idFromName(sessionId);
    const stub = env.LIVE_SESSIONS.get(doId);
    const doResponse = await stub.fetch(new Request(
      new URL(`/api/sessions/${sessionId}`, request.url).toString(),
      { method: 'GET' }
    ));
    if (doResponse.ok) {
      sessionData = await doResponse.json() as Session;
    }
  } catch (error) {
    // Fall back to KV if DO fails (session might not exist or DO error)
    console.log(`[OG] DO fetch failed for ${sessionId}, falling back to KV:`, error);
    sessionData = await env.SESSIONS.get(`session:${sessionId}`, 'json') as Session | null;
  }

  if (!sessionData) {
    // Return default OG image for missing sessions
    return env.ASSETS.fetch(new Request(`${url.origin}/og-image.png`));
  }

  try {
    // Load font (cached in memory after first load)
    let fontData: ArrayBuffer | undefined;
    try {
      fontData = await loadFont(env);
      console.log('[OG] Font loaded successfully, size:', fontData.byteLength);
    } catch (fontError) {
      console.warn('[OG] Failed to load font, using fallback:', fontError);
      // Continue without custom font - workers-og will use system fonts
    }

    // Prepare image props
    const props = {
      sessionName: sessionData.name,
      tracks: sessionData.state?.tracks?.map(t => ({ steps: t.steps })) ?? [],
      tempo: sessionData.state?.tempo ?? 120,
      trackCount: sessionData.state?.tracks?.length ?? 0,
    };
    console.log('[OG] Generating image for session:', sessionData.name, 'tracks:', props.trackCount);

    // Generate image
    const response = await generateOGImage(props, fontData);
    console.log('[OG] Image generated successfully, status:', response.status);

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
    // Log error for debugging with full details
    console.error('[OG] Image generation failed:', error);
    console.error('[OG] Error name:', (error as Error)?.name);
    console.error('[OG] Error message:', (error as Error)?.message);
    console.error('[OG] Error stack:', (error as Error)?.stack);

    // Return fallback static image on any error
    return env.ASSETS.fetch(new Request(`${url.origin}/og-image.png`));
  }
}
