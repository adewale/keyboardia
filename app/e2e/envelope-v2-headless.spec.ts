import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();
const envelope = {
  model: 'adsr' as const,
  attack: { value: 0.01, unit: 'seconds' as const },
  decay: { value: 2, unit: 'steps' as const },
  sustain: 0.7,
  release: { value: 0.3, unit: 'seconds' as const },
};

test.describe('Envelope v2 headless correctness profile', () => {
  test.skip(
    process.env.VITE_FEATURE_ENVELOPE_V2 !== 'false',
    'This contract owns the explicit editor-disabled release profile.',
  );
  test.skip(!useMockAPI, 'The headless contract owns a deterministic mock session.');

  test('preserves notation and runtime audio state while editor exposure is disabled', async ({
    page,
    request,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { id } = await createSessionWithRetry(request, {
      tracks: [{
        id: 'headless-pad',
        name: 'Headless Pad',
        sampleId: 'advanced:warm-pad',
        steps: Array.from({ length: 128 }, (_, index) => index === 0),
        parameterLocks: [
          { releaseDuration: { value: 0.3, unit: 'seconds' } },
          ...Array(127).fill(null),
        ],
        volume: 0.8,
        muted: false,
        soloed: false,
        transpose: 0,
        stepCount: 16,
        envelopeV2: envelope,
        gate: 75,
      }],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await page.goto(`${API_BASE}/s/${id}`);
    await expect(page.locator('.track-row')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Amplitude envelope' })).toHaveCount(0);

    await expect.poll(async () => page.evaluate(async () => {
      const modulePath = '/src/audio/engine.ts';
      const module = await import(/* @vite-ignore */ modulePath) as {
        audioEngine: { trackEnvelopeV2Overrides?: Map<string, unknown> };
      };
      return module.audioEngine.trackEnvelopeV2Overrides?.get('headless-pad') ?? null;
    })).toEqual(envelope);

    const copyNotation = page.getByRole('button', { name: 'Copy Notation' });
    await expect(copyNotation).toBeEnabled();
    await copyNotation.click();
    await expect(page.getByRole('button', { name: 'Notation Copied!' })).toBeVisible();
    const notation = await page.evaluate(() => navigator.clipboard.readText());
    expect(notation).toContain('[amp:adsr,10ms,2st,0.7,300ms]');
    expect(notation).toContain('[gate:75%]');
    expect(notation).toContain('[lock:1,release,300ms]');
  });
});
