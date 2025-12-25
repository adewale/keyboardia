/**
 * Worker SPA Routing Tests
 *
 * Tests that the worker correctly routes SPA paths to index.html
 * for client-side routing.
 */

import { describe, it, expect } from 'vitest';

/**
 * Helper to determine if a path should serve the SPA (index.html)
 * This mirrors the logic in src/worker/index.ts
 */
function shouldServeSPA(path: string): boolean {
  // API routes are handled separately
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/ws/')) return false;
  if (path.startsWith('/live-debug/')) return false;

  // SPA routing: /s/* routes serve index.html
  if (path.startsWith('/s/')) return true;

  return false;
}

describe('SPA Routing', () => {
  describe('session routes should serve SPA', () => {
    it('should serve SPA for /s/new', () => {
      expect(shouldServeSPA('/s/new')).toBe(true);
    });

    it('should serve SPA for /s/{uuid}', () => {
      expect(shouldServeSPA('/s/550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should serve SPA for /s/any-string', () => {
      expect(shouldServeSPA('/s/any-string')).toBe(true);
    });

    it('should serve SPA for /s/123', () => {
      expect(shouldServeSPA('/s/123')).toBe(true);
    });

    it('should serve SPA for /s/with-dashes-and-numbers-123', () => {
      expect(shouldServeSPA('/s/with-dashes-and-numbers-123')).toBe(true);
    });
  });

  describe('API routes should NOT serve SPA', () => {
    it('should not serve SPA for /api/sessions', () => {
      expect(shouldServeSPA('/api/sessions')).toBe(false);
    });

    it('should not serve SPA for /api/sessions/{id}', () => {
      expect(shouldServeSPA('/api/sessions/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should not serve SPA for /ws/sessions/{id}', () => {
      expect(shouldServeSPA('/ws/sessions/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should not serve SPA for /live-debug/{id}', () => {
      expect(shouldServeSPA('/live-debug/550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });
  });

  describe('static assets should NOT serve SPA', () => {
    it('should not serve SPA for root /', () => {
      expect(shouldServeSPA('/')).toBe(false);
    });

    it('should not serve SPA for /assets/index.js', () => {
      expect(shouldServeSPA('/assets/index.js')).toBe(false);
    });

    it('should not serve SPA for /keyboardia.svg', () => {
      expect(shouldServeSPA('/keyboardia.svg')).toBe(false);
    });
  });
});

describe('Regression: /s/new must work', () => {
  /**
   * This test documents the bug that was fixed.
   *
   * Previously, the worker used this regex for SPA routing:
   *   path.match(/^\/s\/[a-f0-9-]{36}$/)
   *
   * This only matched 36-character UUIDs, so /s/new returned 404.
   *
   * The fix changed it to:
   *   path.startsWith('/s/')
   */
  it('should not require exactly 36 characters after /s/', () => {
    // The old regex: /^\/s\/[a-f0-9-]{36}$/
    const oldRegex = /^\/s\/[a-f0-9-]{36}$/;

    // These would fail with the old regex
    expect(oldRegex.test('/s/new')).toBe(false);
    expect(oldRegex.test('/s/test')).toBe(false);
    expect(oldRegex.test('/s/123')).toBe(false);

    // But they should all serve the SPA
    expect(shouldServeSPA('/s/new')).toBe(true);
    expect(shouldServeSPA('/s/test')).toBe(true);
    expect(shouldServeSPA('/s/123')).toBe(true);
  });

  it('should still work for valid UUIDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(shouldServeSPA(`/s/${uuid}`)).toBe(true);
  });
});
