/**
 * Published Session UX Integration Tests
 *
 * These tests verify that published (immutable) sessions maintain proper UX:
 * - Scrolling should work (users need to see full grid)
 * - Editing should be blocked (read-only mode)
 * - Play/pause should work
 *
 * Bug fix: pointer-events:none on .sequencer-content was blocking scroll.
 * Fix: Re-enable pointer-events on .tracks while blocking on .track-row
 */

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

// =============================================================================
// CSS Rule Tests
// =============================================================================

describe('Published Session CSS Rules', () => {
  // CSS content is provided as a text binding from vitest.config.ts
  // (Workers sandbox can't access the host filesystem directly)
  const cssContent = env.STEP_SEQUENCER_CSS;

  describe('Scroll behavior', () => {
    it('should block pointer events on sequencer-content for published sessions', () => {
      // This is the base rule that blocks editing
      expect(cssContent).toContain('.step-sequencer.published .sequencer-content');
      expect(cssContent).toMatch(/\.step-sequencer\.published\s+\.sequencer-content\s*\{[^}]*pointer-events:\s*none/);
    });

    it('should re-enable pointer events on .tracks for scrolling', () => {
      // Critical fix: .tracks must have pointer-events: auto to allow scrolling
      expect(cssContent).toMatch(/\.step-sequencer\.published\s+\.tracks\s*\{[^}]*pointer-events:\s*auto/);
    });

    it('should block pointer events on track-row to prevent editing', () => {
      // Track rows (containing step cells) should not be interactive
      expect(cssContent).toMatch(/\.step-sequencer\.published\s+\.track-row\s*\{[^}]*pointer-events:\s*none/);
    });
  });

  describe('Transport controls', () => {
    it('should allow pointer events on transport for play/pause', () => {
      // Play/pause must work on published sessions
      expect(cssContent).toMatch(/\.step-sequencer\.published\s+\.transport\s*\{[^}]*pointer-events:\s*auto/);
    });

    it('should block pointer events on tempo/swing controls', () => {
      // Tempo and swing should not be editable
      expect(cssContent).toContain('.step-sequencer.published .transport .tempo-control');
      expect(cssContent).toContain('.step-sequencer.published .transport .swing-control');
      expect(cssContent).toMatch(/pointer-events:\s*none/);
    });
  });
});

// =============================================================================
// Regression Prevention
// =============================================================================

describe('Published Session Regression Tests', () => {
  it('should not have .tracks with pointer-events: none', () => {
    // Regression: If .tracks ever gets pointer-events: none, scrolling breaks
    const cssContent = env.STEP_SEQUENCER_CSS;

    // Extract the .step-sequencer.published .tracks rule
    const tracksRuleMatch = cssContent.match(
      /\.step-sequencer\.published\s+\.tracks\s*\{([^}]*)\}/
    );

    expect(tracksRuleMatch).toBeTruthy();
    const tracksRule = tracksRuleMatch![1];

    // Ensure it has pointer-events: auto (not none)
    expect(tracksRule).toContain('pointer-events: auto');
    expect(tracksRule).not.toMatch(/pointer-events:\s*none/);
  });
});
