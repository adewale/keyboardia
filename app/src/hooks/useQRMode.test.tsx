// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useQRMode } from './useQRMode';

afterEach(() => window.history.replaceState({}, '', '/'));

describe('useQRMode session ownership', () => {
  it('recomputes the QR target after pushState changes the active session', () => {
    window.history.replaceState({}, '', '/s/11111111-1111-4111-8111-111111111111');
    const { result, rerender } = renderHook(() => useQRMode());

    act(() => result.current.activate());
    expect(result.current.targetURL).toContain('/s/11111111-1111-4111-8111-111111111111');
    expect(result.current.targetURL).not.toContain('qr=1');

    act(() => {
      window.history.pushState({}, '', '/s/22222222-2222-4222-8222-222222222222?qr=1');
      rerender();
    });

    expect(result.current.targetURL).toContain('/s/22222222-2222-4222-8222-222222222222');
    expect(result.current.targetURL).not.toContain('qr=1');
  });
});
