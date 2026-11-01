/**
 * Social Preview Unit Tests
 *
 * Tests for social-preview HTML escaping and metadata injection.
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from './social-preview';

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
