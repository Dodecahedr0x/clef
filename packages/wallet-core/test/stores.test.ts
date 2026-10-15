import { MemoryStore } from '@clef/vault';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountStore, chainFor, DEFAULT_SETTINGS, PermissionStore, SettingsStore } from '../src';

const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const B = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

describe('SettingsStore', () => {
  it('defaults, switches network with its default RPC, and validates', async () => {
    const s = new SettingsStore(new MemoryStore());
    expect(await s.get()).toEqual(DEFAULT_SETTINGS);
    await s.update({ network: 'devnet', autoLockMinutes: 5 });
    const devnet = await s.get();
    expect(chainFor(devnet.network)).toBe('solana:devnet');
    expect(devnet.rpcUrl).toBe('https://api.devnet.solana.com');
    await expect(s.update({ autoLockMinutes: 0 })).rejects.toThrow();
    await expect(s.update({ rpcUrl: 'javascript:alert(1)' })).rejects.toThrow(/https/);
    await expect(s.update({ rpcUrl: 'http://rpc.example.com' })).rejects.toThrow(/https/);
    await expect(s.update({ rpcUrl: 'not a url' })).rejects.toThrow();
    await expect(s.update({ network: 'testnet' as never })).rejects.toThrow();
    expect(await s.update({ rpcUrl: 'http://127.0.0.1:8899' })).toMatchObject({ rpcUrl: 'http://127.0.0.1:8899' });
    expect((await s.get()).autoLockMinutes).toBe(5);
  });
});

describe('AccountStore', () => {
  it('adds, dedupes, renames and removes; watch accounts cannot sign', async () => {
    const a = new AccountStore(new MemoryStore());
    await a.add({ kind: 'hd', address: A, label: 'Account 1', secretId: 's1', index: 0 });
    await expect(a.add({ kind: 'watch', address: A, label: 'dup' })).rejects.toThrow(/already/);
    await a.add({ kind: 'watch', address: B, label: 'Cold' });
    await a.rename(B, '  Cold storage  ');
    expect((await a.get(B))?.label).toBe('Cold storage');
    await expect(a.rename(B, '   ')).rejects.toThrow();
    expect(await a.canSign(B)).toBe(false);
    expect(await a.canSign(A)).toBe(true);
    expect(await a.canSign('11111111111111111111111111111111')).toBe(false);
    await a.remove(B);
    expect(await a.list()).toHaveLength(1);
  });

  it('computes the next HD index per secret', async () => {
    const a = new AccountStore(new MemoryStore());
    expect(await a.nextHdIndex('s1')).toBe(0);
    await a.add({ kind: 'hd', address: A, label: 'Account 1', secretId: 's1', index: 0 });
    await a.add({ kind: 'hd', address: B, label: 'Account 3', secretId: 's1', index: 2 });
    expect(await a.nextHdIndex('s1')).toBe(3);
    expect(await a.nextHdIndex('s2')).toBe(0);
  });
});

describe('PermissionStore', () => {
  it('is per origin and revocable', async () => {
    const p = new PermissionStore(new MemoryStore(), () => 42);
    await p.grant('https://dapp.example', [A]);
    expect(await p.get('https://dapp.example')).toEqual({ origin: 'https://dapp.example', accounts: [A], connectedAt: 42 });
    expect(await p.allowed('https://dapp.example', A)).toBe(true);
    expect(await p.allowed('https://dapp.example', B)).toBe(false);
    expect(await p.allowed('https://evil.example', A)).toBe(false);
    expect(await p.get('__proto__')).toBeNull();
    await p.revoke('https://dapp.example');
    expect(await p.get('https://dapp.example')).toBeNull();
  });

  it('removes an account from every origin', async () => {
    const p = new PermissionStore(new MemoryStore());
    await p.grant('https://a.example', [A, B]);
    await p.grant('https://b.example', [A]);
    await p.removeAccount(A);
    expect(await p.get('https://a.example')).toMatchObject({ accounts: [B] });
    expect(await p.get('https://b.example')).toBeNull();
  });
});
