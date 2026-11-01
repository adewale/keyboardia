import { describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { configureE2EPage, createE2EContext } from '../e2e/browser-context';

function pageDouble() {
  const goto = vi.fn().mockResolvedValue(null);
  const addInitScript = vi.fn().mockResolvedValue(undefined);
  return {
    addInitScript,
    goto,
    page: { addInitScript, goto } as unknown as Page,
  };
}

describe('E2E browser configuration', () => {
  it('uses DOMContentLoaded as the default navigation milestone', async () => {
    const { page, goto } = pageDouble();
    await configureE2EPage(page, 'webkit');

    await page.goto('/s/example');
    expect(goto).toHaveBeenCalledWith('/s/example', {
      waitUntil: 'domcontentloaded',
    });
  });

  it('preserves an explicit navigation milestone', async () => {
    const { page, goto } = pageDouble();
    await configureE2EPage(page, 'webkit');

    await page.goto('/s/example', { waitUntil: 'commit' });
    expect(goto).toHaveBeenCalledWith('/s/example', { waitUntil: 'commit' });
  });

  it('configures Chromium navigation without the WebKit audio guard', async () => {
    const { page, goto, addInitScript } = pageDouble();
    await configureE2EPage(page, 'chromium');

    await page.goto('/s/example');
    expect(goto).toHaveBeenCalledWith('/s/example', {
      waitUntil: 'domcontentloaded',
    });
    expect(addInitScript).not.toHaveBeenCalled();
  });

  it('configures pages created by custom browser contexts', async () => {
    let onPage: ((page: Page) => void) | undefined;
    const context = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, listener: (page: Page) => void) => {
        if (event === 'page') onPage = listener;
      }),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
    } as unknown as Browser;

    await createE2EContext(browser, 'chromium');
    const { page, goto } = pageDouble();
    expect(onPage).toBeDefined();
    onPage!(page);
    await page.goto('/s/multiplayer');

    expect(goto).toHaveBeenCalledWith('/s/multiplayer', {
      waitUntil: 'domcontentloaded',
    });
  });
});
