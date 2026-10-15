import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { deriveEd25519, mnemonicToSeed, solanaPath } from '../src';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('SLIP-0010 ed25519', () => {
  it('matches test vector 1', () => {
    const seed = hex('000102030405060708090a0b0c0d0e0f');
    expect(toHex(deriveEd25519(seed, []))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
    expect(toHex(deriveEd25519(seed, [0]))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  });

  it("derives the standard Solana account m/44'/501'/0'/0'", async () => {
    const seed = await mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const key = deriveEd25519(seed, solanaPath(0));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(key);
    expect(signer.address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  });

  it('derives different accounts for different indexes', async () => {
    const seed = await mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    expect(toHex(deriveEd25519(seed, solanaPath(1)))).not.toBe(toHex(deriveEd25519(seed, solanaPath(0))));
  });

  it('rejects out-of-range indexes', () => {
    expect(() => solanaPath(-1)).toThrow();
    expect(() => solanaPath(2 ** 31)).toThrow();
    expect(() => deriveEd25519(new Uint8Array(16), [1.5])).toThrow();
  });
});
