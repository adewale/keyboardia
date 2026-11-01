import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ChokeGroupRegistry,
  CHOKE_FADE_TIME_CONSTANT,
  CHOKE_STOP_DELAY,
  type ChokeableVoice,
} from './choke-groups';
import { FakeAudioParam } from './__fakes__/FakeWebAudio';

/**
 * Choke groups (P5 in SAMPLE-AUDIT-2026-06): a closed hi-hat hit must
 * silence a ringing open hi-hat. Voices register under a group name;
 * starting a new voice cuts every voice already in the group.
 *
 * The registry is deliberately instrument-agnostic — open and closed
 * hats are *different* SampledInstrument instances, so choking cannot
 * live inside one instrument.
 */

function makeVoice(): ChokeableVoice & {
  gainParam: FakeAudioParam;
  stopCalls: number[];
} {
  const gainParam = new FakeAudioParam();
  const stopCalls: number[] = [];
  return {
    gainParam,
    stopCalls,
    gain: gainParam,
    stop: (when: number) => stopCalls.push(when),
  };
}

describe('ChokeGroupRegistry', () => {
  it('cuts the previously registered voice when a new one starts', () => {
    const registry = new ChokeGroupRegistry();
    const open = makeVoice();
    const closed = makeVoice();

    registry.cutAndRegister('hihat', open, 1.0);
    registry.cutAndRegister('hihat', closed, 2.0);

    // The open hat's gain is faded out at the closed hat's start time...
    expect(open.gainParam.eventsOfType('cancelScheduledValues')).toHaveLength(1);
    const fade = open.gainParam.eventsOfType('setTargetAtTime')[0];
    expect(fade.value).toBe(0);
    expect(fade.time).toBe(2.0);
    expect(fade.timeConstant).toBe(CHOKE_FADE_TIME_CONSTANT);
    // ...and its source is stopped shortly after the fade.
    expect(open.stopCalls).toEqual([2.0 + CHOKE_STOP_DELAY]);

    // The new voice is untouched.
    expect(closed.gainParam.events).toHaveLength(0);
    expect(closed.stopCalls).toHaveLength(0);
  });

  it('does not cut across different groups', () => {
    const registry = new ChokeGroupRegistry();
    const hat = makeVoice();
    const crash = makeVoice();

    registry.cutAndRegister('hihat', hat, 1.0);
    registry.cutAndRegister('crash', crash, 2.0);

    expect(hat.stopCalls).toHaveLength(0);
    expect(hat.gainParam.events).toHaveLength(0);
  });

  it('never cuts a removed voice (natural note end deregisters)', () => {
    const registry = new ChokeGroupRegistry();
    const first = makeVoice();
    registry.cutAndRegister('hihat', first, 1.0);
    registry.remove('hihat', first);

    registry.cutAndRegister('hihat', makeVoice(), 2.0);
    expect(first.stopCalls).toHaveLength(0);
    expect(first.gainParam.events).toHaveLength(0);
  });

  it('remove is safe for unknown voices and groups', () => {
    const registry = new ChokeGroupRegistry();
    expect(() => registry.remove('nope', makeVoice())).not.toThrow();
  });

  it('property: after any sequence of cuts, at most one voice is active per group', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            group: fc.constantFrom('a', 'b', 'c'),
            time: fc.double({ min: 0, max: 100, noNaN: true }),
          }),
          { maxLength: 40 }
        ),
        (ops) => {
          const registry = new ChokeGroupRegistry();
          for (const op of ops) {
            registry.cutAndRegister(op.group, makeVoice(), op.time);
          }
          for (const group of ['a', 'b', 'c']) {
            expect(registry.activeCount(group)).toBeLessThanOrEqual(1);
          }
        }
      )
    );
  });

  it('property: every voice is cut at most once, and only at a later registration', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        (times) => {
          const registry = new ChokeGroupRegistry();
          const voices = times.map(() => makeVoice());
          times.forEach((t, i) => registry.cutAndRegister('g', voices[i], t));
          for (const v of voices) {
            expect(v.stopCalls.length).toBeLessThanOrEqual(1);
            expect(v.gainParam.eventsOfType('setTargetAtTime').length).toBe(
              v.stopCalls.length
            );
          }
          // All but the last voice were cut exactly once.
          const cutCount = voices.filter(v => v.stopCalls.length === 1).length;
          expect(cutCount).toBe(voices.length - 1);
        }
      )
    );
  });
});
