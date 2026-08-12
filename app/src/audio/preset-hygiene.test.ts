import { describe, expect, it } from 'vitest';
import { SYNTH_PRESETS } from './synth';
import { TONE_SYNTH_PRESETS } from './toneSynths';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';

interface EnvelopeSummary {
  id: string;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

function allAmplitudeEnvelopes(): EnvelopeSummary[] {
  const native = Object.entries(SYNTH_PRESETS).map(([id, preset]) => ({
    id: `native:${id}`,
    attack: preset.attack,
    decay: preset.decay,
    sustain: preset.sustain,
    release: preset.release,
  }));
  const tone = Object.entries(TONE_SYNTH_PRESETS).flatMap(([id, preset]) => {
    const envelope = preset.config.envelope as Partial<Omit<EnvelopeSummary, 'id'>> | undefined;
    return envelope?.attack === undefined || envelope.decay === undefined
      || envelope.sustain === undefined || envelope.release === undefined
      ? []
      : [{ id: `tone:${id}`, ...envelope } as EnvelopeSummary];
  });
  const advanced = Object.entries(ADVANCED_SYNTH_PRESETS).map(([id, preset]) => ({
    id: `advanced:${id}`,
    ...preset.amplitudeEnvelope,
  }));
  return [...native, ...tone, ...advanced];
}

describe('Phase 43.6 preset hygiene', () => {
  it('audits the complete 32 native + 11 Tone + 8 advanced preset catalogue', () => {
    expect(Object.keys(SYNTH_PRESETS)).toHaveLength(32);
    expect(Object.keys(TONE_SYNTH_PRESETS)).toHaveLength(11);
    expect(Object.keys(ADVANCED_SYNTH_PRESETS)).toHaveLength(8);
  });

  it('keeps every declared amplitude envelope finite and bounded', () => {
    for (const envelope of allAmplitudeEnvelopes()) {
      expect(Number.isFinite(envelope.attack), envelope.id).toBe(true);
      expect(Number.isFinite(envelope.decay), envelope.id).toBe(true);
      expect(Number.isFinite(envelope.sustain), envelope.id).toBe(true);
      expect(Number.isFinite(envelope.release), envelope.id).toBe(true);
      expect(envelope.attack, envelope.id).toBeGreaterThanOrEqual(0);
      expect(envelope.decay, envelope.id).toBeGreaterThanOrEqual(0);
      expect(envelope.sustain, envelope.id).toBeGreaterThanOrEqual(0);
      expect(envelope.sustain, envelope.id).toBeLessThanOrEqual(1);
      expect(envelope.release, envelope.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not waste a long decay on near-sustain envelopes', () => {
    for (const envelope of allAmplitudeEnvelopes()) {
      if (envelope.sustain < 0.75) continue;
      expect(envelope.decay, `${envelope.id} decay is inaudible at high sustain`)
        .toBeLessThanOrEqual(0.15);
    }
  });
});
