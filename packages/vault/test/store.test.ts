import { describe, expect, it } from 'vitest';
import { fromBase64, MemoryStore, toBase64, zeroize } from '../src';

describe('bytes and stores', () => {
  it('round-trips base64', () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it('zeroizes in place', () => {
    const b = new Uint8Array([1, 2, 3]);
    zeroize(b);
    expect([...b]).toEqual([0, 0, 0]);
  });

  it('memory store returns copies', async () => {
    const s = new MemoryStore();
    await s.set('k', { a: [1] });
    const v = await s.get<{ a: number[] }>('k');
    v!.a.push(2);
    expect(await s.get('k')).toEqual({ a: [1] });
    await s.remove('k');
    expect(await s.get('k')).toBeUndefined();
  });
});
