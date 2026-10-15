import { MemoryChainReader } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultResolver, IdlResolver, UserIdlSource, type IdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

async function all(resolver: IdlResolver, id: Address, onError?: (e: unknown) => void) {
  const out = [];
  for await (const idl of resolver.candidates(id, onError)) out.push(idl.source);
  return out;
}

describe('IdlResolver', () => {
  it('yields sources in priority order and skips misses', async () => {
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const resolver = createDefaultResolver(new MemoryChainReader(), user);
    expect(await all(resolver, VAULT)).toEqual(['user']);
  });

  it('reports failing sources and keeps going', async () => {
    const broken: IdlSource = { kind: 'program-metadata', load: () => Promise.reject(new Error('boom')) };
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const onError = vi.fn();
    expect(await all(new IdlResolver([broken, user]), VAULT, onError)).toEqual(['user']);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ source: 'program-metadata', message: 'boom' }));
  });

  it('loads each source at most once per program', async () => {
    const load = vi.fn().mockResolvedValue(null);
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    await all(resolver, VAULT);
    await all(resolver, VAULT);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries a source whose load rejected', async () => {
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const resolved = await user.load(VAULT);
    const load = vi.fn().mockRejectedValueOnce(new Error('rpc down')).mockResolvedValue({ ...resolved, source: 'anchor-onchain' });
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    const onError = vi.fn();
    expect(await all(resolver, VAULT, onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ source: 'anchor-onchain', message: 'rpc down' }));
    expect(await all(resolver, VAULT, onError)).toEqual(['anchor-onchain']);
    expect(await all(resolver, VAULT, onError)).toEqual(['anchor-onchain']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
