import { describe, expect, it } from 'vitest';
import { fromJson, toJson } from '../src/serde';

describe('serde', () => {
  it('round-trips bigint and bytes', () => {
    const value = { a: 1n << 70n, b: new Uint8Array([0, 1, 255]), c: [{ d: -5n }], e: 'x', f: null };
    expect(fromJson(toJson(value))).toEqual(value);
  });

  it('escapes user objects that look like markers', () => {
    for (const value of [{ x: { $bigint: '12' } }, { $bytes: 'AA==' }, { y: { $obj: { $bigint: '1' } } }, { z: { $obj: 5n } }]) {
      expect(fromJson(toJson(value))).toEqual(value);
    }
  });

  it('is deterministic for identical input', () => {
    expect(toJson({ x: [1n] })).toBe(toJson({ x: [1n] }));
  });
});
