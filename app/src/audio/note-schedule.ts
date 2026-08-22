/** Shared stop guard for real synth and managed-sample voice schedules. */

/** Linear attack ramp applied at note start to prevent clicks. */
export const ATTACK_FADE_SEC = 0.003;

/** Notes shorter than this are stretched so they remain audible. */
export const MIN_NOTE_DURATION_SEC = 0.1;

/** Floor reached by the exponential release before a short linear fade to zero. */
export const RELEASE_FLOOR_GAIN = 0.0001;

/** Audible-silence ramp after the release floor before source disposal. */
export const RELEASE_TAIL_GUARD_SEC = 0.03;

/** Floor for the release ramp length (exponential ramps need time > 0). */
const MIN_RELEASE_SEC = 0.01;

export interface NoteScheduleInput {
  /** The intended note start (audio-context seconds), from the scheduler. */
  eventTime: number;
  /** audioContext.currentTime at the moment of scheduling. */
  currentTime: number;
  /** Note length in seconds; undefined = sustained (no release section). */
  duration?: number;
  /** Manifest release time in seconds. */
  releaseTime: number;
}

export interface NoteSchedule {
  /** When the source actually starts: max(eventTime, currentTime). */
  startTime: number;
  /** End of the declick attack ramp. */
  attackEnd: number;
  /** Release section; absent for sustained notes. */
  release?: {
    /** Sustain ends and the release ramp begins. */
    start: number;
    /** Release ramp reaches silence. */
    end: number;
    /** Hard stop for the source node. */
    stopTime: number;
  };
}

export function computeNoteSchedule(input: NoteScheduleInput): NoteSchedule {
  // Web Audio refuses to start sources in the past; clamp late notes to now.
  const startTime = Math.max(input.eventTime, input.currentTime);
  const attackEnd = startTime + ATTACK_FADE_SEC;

  if (input.duration === undefined) {
    return { startTime, attackEnd };
  }

  const effectiveDuration = Math.max(input.duration, MIN_NOTE_DURATION_SEC);
  const releaseStart = startTime + effectiveDuration;
  const releaseEnd = releaseStart + Math.max(input.releaseTime, MIN_RELEASE_SEC);

  return {
    startTime,
    attackEnd,
    release: {
      start: releaseStart,
      end: releaseEnd,
      stopTime: releaseEnd + RELEASE_TAIL_GUARD_SEC,
    },
  };
}
