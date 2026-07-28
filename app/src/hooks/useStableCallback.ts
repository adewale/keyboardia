/**
 * ESLint disable for this file:
 * - react-hooks/use-memo: We intentionally use a non-inline function in useCallback
 *
 * New values are published from a layout effect. Mutating the ref during render
 * lets timers and native listeners observe work React later abandons.
 */
/* eslint-disable react-hooks/use-memo */
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * useStableCallback - Creates a callback that maintains a stable reference while
 * always calling the latest version of the function.
 *
 * BUG PATTERN PREVENTION: "Unstable Callback in useEffect Dependency"
 * See docs/bug-patterns.md for details.
 *
 * PROBLEM:
 * When a callback created with useCallback has state dependencies and is used
 * as a useEffect dependency, every state change causes the effect to re-run.
 *
 * ```typescript
 * // BUGGY: Callback reference changes on every state change
 * const getState = useCallback(() => ({ tempo: state.tempo }), [state.tempo]);
 * useEffect(() => {
 *   websocket.connect(getState);  // Reconnects on every state change!
 *   return () => websocket.disconnect();
 * }, [getState]);
 * ```
 *
 * SOLUTION:
 * This hook stores the function in a ref, so the returned callback always has
 * the same reference but calls the latest version of the function.
 *
 * ```typescript
 * // FIXED: Callback reference is stable, but always calls latest function
 * const getState = useStableCallback(() => ({ tempo: state.tempo }));
 * useEffect(() => {
 *   websocket.connect(getState);  // Only connects once!
 *   return () => websocket.disconnect();
 * }, [getState]);
 * ```
 *
 * @param fn - The function to wrap. Can have any signature.
 * @returns A stable callback that always calls the latest version of fn.
 *
 * @example
 * // Before (unstable):
 * const getStateForHash = useCallback(() => ({
 *   tracks: state.tracks,
 *   tempo: state.tempo,
 * }), [state.tracks, state.tempo]);  // Changes on every state update!
 *
 * // After (stable):
 * const getStateForHash = useStableCallback(() => ({
 *   tracks: state.tracks,
 *   tempo: state.tempo,
 * }));  // Always same reference, always returns current state
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const fnRef = useRef(fn);

  useLayoutEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Return a stable callback that calls the latest function from ref
  // The empty dependency array ensures the callback reference never changes
  return useCallback(
    ((...args: Parameters<T>) => fnRef.current(...args)) as T,
    []
  );
}

/**
 * useStableGetter - Creates a stable getter function for accessing current state.
 *
 * This is a specialized version of useStableCallback for the common pattern of
 * creating a getter function that returns current state.
 *
 * @param value - The current value to return from the getter
 * @returns A stable getter function that always returns the current value
 *
 * @example
 * const [tempo, setTempo] = useState(120);
 * const getTempo = useStableGetter(tempo);
 *
 * // getTempo() always returns current tempo
 * // getTempo reference never changes
 * useEffect(() => {
 *   const interval = setInterval(() => {
 *     console.log('Current tempo:', getTempo());
 *   }, 1000);
 *   return () => clearInterval(interval);
 * }, [getTempo]);  // Effect only runs once!
 */
export function useStableGetter<T>(value: T): () => T {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  return useCallback(() => valueRef.current, []);
}
