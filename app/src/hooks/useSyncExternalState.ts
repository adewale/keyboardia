/**
 * useSyncExternalState Hook
 *
 * Synchronizes external state (props) to local component state using
 * JSON.stringify comparison to prevent unnecessary re-renders.
 *
 * This pattern is needed when:
 * 1. A component receives state from props (external source)
 * 2. The component also needs to modify that state locally
 * 3. Changes from either source should be reflected
 *
 * TASK-006 from DUPLICATION-REMEDIATION-PLAN.md
 */

import { useEffect, useState, useCallback, Dispatch, SetStateAction } from 'react';

/**
 * Hook that syncs external state to local state with JSON.stringify comparison.
 *
 * @param externalState - The external state from props
 * @param initialValue - Initial value if externalState is undefined
 * @returns [localState, setLocalState] - Standard React state tuple
 *
 * @example
 * ```tsx
 * // In a component that receives effects from props but also edits locally:
 * const [effects, setEffects] = useSyncExternalState(
 *   props.effectsState,
 *   DEFAULT_EFFECTS
 * );
 * ```
 */
export function useSyncExternalState<T>(
  externalState: T | undefined,
  initialValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [localState, setLocalState] = useState<T>(externalState ?? initialValue);

  // Sync external state to local state when it changes
  // Uses JSON.stringify comparison to prevent unnecessary re-renders
  useEffect(() => {
    if (externalState !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: syncing external prop to local state
      setLocalState(prev => {
        // Only update if values actually differ (prevents cascading renders)
        if (JSON.stringify(prev) === JSON.stringify(externalState)) return prev;
        return externalState;
      });
    }
  }, [externalState]);

  return [localState, setLocalState];
}

/**
 * Hook variant that calls a side effect when the external state changes.
 * Useful when you need to apply the state to an external system (e.g., audio engine).
 *
 * @param externalState - The external state from props
 * @param initialValue - Initial value if externalState is undefined
 * @param onExternalChange - Callback called when external state changes
 * @returns [localState, setLocalState] - Standard React state tuple
 *
 * @example
 * ```tsx
 * const [effects, setEffects] = useSyncExternalStateWithSideEffect(
 *   props.effectsState,
 *   DEFAULT_EFFECTS,
 *   (state) => audioEngine.applyEffectsState(state)
 * );
 * ```
 */
export function useSyncExternalStateWithSideEffect<T>(
  externalState: T | undefined,
  initialValue: T,
  onExternalChange?: (state: T) => void
): [T, Dispatch<SetStateAction<T>>] {
  const [localState, setLocalState] = useState<T>(externalState ?? initialValue);

  // Track whether we should call the side effect
  const shouldApplySideEffect = useCallback(
    (newState: T) => {
      if (onExternalChange) {
        onExternalChange(newState);
      }
    },
    [onExternalChange]
  );

  // Sync external state to local state when it changes
  useEffect(() => {
    if (externalState !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: syncing external prop to local state
      setLocalState(prev => {
        // Only update if values actually differ
        if (JSON.stringify(prev) === JSON.stringify(externalState)) return prev;
        return externalState;
      });
      // Call side effect when external state changes
      shouldApplySideEffect(externalState);
    }
  }, [externalState, shouldApplySideEffect]);

  return [localState, setLocalState];
}
