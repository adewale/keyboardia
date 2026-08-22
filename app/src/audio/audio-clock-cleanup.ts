/**
 * Schedule teardown from the audio clock. A one-frame silent source produces
 * an `ended` event even when background tabs throttle wall-clock timers.
 */
export function scheduleAudioClockCleanup(
  context: AudioContext,
  when: number,
  cleanup: () => void,
): AudioBufferSourceNode | null {
  if (!Number.isFinite(when)) return null;
  try {
    const sentinel = context.createBufferSource();
    sentinel.buffer = context.createBuffer(1, 1, context.sampleRate);
    sentinel.onended = () => {
      sentinel.disconnect();
      cleanup();
    };
    sentinel.start(Math.max(context.currentTime, when));
    return sentinel;
  } catch {
    // A disposed context cannot schedule more audio work. Disconnecting now is
    // safer than retaining the graph; no timer fallback is introduced.
    cleanup();
    return null;
  }
}

