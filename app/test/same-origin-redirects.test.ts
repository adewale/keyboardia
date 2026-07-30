import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- the dependency-free transport helper is ESM JavaScript.
import { fetchWithSameOriginRedirects } from '../scripts/same-origin-redirects.mjs';

describe('same-origin discovery redirects', () => {
  it('follows a bounded relative redirect and records the hop', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { Location: '/canonical/index.json' },
      }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const result = await fetchWithSameOriginRedirects({
      url: 'https://keyboardia.dev/.well-known/agent-skills/index.json',
      origin: 'https://keyboardia.dev',
      fetchImpl,
    });
    expect(result.url.href).toBe('https://keyboardia.dev/canonical/index.json');
    expect(result.redirects).toEqual([{
      from: 'https://keyboardia.dev/.well-known/agent-skills/index.json',
      to: 'https://keyboardia.dev/canonical/index.json',
      status: 302,
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a cross-origin redirect before fetching the target', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302, headers: { Location: 'https://attacker.invalid/skill.md' },
    }));
    await expect(fetchWithSameOriginRedirects({
      url: 'https://keyboardia.dev/.well-known/agent-skills/index.json',
      origin: 'https://keyboardia.dev',
      fetchImpl,
    })).rejects.toThrow(/cross-origin request denied/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops a redirect loop at the configured limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 307, headers: { Location: '/loop' },
    }));
    await expect(fetchWithSameOriginRedirects({
      url: 'https://keyboardia.dev/loop',
      origin: 'https://keyboardia.dev',
      fetchImpl,
      maxRedirects: 2,
    })).rejects.toThrow(/redirect limit exceeded: 2/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
