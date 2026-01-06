/**
 * Social Preview Unit Tests
 *
 * Tests for crawler detection and HTML escaping.
 */

import { describe, it, expect } from 'vitest';
import { isSocialCrawler, escapeHtml } from './social-preview';

/**
 * Create a mock request with the given User-Agent
 */
function mockRequest(userAgent: string): Request {
  return new Request('https://keyboardia.dev/s/test', {
    headers: { 'User-Agent': userAgent },
  });
}

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

  it('detects Slack crawler', () => {
    expect(isSocialCrawler(mockRequest('Slackbot-LinkExpanding 1.0'))).toBe(true);
  });

  it('detects WhatsApp crawler', () => {
    expect(isSocialCrawler(mockRequest('WhatsApp/2.23.18.78 i'))).toBe(true);
  });

  it('detects Telegram crawler', () => {
    expect(isSocialCrawler(mockRequest('TelegramBot (like TwitterBot)'))).toBe(true);
  });

  it('detects iMessage (combined UA)', () => {
    const iMessageUA = 'Mozilla/5.0 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
    expect(isSocialCrawler(mockRequest(iMessageUA))).toBe(true);
  });

  it('returns false for regular browsers', () => {
    expect(isSocialCrawler(mockRequest('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0'))).toBe(false);
  });

  it('returns false for empty User-Agent', () => {
    expect(isSocialCrawler(mockRequest(''))).toBe(false);
  });

  it('returns false for missing User-Agent', () => {
    const request = new Request('https://keyboardia.dev/s/test');
    expect(isSocialCrawler(request)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSocialCrawler(mockRequest('FACEBOOKEXTERNALHIT/1.1'))).toBe(true);
    expect(isSocialCrawler(mockRequest('twitterbot/1.0'))).toBe(true);
    expect(isSocialCrawler(mockRequest('DISCORDBOT'))).toBe(true);
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

  it('returns normal text unchanged', () => {
    expect(escapeHtml('My Cool Beat')).toBe('My Cool Beat');
  });

  it('escapes all ampersands before other characters', () => {
    // Important: & must be escaped first to avoid double-escaping
    expect(escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });

  it('handles unicode correctly', () => {
    expect(escapeHtml('Beats 🎵 & Loops 🔁')).toBe('Beats 🎵 &amp; Loops 🔁');
  });

  it('handles XSS attack vectors', () => {
    expect(escapeHtml('"><script>alert("XSS")</script><"')).toBe(
      '&quot;&gt;&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&lt;&quot;'
    );
  });

  it('handles event handler injection', () => {
    expect(escapeHtml('" onload="alert(1)"')).toBe('&quot; onload=&quot;alert(1)&quot;');
  });
});
