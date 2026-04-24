/**
 * Regression test for bug #6: shared tone/advanced synth output was being
 * disconnected-and-reconnected on every note, hijacking still-sustaining
 * notes from other tracks into the new track's routing.
 *
 * The fix: connect shared synth outputs once (to the effects chain) and
 * stop dynamically rerouting per-note. Per-track metering for these
 * shared engines is sacrificed for correctness; per-track volume still
 * works because it composes into the note velocity at the scheduler.
 *
 * This test asserts the AudioEngine no longer exposes the reroute method
 * and does not maintain the per-output routing map that the bug relied on.
 */
import { describe, it, expect } from 'vitest';
import { AudioEngine } from './engine';

describe('shared synth routing (bug #6)', () => {
  it('does not expose a rerouteToneOutput method', () => {
    const engine = new AudioEngine();
    expect(
      (engine as unknown as { rerouteToneOutput?: unknown }).rerouteToneOutput,
    ).toBeUndefined();
  });

  it('does not maintain a per-output routing map', () => {
    const engine = new AudioEngine();
    expect(
      (engine as unknown as { toneOutputRouting?: unknown }).toneOutputRouting,
    ).toBeUndefined();
  });
});
