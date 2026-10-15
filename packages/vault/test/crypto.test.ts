import { describe, expect, it } from 'vitest';
import { deriveKey, newKdfParams, openEnvelope, sealEnvelope, utf8, WrongPasswordError } from '../src';

const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 }; // tests only

describe('envelope', () => {
  it('seals and opens with the right key', async () => {
    const kdf = newKdfParams(FAST);
    const key = await deriveKey('correct horse battery', kdf);
    const env = await sealEnvelope(key, kdf, utf8('secret'));
    expect(new TextDecoder().decode(await openEnvelope(key, env))).toBe('secret');
    expect(env.v).toBe(1);
  });

  it('fails with a wrong password', async () => {
    const kdf = newKdfParams(FAST);
    const env = await sealEnvelope(await deriveKey('right password', kdf), kdf, utf8('x'));
    await expect(openEnvelope(await deriveKey('wrong password', kdf), env)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('binds the KDF parameters (tampering is detected)', async () => {
    const kdf = newKdfParams(FAST);
    const key = await deriveKey('pw-pw-pw-pw', kdf);
    const env = await sealEnvelope(key, kdf, utf8('x'));
    const tampered = { ...env, kdf: { ...env.kdf, iterations: 2 } };
    await expect(openEnvelope(key, tampered)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('uses strong defaults and fresh salts', () => {
    const a = newKdfParams();
    expect(a).toMatchObject({ name: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 });
    expect(newKdfParams().salt).not.toBe(a.salt);
  });

  it('normalizes the password (NFKC)', async () => {
    const kdf = newKdfParams(FAST);
    const composed = await deriveKey('caf\u00e9-password', kdf);
    const decomposed = await deriveKey('cafe\u0301-password', kdf);
    expect(composed).toEqual(decomposed);
  });
});
