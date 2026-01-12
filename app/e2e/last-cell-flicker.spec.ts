/**
 * Last Cell Flickering Test
 *
 * Tests that the last step cell doesn't flicker during playback.
 * Uses Playwright best practices with proper waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

// NOTE: "last cell should only be highlighted when playhead is on it" test was removed.
// The core playhead logic is comprehensively tested by unit tests in:
// - src/utils/playhead.property.test.ts:
//   - PH-001 through PH-006: Playhead index boundary and wrapping tests
//   - isStepPlaying: "exactly one step is playing per position"
//   - getPlayheadPercent: Percentage calculation tests
//
// These unit tests verify the exact logic that caused the flickering bug,
// ensuring playhead index always wraps correctly at boundaries.
