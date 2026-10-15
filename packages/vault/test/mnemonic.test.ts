import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateMnemonic, InvalidSecretError, normalizeMnemonic, parseSecretKey, validateMnemonic } from '../src';

describe('mnemonics', () => {
  it('generates valid 12 and 24 word phrases', () => {
    expect(generateMnemonic(12).split(' ')).toHaveLength(12);
    const long = generateMnemonic(24);
    expect(long.split(' ')).toHaveLength(24);
    expect(validateMnemonic(long)).toBe(true);
  });

  it('normalizes whitespace and case before validating', () => {
    const m = '  Abandon abandon ABANDON abandon abandon abandon abandon abandon abandon abandon abandon   about ';
    expect(normalizeMnemonic(m)).toBe('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    expect(validateMnemonic(m)).toBe(true);
    expect(validateMnemonic('abandon abandon abandon')).toBe(false);
    expect(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false);
  });
});

describe('imported secret keys', () => {
  const seed = new Uint8Array(32).fill(7);
  let address: string;
  let full: Uint8Array;

  beforeAll(async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    address = signer.address;
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    full = new Uint8Array([...seed, ...pub]);
  });

  it('accepts base58 and JSON-array forms and returns the 32-byte seed + address', async () => {
    for (const input of [getBase58Decoder().decode(full), JSON.stringify([...full]), `  ${JSON.stringify([...full])}\n`]) {
      const parsed = await parseSecretKey(input);
      expect(parsed.address).toBe(address);
      expect(parsed.privateKey).toEqual(seed);
    }
  });

  it('rejects a secret whose public half does not match', async () => {
    const bad = new Uint8Array(full);
    bad[63] = bad[63]! ^ 1;
    await expect(parseSecretKey(JSON.stringify([...bad]))).rejects.toBeInstanceOf(InvalidSecretError);
  });

  it('rejects wrong lengths and malformed arrays', async () => {
    await expect(parseSecretKey(JSON.stringify([...full.slice(0, 32)]))).rejects.toBeInstanceOf(InvalidSecretError);
    await expect(parseSecretKey('[1,2,300]')).rejects.toBeInstanceOf(InvalidSecretError);
    await expect(parseSecretKey('[1,2,')).rejects.toBeInstanceOf(InvalidSecretError);
  });

  it('rejects garbage without echoing it', async () => {
    const err = await parseSecretKey('not a key at all').catch((e: Error) => e);
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).not.toContain('not a key');
  });
});
