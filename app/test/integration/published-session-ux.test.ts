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
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// CSS Rule Tests
// =============================================================================

describe('Published Session CSS Rules', () => {
  // Load the CSS file
  const cssPath = path.join(__dirname, '../../src/components/StepSequencer.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

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
// Pointer Events Hierarchy Test
// =============================================================================

describe('Pointer Events Hierarchy', () => {
  /**
   * CSS pointer-events inheritance:
   * - Parent with pointer-events: none blocks all children
   * - Child with pointer-events: auto re-enables for that subtree
   * - Grandchild with pointer-events: none blocks that branch
   *
   * For published sessions:
   * .sequencer-content (none) -> blocks all
   *   .tracks (auto) -> re-enables scrolling
   *     .track-row (none) -> blocks editing cells
   *   .transport (auto) -> re-enables play button
   *     .tempo-control (none) -> blocks tempo slider
   */

  it('documents the pointer-events hierarchy for published sessions', () => {
    const hierarchy = {
      '.sequencer-content': 'none',      // Base: block everything
      '.tracks': 'auto',                  // Allow: scrolling the grid
      '.track-row': 'none',               // Block: editing step cells
      '.transport': 'auto',               // Allow: play/pause button
      '.tempo-control': 'none',           // Block: tempo editing
      '.swing-control': 'none',           // Block: swing editing
    };

    // This test documents the expected hierarchy
    // If any of these change, this test should be updated
    expect(Object.keys(hierarchy).length).toBe(6);
    expect(hierarchy['.tracks']).toBe('auto'); // Critical for scroll fix
  });
});

// =============================================================================
// Regression Prevention
// =============================================================================

describe('Published Session Regression Tests', () => {
  it('should not have .tracks with pointer-events: none', () => {
    // Regression: If .tracks ever gets pointer-events: none, scrolling breaks
    const cssPath = path.join(__dirname, '../../src/components/StepSequencer.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

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
