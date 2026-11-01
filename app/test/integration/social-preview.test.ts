/**
 * Social Media Preview Integration Tests
 *
 * Tests the end-to-end flow of social preview functionality.
 * Uses SELF.fetch() to route requests through the vitest worker pool.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

// Test session created in beforeAll
let TEST_SESSION_ID: string;
const TEST_SESSION_NAME = 'Integration Test Beat';

describe('Social Media Preview Integration', () => {
  // Create a test session before running tests
  beforeAll(async () => {
    const response = await SELF.fetch('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: TEST_SESSION_NAME,
        state: {
          tracks: [
            { id: 'track-1', name: 'Kick', sampleId: 'kick', steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false], volume: 0.8, muted: false, transpose: 0, parameterLocks: [] },
            { id: 'track-2', name: 'Snare', sampleId: 'snare', steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], volume: 0.8, muted: false, transpose: 0, parameterLocks: [] },
          ],
          tempo: 128,
          swing: 0,
          version: 1,
        },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { id: string };
    TEST_SESSION_ID = data.id;
  });

  describe('Meta Tag Injection', () => {
    it('injects OG tags for Facebook crawler', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      expect(response.ok).toBe(true);

      const html = await response.text();

      // Check for dynamic OG tags
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:image"');
      expect(html).toContain(`/og/${TEST_SESSION_ID}.png`);

      // Check session name is in title
      expect(html).toContain(`${TEST_SESSION_NAME} — Keyboardia`);
    });

    it('injects Twitter Card tags for Twitter crawler', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });

      const html = await response.text();

      expect(html).toContain('property="twitter:card"');
      expect(html).toContain('property="twitter:title"');
      expect(html).toContain('property="twitter:image"');
    });

    it('injects JSON-LD structured data', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      expect(html).toContain('application/ld+json');
      expect(html).toContain('"@type":"MusicComposition"');
      expect(html).toContain('"@context":"https://schema.org"');
    });

    it('includes track and tempo info in description', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });

      const html = await response.text();

      // Description should include track count and tempo
      expect(html).toContain('2-track');
      expect(html).toContain('128 BPM');
    });

    it('injects meta for regular browsers too (for validation tools)', async () => {
      // We inject session meta for ALL /s/ requests, not just crawlers,
      // so that validation tools (OpenGraph debugger, etc.) work correctly
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0' },
      });

      const html = await response.text();

      // Regular browsers ALSO get session-specific meta tags
      expect(html).toContain(`/og/${TEST_SESSION_ID}.png`);
      expect(html).toContain(`${TEST_SESSION_NAME} — Keyboardia`);
    });
  });

  describe('Dynamic OG Image', () => {
    it('returns PNG for valid session', async () => {
      const response = await SELF.fetch(`http://localhost/og/${TEST_SESSION_ID}.png`);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
    });

    it('returns non-empty image data', async () => {
      const response = await SELF.fetch(`http://localhost/og/${TEST_SESSION_ID}.png`);
      const buffer = await response.arrayBuffer();

      // PNG files start with these magic bytes
      const view = new Uint8Array(buffer);
      expect(view[0]).toBe(0x89); // PNG signature
      expect(view[1]).toBe(0x50); // P
      expect(view[2]).toBe(0x4E); // N
      expect(view[3]).toBe(0x47); // G

      // Should be reasonably sized (between 1KB and 100KB)
      expect(buffer.byteLength).toBeGreaterThan(1000);
      expect(buffer.byteLength).toBeLessThan(100000);
    });

    it('includes cache headers', async () => {
      const response = await SELF.fetch(`http://localhost/og/${TEST_SESSION_ID}.png`);

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('max-age=');
    });

    it('returns 404 for invalid session ID format', async () => {
      const response = await SELF.fetch('http://localhost/og/invalid-id.png');
      expect(response.status).toBe(404);
    });

    it('returns fallback image for missing session', async () => {
      // Valid UUID format but non-existent session
      const response = await SELF.fetch('http://localhost/og/00000000-0000-0000-0000-000000000000.png');

      // Should return 200 with fallback image
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
    });
  });

  describe('Schema.org Validation', () => {
    it('produces valid JSON-LD', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);

      expect(jsonLdMatch).not.toBeNull();

      const jsonLd = JSON.parse(jsonLdMatch![1]);
      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('MusicComposition');
      expect(jsonLd.name).toBeDefined();
      expect(jsonLd.url).toContain('/s/');
      expect(jsonLd.image).toContain('/og/');
      expect(jsonLd.image).toContain('.png');
      expect(jsonLd.composer).toBeDefined();
      expect(jsonLd.composer['@type']).toBe('Organization');
      expect(jsonLd.composer.name).toBe('Keyboardia');
    });
  });

  describe('Content Matching', () => {
    it('og:title contains exact session name', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      // Extract og:title content
      const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
      expect(ogTitleMatch).not.toBeNull();
      expect(ogTitleMatch![1]).toContain(TEST_SESSION_NAME);
    });

    it('og:description matches session stats exactly', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      // Extract og:description content
      const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/);
      expect(ogDescMatch).not.toBeNull();

      const description = ogDescMatch![1];
      // Session has 2 tracks at 128 BPM
      expect(description).toMatch(/2-track.*128\s*BPM/);
    });

    it('JSON-LD name equals session name', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
      expect(jsonLdMatch).not.toBeNull();

      const jsonLd = JSON.parse(jsonLdMatch![1]);
      expect(jsonLd.name).toBe(TEST_SESSION_NAME);
    });

    it('og:image URL contains session ID', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await response.text();

      // Extract og:image content
      const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
      expect(ogImageMatch).not.toBeNull();
      expect(ogImageMatch![1]).toContain(`/og/${TEST_SESSION_ID}.png`);
    });

    it('twitter:title matches og:title', async () => {
      const response = await SELF.fetch(`http://localhost/s/${TEST_SESSION_ID}`, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });

      const html = await response.text();

      const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
      const twitterTitleMatch = html.match(/<meta\s+property="twitter:title"\s+content="([^"]+)"/);

      expect(ogTitleMatch).not.toBeNull();
      expect(twitterTitleMatch).not.toBeNull();
      expect(twitterTitleMatch![1]).toBe(ogTitleMatch![1]);
    });
  });

  describe('XSS Prevention', () => {
    it('escapes malicious session names', async () => {
      // Create session with XSS attempt in name
      const response = await SELF.fetch('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '<script>alert("XSS")</script>',
          state: {
            tracks: [],
            tempo: 120,
            swing: 0,
            version: 1,
          },
        }),
      });

      if (!response.ok) {
        // Session creation might fail due to validation
        return;
      }

      const data = await response.json() as { id: string };
      const xssSessionId = data.id;

      // Now request as crawler
      const crawlerResponse = await SELF.fetch(`http://localhost/s/${xssSessionId}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      });

      const html = await crawlerResponse.text();

      // Should NOT contain raw script tag
      expect(html).not.toContain('<script>alert("XSS")</script>');

      // Should contain escaped version
      expect(html).toContain('&lt;script&gt;');
    });
  });
});
