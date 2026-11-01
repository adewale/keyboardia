import { useSyncExternalStore } from 'react';
import { isAudioUnlocked, subscribeToAudioUnlock } from '../audio/audioTriggers';

/**
 * React hook that returns whether audio has been unlocked by a user gesture.
 *
 * Use this to grey out audio preview UI until the user has performed a valid
 * gesture (click, touch, keypress) that can unlock the AudioContext.
 *
 * @example
 * ```tsx
 * function SamplePicker() {
 *   const audioUnlocked = useAudioUnlocked();
 *
 *   return (
 *     <div className={audioUnlocked ? '' : 'previews-disabled'}>
 *       {instruments.map(i => (
 *         <button onMouseEnter={() => audioUnlocked && preview(i)}>
 *           {i.name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAudioUnlocked(): boolean {
  return useSyncExternalStore(
    subscribeToAudioUnlock,
    isAudioUnlocked,
    // Server snapshot - always false during SSR
    () => false
  );
}
