import { describe, expect, it } from 'vitest';
import { extractAnchorExtras } from '../src/anchor-extras';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

describe('extractAnchorExtras', () => {
  it('keeps relations and nested-path PDA seeds, camelCased like Codama', () => {
    expect(extractAnchorExtras(vault)).toEqual({
      deposit: {
        mint: { relations: ['pool'] },
        authority: { relations: ['pool'] },
        userPosition: {
          relations: [],
          nestedSeeds: [
            { kind: 'const', bytes: [112, 111, 115] },
            { kind: 'account', path: ['pool', 'mint'] },
            { kind: 'account', path: ['user'] },
          ],
        },
      },
    });
  });

  it('returns nothing for legacy (pre-0.30) IDLs', () => {
    expect(extractAnchorExtras({ version: '0.1.0', name: 'x', instructions: [] })).toEqual({});
  });
});
