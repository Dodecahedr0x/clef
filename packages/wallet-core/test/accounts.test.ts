import { MemoryStore } from '@clef/vault';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountStore } from '../src/accounts';

const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const L = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const K = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const W = address('So11111111111111111111111111111111111111112');
const V = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const M = address('SysvarRent111111111111111111111111111111111');

describe('AccountStore v2 kinds', () => {
  it('stores ledger, keystone and squads accounts; canSign follows the signer', async () => {
    const a = new AccountStore(new MemoryStore());
    await a.add({ kind: 'hd', address: A, label: 'Main', secretId: 's', index: 0 });
    await a.add({ kind: 'ledger', address: L, label: 'Ledger 1', path: "44'/501'/0'/0'" });
    await a.add({ kind: 'keystone', address: K, label: 'Keystone 1', path: "m/44'/501'/0'/0'", xfp: 'f23f9fd2' });
    await a.add({ kind: 'watch', address: W, label: 'Watch' });
    await a.add({ kind: 'squads', address: V, label: 'Team vault', multisig: M, vaultIndex: 0, member: L });
    for (const x of [A, L, K, V]) expect(await a.canSign(x)).toBe(true);
    expect(await a.canSign(W)).toBe(false);
    await a.remove(L);
    expect(await a.canSign(V)).toBe(false);
  });

  it('a squads account whose member is a watch account or another vault cannot sign', async () => {
    const a = new AccountStore(new MemoryStore());
    await a.add({ kind: 'watch', address: W, label: 'Watch' });
    await a.add({ kind: 'squads', address: V, label: 'v1', multisig: M, vaultIndex: 0, member: W });
    await a.add({ kind: 'squads', address: A, label: 'v2', multisig: M, vaultIndex: 1, member: V });
    expect(await a.canSign(V)).toBe(false);
    expect(await a.canSign(A)).toBe(false);
  });

  it('tracks the active account, falling back to the first', async () => {
    const a = new AccountStore(new MemoryStore());
    expect(await a.active()).toBeNull();
    await a.add({ kind: 'hd', address: A, label: 'Main', secretId: 's', index: 0 });
    await a.add({ kind: 'watch', address: W, label: 'Watch' });
    expect(await a.active()).toBe(A);
    await a.select(W);
    expect(await a.active()).toBe(W);
    await expect(a.select(L)).rejects.toThrow(/Unknown account/);
    await a.remove(W);
    expect(await a.active()).toBe(A);
  });
});
