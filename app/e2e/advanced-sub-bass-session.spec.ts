import { test, expect, type Page } from '@playwright/test';
import { createSessionWithRetry, API_BASE } from './test-utils';
import { waitForAppReady } from './global-setup';

const TOTAL_STEPS = 16;
const SILENCE_PEAK = 1e-3;

function buildSubBassTrack() {
  return {
    id: 'sub-bass-regression',
    name: 'Sub Bass',
    sampleId: 'advanced:sub-bass',
    // A simple repeating in-range sub-bass note. Before the filter-envelope
    // summing fix, the preset's envelopeAmount=0 drove filter.frequency to 0Hz
    // and this track rendered complete silence despite playSuccesses > 0.
    steps: Array(TOTAL_STEPS).fill(true),
    parameterLocks: Array(TOTAL_STEPS).fill({ pitch: -5 }),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: TOTAL_STEPS,
  };
}

async function attachMasterAnalyser(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const engine = (window as unknown as {
      __audioEngine__?: { getAudioContext?: () => AudioContext | null; masterGain?: AudioNode | null };
    }).__audioEngine__;
    return Boolean(engine?.getAudioContext?.() && engine.masterGain);
  }, { timeout: 20_000 });

  await page.evaluate(() => {
    const engine = (window as unknown as {
      __audioEngine__?: { getAudioContext?: () => AudioContext | null; masterGain?: AudioNode | null };
      __subBassProbeAnalyser__?: AnalyserNode;
    }).__audioEngine__;
    const audioContext = engine?.getAudioContext?.();
    const masterGain = engine?.masterGain;
    if (!audioContext || !masterGain) throw new Error('Audio engine/masterGain unavailable');
    const analyser = audioContext.createAnalyser();
    masterGain.connect(analyser);
    (window as unknown as { __subBassProbeAnalyser__?: AnalyserNode }).__subBassProbeAnalyser__ = analyser;
  });
}

async function sampleMasterPeak(page: Page): Promise<number> {
  let peak = 0;
  for (let i = 0; i < 50; i++) {
    peak = Math.max(peak, await page.evaluate(() => {
      const analyser = (window as unknown as { __subBassProbeAnalyser__?: AnalyserNode })
        .__subBassProbeAnalyser__;
      if (!analyser) throw new Error('Sub-bass probe analyser was not attached');
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let p = 0;
      for (const v of data) p = Math.max(p, Math.abs(v));
      return p;
    }));
    await page.waitForTimeout(100);
  }
  return peak;
}

test('advanced sub-bass preset produces live master output', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id: sessionId } = await createSessionWithRetry(request, {
    tracks: [buildSubBassTrack()],
    tempo: 120,
    swing: 0,
    version: 1,
  });

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(`${API_BASE}/s/${sessionId}`);
  await waitForAppReady(page);
  await expect(page.locator('.track-row')).toHaveCount(1, { timeout: 20_000 });

  await page
    .locator('[data-testid="play-button"]')
    .or(page.getByRole('button', { name: /play/i }))
    .first()
    .click();

  await attachMasterAnalyser(page);
  const masterPeak = await sampleMasterPeak(page);

  expect(pageErrors).toEqual([]);
  expect(masterPeak).toBeGreaterThan(SILENCE_PEAK);
});
