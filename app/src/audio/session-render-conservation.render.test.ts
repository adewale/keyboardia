/**
 * Onset conservation on deterministic offline renders.
 *
 * Renders seeded kick patterns through the real OfflineAudioContext path
 * (src/test/session-render.ts) and verifies with an energy-envelope onset
 * detector that the audio contains EXACTLY the scheduled hits — none lost,
 * none doubled — each within 25 ms of its scheduled step time.
 *
 * This is the audible half of the conservation oracle family: the MIDI
 * round-trip test proves the exported file matches the grid; this proves
 * the rendered audio does.
 */
import { describe, expect, it } from 'vitest';
import { renderProceduralPattern, type ProceduralHit } from '../test/session-render';
import { getStepDuration } from './timing-calculations';
import { mulberry32 } from '../test/seeded-random';

/** RMS-envelope onset detector: rising edges above threshold with a refractory gap. */
function detectOnsets(
  channel: Float32Array,
  sampleRate: number,
  minGapSec: number,
): number[] {
  const windowSize = Math.round(sampleRate * 0.005); // 5 ms windows
  const rms: number[] = [];
  for (let i = 0; i + windowSize <= channel.length; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) sum += channel[j] * channel[j];
    rms.push(Math.sqrt(sum / windowSize));
  }
  const peak = Math.max(...rms);
  expect(peak, 'render produced signal').toBeGreaterThan(0);
  const threshold = peak * 0.25;

  // The synthesized kick fixture carries a second energy bump ~155 ms after
  // its attack, so the refractory gap must exceed the sample's internal
  // envelope, not just the analysis window. Callers pass a gap derived from
  // the guaranteed scheduled-hit spacing. w=0 compares against silence so a
  // hit at t=0 still registers as a rising edge.
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let w = 0; w < rms.length; w++) {
    const t = (w * windowSize) / sampleRate;
    const prev = w === 0 ? 0 : rms[w - 1];
    const rising = rms[w] >= threshold && prev < threshold;
    if (rising && t - lastOnset >= minGapSec) {
      onsets.push(t);
      lastOnset = t;
    }
  }
  return onsets;
}

/** Seeded pattern of kick hits on steps spaced ≥ 2 apart (clean decay separation). */
function seededPattern(seed: number, maxStep: number): number[] {
  const rng = mulberry32(seed);
  const steps: number[] = [];
  let step = Math.floor(rng() * 2);
  while (step <= maxStep) {
    steps.push(step);
    step += 2 + Math.floor(rng() * 3); // gap of 2-4 steps
  }
  return steps;
}

describe('rendered audio conserves scheduled onsets', () => {
  const SEEDS = [101, 202, 303, 404];

  it.each(SEEDS)('seed %i: every scheduled kick is audible exactly once, on time', async (seed) => {
    const tempo = 120;
    const stepDuration = getStepDuration(tempo);
    const steps = seededPattern(seed, 15);
    expect(steps.length).toBeGreaterThanOrEqual(4); // pattern is non-trivial

    const hits: ProceduralHit[] = steps.map((step) => ({ step, sampleId: 'kick' }));
    const rendered = await renderProceduralPattern({ hits, tempo, seed });

    // The kick's exp(-8t) envelope re-crosses the 25% RMS threshold until
    // ~0.18 s, so the refractory must clear that decay tail AND stay under
    // the guaranteed 2-step hit spacing. Assert both bounds explicitly so a
    // tempo or fixture change fails loudly here rather than silently
    // mis-detecting onsets (at 180 BPM, 1.6 steps would dip below the tail).
    const KICK_DECAY_TAIL_SEC = 0.18;
    const refractory = stepDuration * 1.6;
    expect(refractory, 'refractory clears the kick decay tail').toBeGreaterThan(KICK_DECAY_TAIL_SEC);
    expect(refractory, 'refractory under the 2-step hit spacing').toBeLessThan(2 * stepDuration);
    const onsets = detectOnsets(rendered.channels[0], rendered.sampleRate, refractory);

    expect(onsets.length, `seed=${seed} onset count for steps [${steps.join(',')}]`).toBe(steps.length);
    for (const [i, step] of steps.entries()) {
      // Literal 1/8 s per 16th step at 120 BPM — deliberately NOT
      // getStepDuration, which the renderer itself uses to place hits;
      // sharing the subject's arithmetic would shift both sides of the
      // comparison equally and hide a step-duration regression. Tolerance is
      // 2x the detector's 5 ms window quantization.
      const scheduled = step * 0.125;
      expect(
        Math.abs(onsets[i] - scheduled),
        `seed=${seed} hit ${i} (step ${step}) timing`,
      ).toBeLessThan(0.010);
    }
  });
});
