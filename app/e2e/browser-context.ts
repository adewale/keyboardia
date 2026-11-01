import type { Browser, BrowserContext, Page } from '@playwright/test';

const navigationConfiguredPages = new WeakSet<Page>();

/**
 * A browser can reach an interactive document without completing its `load`
 * lifecycle event, especially late in the long Chromium and WebKit lanes. The
 * E2E suite already owns readiness through DOM and application-level
 * assertions, so waiting for `load` adds a flaky, redundant gate. Preserve any
 * explicit caller choice while making DOMContentLoaded the default.
 */
const configureNavigation = (page: Page): void => {
  if (navigationConfiguredPages.has(page)) return;
  navigationConfiguredPages.add(page);

  const goto = page.goto.bind(page);
  page.goto = (url, options = {}) => goto(url, {
    waitUntil: 'domcontentloaded',
    ...options,
  });
};

const installPreloadGuard = async (target: Page | BrowserContext): Promise<void> => {
  await target.addInitScript(() => {
    (window as unknown as { __KEYBOARDIA_DISABLE_AUDIO_PRELOAD__?: boolean })
      .__KEYBOARDIA_DISABLE_AUDIO_PRELOAD__ = true;
  });
};

/** Keep non-audio WebKit contracts independent of its unstable headless media process. */
export async function configureE2EPage(page: Page, browserName: string): Promise<void> {
  configureNavigation(page);
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
  // Custom multiplayer contexts bypass the default `page` fixture. Configure
  // each page synchronously when Playwright emits it, before callers navigate.
  context.on('page', configureNavigation);
  return context;
}
