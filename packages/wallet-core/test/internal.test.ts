import { MemoryStore, Vault, WrongPasswordError } from '@clef/vault';
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { AccountStore, InternalApi, PermissionStore, SettingsStore, type WalletState } from '../src';
import { A, ABANDON, FAST } from './fixture';

const OTHER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

function api() {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore(), FAST);
  const permissions = new PermissionStore(local);
  const onLock = vi.fn();
  const onUnlock = vi.fn(async () => {});
  const emitted: { origin: string; accounts: string[] }[] = [];
  const internal = new InternalApi({
    vault,
    accounts: new AccountStore(local),
    permissions,
    settings: new SettingsStore(local),
    onLock,
    onUnlock,
    emit: (origin, accounts) => emitted.push({ origin, accounts }),
  });
  return { internal, vault, permissions, onLock, onUnlock, emitted, state: () => internal.call({ type: 'state' }) as Promise<WalletState> };
}

async function onboarded() {
  const ctx = api();
  await ctx.internal.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON });
  return ctx;
}

describe('InternalApi', () => {
  it('onboards from a mnemonic and derives the first account', async () => {
    const { internal, state, onUnlock } = api();
    expect(await state()).toMatchObject({ hasVault: false, unlocked: false, accounts: [] });
    await internal.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON });
    expect(await state()).toMatchObject({ hasVault: true, unlocked: true, accounts: [{ address: A, kind: 'hd', label: 'Account 1', index: 0 }] });
    expect(onUnlock).toHaveBeenCalledOnce();
    await expect(internal.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON })).rejects.toThrow(/already exists/);
  });

  it('locks and unlocks', async () => {
    const { internal, state, onLock, onUnlock } = await onboarded();
    await internal.call({ type: 'vault:lock' });
    expect(onLock).toHaveBeenCalledOnce();
    expect(await state()).toMatchObject({ unlocked: false });
    await expect(internal.call({ type: 'vault:unlock', password: 'wrong password!' })).rejects.toBeInstanceOf(WrongPasswordError);
    await internal.call({ type: 'vault:unlock', password: 'a long password' });
    expect(onUnlock).toHaveBeenCalledTimes(2);
    expect(await state()).toMatchObject({ unlocked: true });
  });

  it('derives more accounts, imports a key and adds a watch address', async () => {
    const { internal, state } = await onboarded();
    await internal.call({ type: 'accounts:derive' });
    const seed = new Uint8Array(32).fill(7);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    await internal.call({ type: 'accounts:import', secretKey: getBase58Decoder().decode(new Uint8Array([...seed, ...pub])) });
    await internal.call({ type: 'accounts:watch', address: OTHER, label: 'Cold' });
    const { accounts } = await state();
    expect(accounts.map((a) => [a.kind, a.label])).toEqual([
      ['hd', 'Account 1'],
      ['hd', 'Account 2'],
      ['imported', 'Imported 1'],
      ['watch', 'Cold'],
    ]);
    expect(accounts[2]!.address).toBe(signer.address);
    await expect(internal.call({ type: 'accounts:watch', address: 'nope', label: 'x' })).rejects.toThrow();
    await expect(internal.call({ type: 'accounts:watch', address: A, label: 'dup' })).rejects.toThrow(/already/);
  });

  it('renames and removes accounts; removal also drops their site permissions', async () => {
    const { internal, state, permissions } = await onboarded();
    await internal.call({ type: 'accounts:rename', address: A, label: 'Main' });
    expect((await state()).accounts[0]!.label).toBe('Main');
    await permissions.grant('https://dapp.example', [A]);
    await internal.call({ type: 'accounts:remove', address: A });
    expect((await state()).accounts).toEqual([]);
    expect(await permissions.get('https://dapp.example')).toBeNull();
  });

  it('revokes sites and updates settings', async () => {
    const { internal, state, permissions } = await onboarded();
    await permissions.grant('https://dapp.example', [A]);
    expect((await state()).permissions).toHaveLength(1);
    await internal.call({ type: 'permissions:revoke', origin: 'https://dapp.example' });
    expect((await state()).permissions).toEqual([]);
    await internal.call({ type: 'settings:update', patch: { network: 'devnet' } });
    expect((await state()).settings.network).toBe('devnet');
    await expect(internal.call({ type: 'settings:update', patch: { evil: true } })).rejects.toThrow();
  });

  it('tells connected pages when their access is revoked or an account is removed', async () => {
    const { internal, permissions, emitted } = await onboarded();
    await internal.call({ type: 'accounts:watch', address: OTHER, label: 'Cold' });
    await permissions.grant('https://a.example', [A, OTHER as never]);
    await permissions.grant('https://b.example', [A]);
    await internal.call({ type: 'accounts:remove', address: A });
    expect(emitted).toEqual([
      { origin: 'https://a.example', accounts: [OTHER] },
      { origin: 'https://b.example', accounts: [] },
    ]);
    await internal.call({ type: 'permissions:revoke', origin: 'https://a.example' });
    expect(emitted.at(-1)).toEqual({ origin: 'https://a.example', accounts: [] });
  });

  it('never returns secrets in state', async () => {
    const { state } = await onboarded();
    const text = JSON.stringify(await state());
    expect(text).not.toContain('abandon');
    expect(text).not.toContain('secretId');
  });

  it('requires an unlocked vault for account changes', async () => {
    const { internal } = await onboarded();
    await internal.call({ type: 'vault:lock' });
    await expect(internal.call({ type: 'accounts:derive' })).rejects.toThrow(/locked/);
  });

  it('rejects unknown and malformed calls without echoing inputs', async () => {
    const { internal } = api();
    await expect(internal.call({ type: 'vault:export' })).rejects.toThrow(/Unknown call/);
    await expect(internal.call({ type: 'vault:unlock' })).rejects.toThrow();
    await expect(internal.call('state')).rejects.toThrow();
    const err = await internal.call({ type: 'vault:create', password: 'a long password', mnemonic: 'my secret words' }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('secret words');
  });
});
