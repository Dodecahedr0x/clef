import { describe, expect, it } from 'vitest';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { deriveEd25519, LockedError, MemoryStore, mnemonicToSeed, Vault, WrongPasswordError } from '../src';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 };
const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

function setup() {
  const local = new MemoryStore();
  const session = new MemoryStore();
  return { local, session, vault: new Vault(local, session, FAST) };
}

describe('Vault', () => {
  it('creates, locks and unlocks', async () => {
    const { vault } = setup();
    expect(await vault.exists()).toBe(false);
    const ids = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    expect(await vault.exists()).toBe(true);
    expect(await vault.isUnlocked()).toBe(true);
    await vault.lock();
    expect(await vault.isUnlocked()).toBe(false);
    await expect(vault.secrets()).rejects.toBeInstanceOf(LockedError);
    await vault.unlock('a long password');
    expect((await vault.secrets())[0]).toMatchObject({ id: ids[0], kind: 'mnemonic' });
  });

  it('rejects short passwords, a second create, invalid phrases and wrong passwords', async () => {
    const { vault } = setup();
    await expect(vault.create('short', [])).rejects.toThrow(/at least 8/);
    await expect(vault.create('a long password', [{ kind: 'mnemonic', phrase: 'abandon abandon abandon' }])).rejects.toThrow(/recovery phrase/);
    expect(await vault.exists()).toBe(false);
    await vault.create('a long password', []);
    await expect(vault.create('a long password', [])).rejects.toThrow(/already exists/);
    await vault.lock();
    await expect(vault.unlock('nope nope nope')).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await vault.isUnlocked()).toBe(false);
  });

  it('survives a service-worker restart via the session store', async () => {
    const { local, session, vault } = setup();
    await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    const restarted = new Vault(local, session, FAST);
    expect(await restarted.isUnlocked()).toBe(true);
    expect(await restarted.secrets()).toHaveLength(1);
  });

  it('derives HD keys and zeroes them after use, even when the callback throws', async () => {
    const { vault } = setup();
    const [id] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    let seen: Uint8Array | undefined;
    const address = await vault.withPrivateKey({ secretId: id!, index: 0 }, async (key, addr) => {
      seen = key;
      return addr;
    });
    expect(address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
    expect([...seen!].every((b) => b === 0)).toBe(true);

    let thrown: Uint8Array | undefined;
    await expect(
      vault.withPrivateKey({ secretId: id!, index: 1 }, async (key) => {
        thrown = key;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect([...thrown!].every((b) => b === 0)).toBe(true);
  });

  it('stores imported keypairs and returns their key', async () => {
    const { vault } = setup();
    await vault.create('a long password', []);
    const id = await vault.addSecret({ kind: 'keypair', privateKey: new Uint8Array(32).fill(7) });
    const out = await vault.withPrivateKey({ secretId: id }, async (key) => [...key]);
    expect(out).toEqual(new Array(32).fill(7));
  });

  it('adds secrets and changes the password', async () => {
    const { vault } = setup();
    await vault.create('a long password', []);
    await vault.addSecret({ kind: 'mnemonic', phrase: ABANDON });
    await expect(vault.changePassword('wrong password', 'another long password')).rejects.toBeInstanceOf(WrongPasswordError);
    await vault.changePassword('a long password', 'another long password');
    await vault.lock();
    await expect(vault.unlock('a long password')).rejects.toBeInstanceOf(WrongPasswordError);
    await vault.unlock('another long password');
    expect(await vault.secrets()).toHaveLength(1);
  });

  it('keeps one secret per recovery phrase and lists secrets without their material', async () => {
    const { vault } = setup();
    const [first] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    const second = await vault.addSecret({ kind: 'mnemonic', phrase: ZOO });
    expect(second).not.toBe(first);
    expect(await vault.addSecret({ kind: 'mnemonic', phrase: `  ${ABANDON.toUpperCase()} ` })).toBe(first);
    expect(await vault.addSecret({ kind: 'mnemonic', phrase: ZOO })).toBe(second);
    expect(await vault.secrets()).toHaveLength(2);
    const list = await vault.list();
    expect(list).toEqual([{ id: first, kind: 'mnemonic' }, { id: second, kind: 'mnemonic' }]);
    expect(JSON.stringify(list)).not.toMatch(/abandon|zoo/);
  });

  it("derives the legacy path m/44'/501'/index' when asked", async () => {
    const { vault } = setup();
    const [id] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    const seed = await mnemonicToSeed(ABANDON);
    const expected = (await createKeyPairSignerFromPrivateKeyBytes(deriveEd25519(seed, [44, 501, 1]))).address;
    expect(await vault.withPrivateKey({ secretId: id!, index: 1, scheme: 'legacy' }, async (_k, a) => a)).toBe(expected);
    expect(await vault.withPrivateKey({ secretId: id!, index: 1 }, async (_k, a) => a)).not.toBe(expected);
  });

  it('never persists plaintext', async () => {
    const { local, session, vault } = setup();
    await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    await vault.addSecret({ kind: 'keypair', privateKey: new Uint8Array(32).fill(7) });
    expect(JSON.stringify(await local.get('vault'))).not.toMatch(/abandon|BwcHBwcH/);
    expect(JSON.stringify(await session.get('session-key'))).not.toMatch(/abandon/);
  });
});
