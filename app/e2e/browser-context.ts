import type { Browser, BrowserContext, Page } from '@playwright/test';

const installPreloadGuard = async (target: Page | BrowserContext): Promise<void> => {
  await target.addInitScript(() => {
    (window as unknown as { __KEYBOARDIA_DISABLE_AUDIO_PRELOAD__?: boolean })
      .__KEYBOARDIA_DISABLE_AUDIO_PRELOAD__ = true;
  });
};

/** Keep non-audio WebKit contracts independent of its unstable headless media process. */
export async function configureE2EPage(page: Page, browserName: string): Promise<void> {
  if (browserName === 'webkit') await installPreloadGuard(page);
}

/**
 * Create a context with the same WebKit guard as the default page fixture.
 * Multiplayer tests must use this instead of browser.newContext() so custom
 * pages do not silently bypass the browser-project contract.
 */
export async function createE2EContext(
  browser: Browser,
  browserName: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (browserName === 'webkit') await installPreloadGuard(context);
  return context;
}
