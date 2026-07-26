import { describe, expect, it, vi } from 'vitest';
import { AsyncActionLatch } from './AsyncActionLatch';

describe('AsyncActionLatch', () => {
  it('rejects concurrent entry and releases after completion', async () => {
    const latch = new AsyncActionLatch();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const action = vi.fn(() => pending);

    const first = latch.run(action);
    const second = await latch.run(action);

    expect(latch.active).toBe(true);
    expect(second).toBe(false);
    expect(action).toHaveBeenCalledOnce();

    release();
    await expect(first).resolves.toBe(true);
    expect(latch.active).toBe(false);
  });

  it('releases after a failed action', async () => {
    const latch = new AsyncActionLatch();
    await expect(latch.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');

    expect(latch.active).toBe(false);
    await expect(latch.run(async () => {})).resolves.toBe(true);
  });

  it('invalidates an in-flight action without admitting a concurrent replacement', async () => {
    const latch = new AsyncActionLatch();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let stillCurrent: (() => boolean) | undefined;

    const first = latch.run(async (isCurrent) => {
      stillCurrent = isCurrent;
      await pending;
    });
    expect(stillCurrent?.()).toBe(true);

    latch.cancel();
    expect(stillCurrent?.()).toBe(false);
    expect(latch.active).toBe(true);
    await expect(latch.run(async () => {})).resolves.toBe(false);

    release();
    await expect(first).resolves.toBe(true);
    expect(latch.active).toBe(false);
  });
});
