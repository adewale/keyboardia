import { test, expect } from './global-setup';

async function mountMotionFixtures(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <button class="session-btn" type="button">Session action</button>
      <div class="plock-inline">Parameter lock editor</div>
      <button class="action-btn paste" type="button">Paste</button>
    `;
    document.body.appendChild(fixture);
  });
}

test.describe('shared motion accessibility', () => {
  test('uses short interaction feedback in standard motion mode', async ({ page }) => {
    await page.goto('/');
    await mountMotionFixtures(page);

    const sessionButton = page.locator('.session-btn').last();
    const panel = page.locator('.plock-inline').last();

    await expect(sessionButton).toHaveCSS('transition-duration', '0.09s');
    await expect(panel).toHaveCSS('animation-name', 'kb-panel-in');
  });

  test('removes shared transitions and animations for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await mountMotionFixtures(page);

    const sessionButton = page.locator('.session-btn').last();
    const panel = page.locator('.plock-inline').last();
    const paste = page.locator('.action-btn.paste').last();

    await expect(sessionButton).toHaveCSS('transition-duration', '0s');
    await expect(panel).toHaveCSS('animation-name', 'none');
    await expect(paste).toHaveCSS('animation-name', 'none');
  });
});
