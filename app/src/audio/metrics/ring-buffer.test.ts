import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('starts empty', () => {
    const buf = new RingBuffer<number>(10);
    expect(buf.size()).toBe(0);
    expect(buf.toArray()).toEqual([]);
    expect(buf.last()).toBeUndefined();
  });

  it('stores values up to capacity', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size()).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it('overwrites oldest when full', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.size()).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it('last() returns the most recent value', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(10);
    expect(buf.last()).toBe(10);
    buf.push(20);
    expect(buf.last()).toBe(20);
    buf.push(30);
    buf.push(40);
    expect(buf.last()).toBe(40);
  });

  it('clear resets the buffer', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  it('handles wrap-around correctly with many items', () => {
    const buf = new RingBuffer<number>(4);
    for (let i = 0; i < 100; i++) {
      buf.push(i);
    }
    expect(buf.size()).toBe(4);
    expect(buf.toArray()).toEqual([96, 97, 98, 99]);
  });

  it('works with non-number types', () => {
    const buf = new RingBuffer<string>(2);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    expect(buf.toArray()).toEqual(['b', 'c']);
  });
});
