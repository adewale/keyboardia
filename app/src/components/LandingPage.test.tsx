// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_SESSIONS } from '../data/example-sessions';
import { LandingPage } from './LandingPage';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('LandingPage', () => {
  it('offers the blank-session path and a shared Remix action for every example', async () => {
    vi.stubEnv('VITE_USE_MOCK_API', '1');
    const onStartSession = vi.fn();
    const onRemixExample = vi.fn().mockResolvedValue(undefined);

    render(
      <LandingPage
        onStartSession={onStartSession}
        onRemixExample={onRemixExample}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Start with Groove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));
    expect(onStartSession).toHaveBeenCalledOnce();

    const remixButtons = document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remix "]');
    expect(remixButtons).toHaveLength(EXAMPLE_SESSIONS.length);
    expect(screen.getAllByRole('button', { name: /^Remix / })).toHaveLength(2);

    fireEvent.click(remixButtons[0]);
    await waitFor(() => {
      expect(onRemixExample).toHaveBeenCalledWith({
        sourceId: EXAMPLE_SESSIONS[0].localUuid,
      });
    });
  });

  it('keeps clipped cards out of the accessibility and keyboard trees', () => {
    vi.stubEnv('VITE_USE_MOCK_API', '1');
    render(
      <LandingPage
        onStartSession={vi.fn()}
        onRemixExample={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const cards = document.querySelectorAll<HTMLElement>('.landing-example-card');
    expect(cards[0].getAttribute('aria-hidden')).toBe('false');
    expect(cards[1].getAttribute('aria-hidden')).toBe('false');
    expect(cards[2].getAttribute('aria-hidden')).toBe('true');
    expect(cards[2].hasAttribute('inert')).toBe(true);
    expect(cards[0].querySelectorAll('a')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next examples' }));
    expect(cards[0].getAttribute('aria-hidden')).toBe('true');
    expect(cards[2].getAttribute('aria-hidden')).toBe('false');
  });
});
