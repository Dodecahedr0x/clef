import { MemoryChainReader } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultResolver, IdlDecodeError, IdlResolver, UserIdlSource, type IdlSource, type ResolvedIdl } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

async function all(resolver: IdlResolver, id: Address, onError?: (e: unknown) => void) {
  const out = [];
  for await (const idl of resolver.candidates(id, onError)) out.push(idl.source);
  return out;
}

async function vaultIdl(source: ResolvedIdl['source']): Promise<ResolvedIdl> {
  const user = new UserIdlSource();
  user.set(VAULT, JSON.stringify(vault));
  return { ...(await user.load(VAULT))!, source };
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

  it('shares one load between concurrent candidates() calls', async () => {
    const idl = await vaultIdl('anchor-onchain');
    const load = vi.fn(() => new Promise<ResolvedIdl>((r) => setTimeout(() => r(idl), 5)));
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    expect(await Promise.all([all(resolver, VAULT), all(resolver, VAULT)])).toEqual([['anchor-onchain'], ['anchor-onchain']]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not start later sources after an early break', async () => {
    const later = vi.fn().mockResolvedValue(null);
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const resolver = new IdlResolver([user, { kind: 'anchor-onchain', load: later }]);
    for await (const idl of resolver.candidates(VAULT)) {
      expect(idl.source).toBe('user');
      break;
    }
    expect(later).not.toHaveBeenCalled();
  });

  it('retries a source whose load failed transiently', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('rpc down')).mockResolvedValue(await vaultIdl('anchor-onchain'));
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    const onError = vi.fn();
    expect(await all(resolver, VAULT, onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ source: 'anchor-onchain', message: 'rpc down' }));
    expect(await all(resolver, VAULT, onError)).toEqual(['anchor-onchain']);
    expect(await all(resolver, VAULT, onError)).toEqual(['anchor-onchain']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('caches decode errors and re-reports them without reloading', async () => {
    const load = vi.fn().mockRejectedValue(new IdlDecodeError('bad idl'));
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    const onError = vi.fn();
    await all(resolver, VAULT, onError);
    await all(resolver, VAULT, onError);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith({ source: 'anchor-onchain', programId: VAULT, message: 'bad idl' });
  });

  it('times out slow loads as a transient error', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(() => new Promise<null>(() => {}));
      const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }], { loadTimeoutMs: 50 });
      const onError = vi.fn();
      const first = all(resolver, VAULT, onError);
      await vi.advanceTimersByTimeAsync(50);
      expect(await first).toEqual([]);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('timed out') }));
      const second = all(resolver, VAULT, onError);
      await vi.advanceTimersByTimeAsync(50);
      await second;
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes and truncates error messages', async () => {
    const load = vi.fn().mockRejectedValue(new Error(`a\u0000b\u001b[31mc\n${'x'.repeat(500)}`));
    const onError = vi.fn();
    await all(new IdlResolver([{ kind: 'anchor-onchain', load }]), VAULT, onError);
    const { message } = onError.mock.calls[0]![0] as { message: string };
    expect(message.startsWith('ab[31mc')).toBe(true);
    expect(message).toHaveLength(200);
  });

  it('strips bidi overrides and invisible characters from error messages, like sanitizeText', async () => {
    const load = vi.fn().mockRejectedValue(new Error('evil\u202egnp.exe \u200bzero\u2066iso\u2069 \u2028line'));
    const onError = vi.fn();
    await all(new IdlResolver([{ kind: 'anchor-onchain', load }]), VAULT, onError);
    expect((onError.mock.calls[0]![0] as { message: string }).message).toBe('evilgnp.exe zeroiso line');
  });
});
