import { deriveEd25519, MemoryStore, mnemonicToSeed, Vault, WrongPasswordError } from '@clef/vault';
import { createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountStore, InternalApi, keyRef, PermissionStore, SettingsStore, type Account, type FullWalletState } from '../src';
import { A, ABANDON, FAST } from './fixture';

const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const PASSWORD = 'a long password';

async function addressFor(phrase: string, path: number[]): Promise<Address> {
  return (await createKeyPairSignerFromPrivateKeyBytes(deriveEd25519(await mnemonicToSeed(phrase), path))).address;
}

function api() {
  const local = new MemoryStore();
  const session = new MemoryStore();
  const vault = new Vault(local, session, FAST);
  const accounts = new AccountStore(local);
  const internal = new InternalApi({
    vault,
    accounts,
    permissions: new PermissionStore(local),
    settings: new SettingsStore(local),
    onLock: () => {},
    onUnlock: async () => {},
    emit: () => {},
  });
  const call = (type: string, params: Record<string, unknown> = {}) => internal.call({ type, ...params });
  return { local, session, vault, accounts, call, state: () => call('state') as Promise<FullWalletState> };
}

async function twoPhrases() {
  const ctx = api();
  await ctx.call('vault:create', { password: PASSWORD, mnemonic: ABANDON });
  await ctx.call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0, 2] });
  return ctx;
}

describe('InternalApi with several recovery phrases', () => {
  it('stores a second phrase as a mnemonic secret and adds the chosen HD accounts from it', async () => {
    const { vault, accounts, state } = await twoPhrases();
    const secrets = await vault.list();
    expect(secrets.map((s) => s.kind)).toEqual(['mnemonic', 'mnemonic']);
    const zoo0 = await addressFor(ZOO, [44, 501, 0, 0]);
    const zoo2 = await addressFor(ZOO, [44, 501, 2, 0]);
    expect((await accounts.list()).filter((a) => a.kind === 'imported')).toEqual([]);
    const s = await state();
    expect(s.phrases).toBe(2);
    expect(s.accounts).toMatchObject([
      { kind: 'hd', address: A, index: 0, phrase: 1 },
      { kind: 'hd', address: zoo0, index: 0, phrase: 2 },
      { kind: 'hd', address: zoo2, index: 2, phrase: 2 },
    ]);
    expect(JSON.stringify(s)).not.toContain(secrets[1]!.id);
  });

  it('derives the next account from the chosen phrase', async () => {
    const { call, state } = await twoPhrases();
    await call('accounts:derive', { phrase: 2 });
    await call('accounts:derive');
    const s = await state();
    expect(s.accounts.slice(3)).toMatchObject([
      { address: await addressFor(ZOO, [44, 501, 3, 0]), index: 3, phrase: 2, label: 'Account 4' },
      { address: await addressFor(ABANDON, [44, 501, 1, 0]), index: 1, phrase: 1 },
    ]);
    await expect(call('accounts:derive', { phrase: 3 })).rejects.toThrow(/No recovery phrase/);
  });

  it('imports and derives on the legacy path', async () => {
    const { call, state, accounts, vault } = await twoPhrases();
    await call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0], scheme: 'legacy' });
    await call('accounts:derive', { phrase: 2 });
    const legacy = (await accounts.list()).filter((a): a is Extract<Account, { kind: 'hd' }> => a.kind === 'hd' && a.scheme === 'legacy');
    expect(legacy.map((a) => a.index)).toEqual([0, 1]);
    expect(legacy[1]!.address).toBe(await addressFor(ZOO, [44, 501, 1]));
    expect(await vault.withPrivateKey(keyRef(legacy[1]!), async (_k, a) => a)).toBe(legacy[1]!.address);
    expect((await state()).phrases).toBe(2);
  });

  it('scans the legacy path in the background', async () => {
    const { call } = api();
    const r = (await call('accounts:scan', { mnemonic: ZOO, from: 1, count: 1, scheme: 'legacy' })) as { accounts: { index: number; address: string }[] };
    expect(r.accounts).toEqual([{ index: 1, address: await addressFor(ZOO, [44, 501, 1]) }]);
    await expect(call('accounts:scan', { mnemonic: ZOO, scheme: 'other' })).rejects.toThrow(/scheme/);
  });

  it('reveals the phrase that was asked for, only with the password', async () => {
    const { call } = await twoPhrases();
    expect(await call('vault:revealMnemonic', { password: PASSWORD, phrase: 2 })).toEqual({ mnemonic: ZOO });
    expect(await call('vault:revealMnemonic', { password: PASSWORD, phrase: 1 })).toEqual({ mnemonic: ABANDON });
    expect(await call('vault:revealMnemonic', { password: PASSWORD })).toEqual({ mnemonic: ABANDON });
    await expect(call('vault:revealMnemonic', { password: 'wrong password!', phrase: 2 })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(call('vault:revealMnemonic', { password: PASSWORD, phrase: 3 })).rejects.toThrow(/No recovery phrase/);
  });

  it('importing a phrase already in the vault adds no duplicate secret, only new accounts', async () => {
    const { call, vault, state } = await twoPhrases();
    await call('accounts:importMnemonic', { mnemonic: ` ${ABANDON.toUpperCase()} `, indexes: [0, 1] });
    await call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0] });
    expect(await vault.list()).toHaveLength(2);
    const s = await state();
    expect(s.accounts).toHaveLength(4);
    expect(s.accounts[3]).toMatchObject({ index: 1, phrase: 1 });
  });

  it('validates importMnemonic input and requires an unlocked vault', async () => {
    const { call } = await twoPhrases();
    await expect(call('accounts:importMnemonic', { mnemonic: 'not a phrase', indexes: [0] })).rejects.toThrow(/recovery phrase/);
    await expect(call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [] })).rejects.toThrow(/indexes/);
    await expect(call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0], scheme: 'x' })).rejects.toThrow(/scheme/);
    await call('vault:lock');
    await expect(call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0] })).rejects.toThrow(/locked/);
  });

  it('a vault from the old flow (one phrase, imported keys) still unlocks, numbers its phrase and signs', async () => {
    const { local, session, vault, accounts } = api();
    const [phraseId] = await vault.create(PASSWORD, [{ kind: 'mnemonic', phrase: ABANDON }]);
    const seed = await mnemonicToSeed(ZOO);
    const key = deriveEd25519(seed, [44, 501, 0]);
    const keyAddress = (await createKeyPairSignerFromPrivateKeyBytes(key)).address;
    const keyId = await vault.addSecret({ kind: 'keypair', privateKey: key });
    // stored exactly as the previous release wrote them: no scheme, no phrase metadata
    await local.set('accounts', [
      { kind: 'hd', address: A, label: 'Account 1', secretId: phraseId, index: 0 },
      { kind: 'imported', address: keyAddress, label: 'Imported 1', secretId: keyId },
    ]);
    await vault.lock();
    const reopened = new Vault(local, session, FAST);
    const internal = new InternalApi({
      vault: reopened,
      accounts,
      permissions: new PermissionStore(local),
      settings: new SettingsStore(local),
      onLock: () => {},
      onUnlock: async () => {},
      emit: () => {},
    });
    await internal.call({ type: 'vault:unlock', password: PASSWORD });
    const s = (await internal.call({ type: 'state' })) as FullWalletState;
    expect(s.phrases).toBe(1);
    expect(s.accounts).toMatchObject([{ kind: 'hd', phrase: 1 }, { kind: 'imported' }]);
    for (const a of await accounts.list()) {
      if (a.kind !== 'hd' && a.kind !== 'imported') continue;
      const sig = await reopened.withPrivateKey(keyRef(a), async (k, addr) => {
        expect(addr).toBe(a.address);
        const signer = await createKeyPairSignerFromPrivateKeyBytes(k);
        const [out] = await signer.signMessages([{ content: new Uint8Array([1, 2, 3]), signatures: {} }]);
        return out![addr];
      });
      expect(sig).toBeDefined();
      expect(getAddressEncoder().encode(a.address)).toHaveLength(32);
    }
  });

  it('onboarding by key keeps a phrase without accounts; an imported phrase becomes phrase 2', async () => {
    const { call, state } = api();
    await call('vault:create', { password: PASSWORD, mnemonic: ABANDON, indexes: [] });
    expect(await state()).toMatchObject({ phrases: 1, accounts: [] });
    expect(await call('accounts:importMnemonic', { mnemonic: ZOO, indexes: [0] })).toEqual({ phrase: 2 });
    expect((await state()).accounts).toMatchObject([{ phrase: 2, index: 0 }]);
  });

  it('omits phrase numbers while locked', async () => {
    const { call, state } = await twoPhrases();
    await call('vault:lock');
    const s = await state();
    expect(s.phrases).toBeUndefined();
    expect(s.accounts.every((a) => a.phrase === undefined)).toBe(true);
  });
});
