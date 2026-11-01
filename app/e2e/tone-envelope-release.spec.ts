import { test, expect, useMockAPI } from './global-setup';

interface RenderMetrics {
  heldRms: number;
  earlyTailRms: number;
  afterReleaseRms: number;
}

test.describe('Tone envelope audible release contract', () => {
  test.skip(!useMockAPI, 'The focused Vite lane owns the source-module Web Audio harness.');

  test('renders the shared 300ms release and authored zero in real Chromium Web Audio', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium owns the real Web Audio envelope lane.');
    await page.goto('/');

    const metrics = await page.evaluate(async () => {
      const harnessPath = '/e2e/tone-offline-harness.ts';
      const { renderToneEnvelopeRelease } = await import(
        /* @vite-ignore */ harnessPath
      ) as {
        renderToneEnvelopeRelease: (releaseSeconds: number) => Promise<RenderMetrics>;
      };

      return {
        threeHundredMs: await renderToneEnvelopeRelease(0.3),
        zero: await renderToneEnvelopeRelease(0),
      };
    });

    const threeHundredMs = metrics.threeHundredMs as RenderMetrics;
    expect(threeHundredMs.heldRms).toBeGreaterThan(0.01);
    expect(threeHundredMs.earlyTailRms).toBeGreaterThan(0.001);
    expect(threeHundredMs.afterReleaseRms).toBeLessThan(threeHundredMs.earlyTailRms / 100);

    const zero = metrics.zero as RenderMetrics;
    expect(zero.heldRms).toBeGreaterThan(0.01);
    expect(zero.afterReleaseRms).toBeLessThan(zero.heldRms / 100);
  });
});
