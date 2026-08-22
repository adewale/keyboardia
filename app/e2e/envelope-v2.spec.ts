import { test, expect, getBaseUrl, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

function track(
  id: string,
  name: string,
  sampleId: string,
  envelopeV2: Record<string, unknown>,
  samplePlaybackMode?: 'trigger' | 'gate' | 'loop',
) {
  return {
    id,
    name,
    sampleId,
    steps: Array.from({ length: 128 }, (_, index) => index % 4 === 0),
    parameterLocks: Array(128).fill(null),
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    envelopeV2,
    ...(samplePlaybackMode ? { samplePlaybackMode } : {}),
    gate: 75,
  };
}

async function createEnvelopeSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  return createSessionWithRetry(request, {
    tracks: [
      track('finite-piano', 'Finite piano', 'sampled:piano', {
        model: 'ahd',
        attack: { value: 0.02, unit: 'seconds' },
        hold: { value: 1, unit: 'steps' },
        decay: { value: 0.4, unit: 'seconds' },
      }, 'trigger'),
      track('loop-organ', 'Loop organ', 'sampled:hammond-organ', {
        model: 'adsr',
        attack: { value: 0.01, unit: 'seconds' },
        decay: { value: 2, unit: 'steps' },
        sustain: 0.72,
        release: { value: 4, unit: 'steps' },
      }, 'loop'),
      track('oscillator-pad', 'Oscillator pad', 'advanced:warm-pad', {
        model: 'adsr',
        attack: { value: 4, unit: 'steps' },
        decay: { value: 2, unit: 'steps' },
        sustain: 0.68,
        release: { value: 8, unit: 'steps' },
      }),
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

test.describe('Envelope v2 browser contract', () => {
  test.skip(!useMockAPI, 'The focused envelope contract owns a deterministic mock session.');

  test.beforeEach(async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'The focused command targets desktop Chromium.');
    const { id } = await createEnvelopeSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await expect(page.locator('.track-row')).toHaveCount(3, { timeout: 15_000 });
  });

  async function openEnvelopeEditor(row: import('@playwright/test').Locator): Promise<void> {
    await row.getByRole('button', { name: 'Pattern tools' }).click();
    await row.getByRole('button', { name: 'Amplitude envelope' }).click();
  }

  test('edits a finite-sample AHD envelope with one committed exact value', async ({ page }) => {
    const row = page.locator('.track-row-wrapper').nth(0);
    await openEnvelopeEditor(row);

    const editor = row.getByRole('region', { name: 'Amplitude envelope' });
    const summary = editor.getByRole('button', { name: /AHD/ });
    await expect(summary).toContainText('trigger sample');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');

    await expect(editor.getByRole('combobox', { name: 'Envelope model' })).toHaveValue('ahd');
    await expect(editor.getByRole('spinbutton', { name: 'Hold exact value' })).toBeVisible();
    await expect(editor.getByRole('spinbutton', { name: 'Release exact value' })).toHaveCount(0);
    await expect(editor.getByRole('radio', { name: 'Trigger' })).toBeChecked();
    await expect(editor.getByRole('slider', { name: 'Gate' })).toBeDisabled();

    const attack = editor.getByRole('spinbutton', { name: 'Attack exact value' });
    await expect(editor.getByRole('combobox', { name: 'Attack unit' })).toHaveValue('ms');
    await attack.fill('40');
    await attack.press('Enter');
    await expect(attack).toHaveValue('40');
  });

  test('renders loop-capable sample and oscillator models from the shared capability table', async ({ page }) => {
    const organRow = page.locator('.track-row-wrapper').nth(1);
    await openEnvelopeEditor(organRow);
    const organEditor = organRow.getByRole('region', { name: 'Amplitude envelope' });
    await expect(organEditor.getByRole('button', { name: /ADSR/ }))
      .toHaveAttribute('aria-expanded', 'true');

    await expect(organEditor.getByRole('radio', { name: 'Loop' })).toBeChecked();
    await expect(organEditor.getByRole('spinbutton', { name: 'Sustain exact value' })).toHaveValue('0.72');
    await expect(organEditor.getByRole('slider', { name: 'Gate' })).toBeEnabled();

    const padRow = page.locator('.track-row-wrapper').nth(2);
    await openEnvelopeEditor(padRow);
    const padEditor = padRow.getByRole('region', { name: 'Amplitude envelope' });
    await expect(padEditor.getByRole('button', { name: /ADSR/ }))
      .toHaveAttribute('aria-expanded', 'true');

    await expect(padEditor.getByRole('combobox', { name: 'Envelope model' })).toHaveValue('adsr');
    await expect(padEditor.getByRole('radio', { name: 'Loop' })).toHaveCount(0);
    await expect(padEditor.getByRole('combobox', { name: 'Attack unit' })).toHaveValue('st');
  });

  test('keeps portrait consumption-only and exposes the same editor after rotating', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('.portrait-track-row')).toHaveCount(3);
    await expect(page.locator('.orientation-hint')).toContainText('Rotate to edit');
    await expect(page.getByRole('button', { name: 'Amplitude envelope' })).toHaveCount(0);

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.step-sequencer')).toHaveAttribute('data-orientation', 'landscape');
    const row = page.locator('.track-row-wrapper').first();
    await expect(row.locator('.track-name')).toBeVisible();
    await row.locator('.track-name').focus();
    await page.keyboard.press('Enter');

    const drawer = page.getByRole('region', { name: 'Finite piano track controls' });
    await drawer.getByRole('button', { name: 'Amplitude envelope' }).click();
    const editor = row.getByRole('region', { name: 'Amplitude envelope' });
    await expect(editor.getByRole('button', { name: /AHD/ }))
      .toHaveAttribute('aria-expanded', 'true');
    await expect(editor.getByRole('spinbutton', { name: 'Hold exact value' })).toBeVisible();
  });
});
