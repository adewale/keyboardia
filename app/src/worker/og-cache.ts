/**
 * Edge cache invalidation for generated social preview images.
 *
 * Split out of og-image.tsx deliberately: purging is a two-line cache delete,
 * while the renderer drags in React, Satori, and a Yoga WASM binary. Callers
 * that only need to invalidate — the publish paths — should not pay for or
 * depend on the renderer.
 */

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
