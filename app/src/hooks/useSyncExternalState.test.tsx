// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSyncExternalStateWithSideEffect } from './useSyncExternalState';

describe('useSyncExternalStateWithSideEffect', () => {
  it('does not repeat the side effect when only an inline callback identity changes', () => {
    const sideEffect = vi.fn();
    const externalState = { wet: 0.25 };
    const { rerender } = renderHook(
      ({ renderMarker }: { renderMarker: number }) =>
        useSyncExternalStateWithSideEffect(
          externalState,
          { wet: 0 },
          state => sideEffect(renderMarker, state),
        ),
      { initialProps: { renderMarker: 1 } },
    );

    expect(sideEffect).toHaveBeenCalledTimes(1);
    expect(sideEffect).toHaveBeenLastCalledWith(1, externalState);

    rerender({ renderMarker: 2 });

    expect(sideEffect).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback when the external state changes', () => {
    const sideEffect = vi.fn();
    const { rerender } = renderHook(
      ({ wet, renderMarker }: { wet: number; renderMarker: number }) =>
        useSyncExternalStateWithSideEffect(
          { wet },
          { wet: 0 },
          state => sideEffect(renderMarker, state),
        ),
      { initialProps: { wet: 0.25, renderMarker: 1 } },
    );

    rerender({ wet: 0.5, renderMarker: 2 });

    expect(sideEffect).toHaveBeenCalledTimes(2);
    expect(sideEffect).toHaveBeenLastCalledWith(2, { wet: 0.5 });
  });
});
