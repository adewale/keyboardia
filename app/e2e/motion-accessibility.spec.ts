import { test, expect } from './global-setup';

async function mountMotionFixtures(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <button class="session-btn" type="button">Session action</button>
      <button class="step-cell" type="button">Step</button>
      <div class="plock-inline">Parameter lock editor</div>
      <button class="action-btn paste" type="button">Paste</button>
      <div class="orientation-hint"><span class="orientation-hint-icon">Rotate</span></div>
      <div class="avatar avatar-playing">A</div>
      <button class="portrait-play-btn" type="button">Play</button>
    `;
    document.body.appendChild(fixture);
  });
}

test.describe('shared motion accessibility', () => {
  test('uses short interaction feedback in standard motion mode @blocking', async ({ page }) => {
    await page.goto('/');
    await mountMotionFixtures(page);

    const sessionButton = page.locator('.session-btn').last();
    const stepCell = page.locator('.step-cell').last();
    const panel = page.locator('.plock-inline').last();

    await expect(sessionButton).toHaveCSS('transition-duration', '0.09s');
    await expect(stepCell).toHaveCSS('transition-property', 'scale');
    await expect(stepCell).toHaveCSS('transition-duration', '0.09s');
    await expect(panel).toHaveCSS('animation-name', 'kb-panel-in');
  });

  test('removes shared transitions and animations for reduced motion @blocking', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await mountMotionFixtures(page);

    const sessionButton = page.locator('.session-btn').last();
    const panel = page.locator('.plock-inline').last();
    const paste = page.locator('.action-btn.paste').last();
    const hint = page.locator('.orientation-hint').last();
    const avatar = page.locator('.avatar.avatar-playing').last();
    const portraitPlay = page.locator('.portrait-play-btn').last();

    await expect(sessionButton).toHaveCSS('transition-duration', '0s');
    await expect(panel).toHaveCSS('animation-name', 'none');
    await expect(paste).toHaveCSS('animation-name', 'none');
    await expect(hint).toHaveCSS('animation-name', 'none');
    await expect(avatar).toHaveCSS('animation-name', 'none');
    await expect(portraitPlay).toHaveCSS('transition-duration', '0s');
  });
});
