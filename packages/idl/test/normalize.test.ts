import { describe, expect, it } from 'vitest';
import { normalizeIdl } from '../src';
import token from '../idls/token.json' with { type: 'json' };
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

describe('normalizeIdl', () => {
  it('converts Anchor IDLs to Codama and keeps the extras', async () => {
    const n = await normalizeIdl(vault);
    expect(n.root.program.publicKey).toBe('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    expect(n.root.program.instructions?.map((i) => i.name)).toEqual(['deposit']);
    expect(n.anchorExtras?.deposit?.mint?.relations).toEqual(['pool']);
    expect(n.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts Codama roots as-is', async () => {
    const n = await normalizeIdl(JSON.stringify(token));
    expect(n.root.program.name).toBe('token');
    expect(n.anchorExtras).toBeUndefined();
  });

  it('rejects unknown formats', async () => {
    await expect(normalizeIdl({ hello: 'world' })).rejects.toThrow(/Unrecognized IDL/);
  });
});
