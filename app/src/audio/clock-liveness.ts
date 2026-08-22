/**
 * Clock-liveness gate (Phase 44 §6).
 *
 * On iOS an AudioContext can report `state === 'running'` while its clock is
 * still parked at the pre-resume value, and audio scheduled against the stale
 * clock is dropped. After a resume, wait (bounded) for `currentTime` to
 * actually advance before trusting the context. Contexts whose clock already
 * moved return immediately; a clock that never moves within the budget is
 * reported but not treated as fatal — playback proceeds, matching the
 * reference behaviour this is adopted from.
 */

export const CLOCK_LIVENESS_TIMEOUT_MS = 250;
export const CLOCK_LIVENESS_POLL_MS = 10;

export async function waitForClockAdvance(
  context: Pick<BaseAudioContext, 'currentTime'>,
  timeoutMs: number = CLOCK_LIVENESS_TIMEOUT_MS,
): Promise<boolean> {
  const start = context.currentTime;
  if (start > 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (context.currentTime > start) return true;
    await new Promise(resolve => setTimeout(resolve, CLOCK_LIVENESS_POLL_MS));
  }
  return context.currentTime > start;
}
