import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createBundledSource, UserIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

describe('static IDL sources', () => {
  it('bundled source serves native programs as curated', async () => {
    const idl = await createBundledSource().load(TOKEN);
    expect(idl).toMatchObject({ programId: TOKEN, source: 'bundled', trust: 'curated' });
    expect(idl?.root.program.name).toBe('token');
  });

  it('bundled source returns null for unknown programs', async () => {
    expect(await createBundledSource().load(VAULT)).toBeNull();
  });

  it('bundled source serves the memo IDL under both v3 and v4 addresses', async () => {
    for (const id of ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH']) {
      const idl = await createBundledSource().load(address(id));
      expect(idl).not.toBeNull();
      expect(idl?.root.program.publicKey).toBe(id);
    }
  });

  it('user source serves what the user added, marked as user trust', async () => {
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    expect(await user.load(VAULT)).toMatchObject({ source: 'user', trust: 'user' });
    user.delete(VAULT);
    expect(await user.load(VAULT)).toBeNull();
  });
});
