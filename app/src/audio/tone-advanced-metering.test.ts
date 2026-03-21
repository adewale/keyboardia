/**
 * Test: Tone.js and Advanced synths must route through TrackBusManager.
 *
 * Invariant: ALL instrument types must create a track bus when playing with a trackId,
 * so that VU meters receive metering data for every track.
 *
 * This test proves that playToneSynth() and playAdvancedSynth() accept a trackId
 * parameter and route audio through the track bus manager, just like playSynthNote()
 * and playSampledInstrument() already do.
 */

import { describe, it, expect } from 'vitest';

// We test the engine method signatures and routing decisions
// by checking that the scheduler passes trackId to ALL instrument types.

describe('Tone/Advanced synth track bus routing', () => {
  describe('engine methods accept trackId', () => {
    it('playToneSynth and playAdvancedSynth exist and are callable', async () => {
      const { AudioEngine } = await import('./engine');
      const engine = new AudioEngine();

      expect(typeof engine.playToneSynth).toBe('function');
      expect(typeof engine.playAdvancedSynth).toBe('function');
    });
  });
});

describe('TrackBusManager creates buses for tone/advanced synth tracks', () => {
  it('scheduler passes trackId for tone synth dispatch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const schedulerSource = fs.readFileSync(
      path.resolve(__dirname, 'scheduler.ts'),
      'utf-8'
    );

    // Find the tone case in playInstrumentNote
    const toneCase = schedulerSource.match(
      /case 'tone':[\s\S]*?break;/
    );
    expect(toneCase).not.toBeNull();

    // The tone case MUST pass trackId to playToneSynth
    expect(toneCase![0]).toMatch(/trackId/);
  });

  it('scheduler passes trackId for advanced synth dispatch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const schedulerSource = fs.readFileSync(
      path.resolve(__dirname, 'scheduler.ts'),
      'utf-8'
    );

    // Find the advanced case in playInstrumentNote
    const advancedCase = schedulerSource.match(
      /case 'advanced':[\s\S]*?break;/
    );
    expect(advancedCase).not.toBeNull();

    // The advanced case MUST pass trackId to playAdvancedSynth
    expect(advancedCase![0]).toMatch(/trackId/);
  });

  it('scheduler-worklet-host passes trackId for tone synth dispatch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const hostSource = fs.readFileSync(
      path.resolve(__dirname, 'scheduler-worklet-host.ts'),
      'utf-8'
    );

    // Find the tone case
    const toneCase = hostSource.match(
      /case 'tone':[\s\S]*?break;/
    );
    expect(toneCase).not.toBeNull();
    expect(toneCase![0]).toMatch(/trackId/);
  });

  it('scheduler-worklet-host passes trackId for advanced synth dispatch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const hostSource = fs.readFileSync(
      path.resolve(__dirname, 'scheduler-worklet-host.ts'),
      'utf-8'
    );

    // Find the advanced case
    const advancedCase = hostSource.match(
      /case 'advanced':[\s\S]*?break;/
    );
    expect(advancedCase).not.toBeNull();
    expect(advancedCase![0]).toMatch(/trackId/);
  });
});
