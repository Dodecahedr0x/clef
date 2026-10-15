import { argon2id } from 'hash-wasm';
import { asBytes, fromBase64, toBase64, utf8, type Bytes } from './bytes';

export type KdfParams = { name: 'argon2id'; salt: string; memoryKiB: number; iterations: number; parallelism: number };
export type KdfCost = Omit<KdfParams, 'name' | 'salt'>;
export type Envelope = { v: 1; kdf: KdfParams; iv: string; ct: string };

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
    this.name = 'WrongPasswordError';
  }
}

const DEFAULT_COST: KdfCost = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

export function newKdfParams(cost: KdfCost = DEFAULT_COST): KdfParams {
  return { name: 'argon2id', salt: toBase64(crypto.getRandomValues(new Uint8Array(16))), ...cost };
}

/** 32-byte key from a password. NFKC-normalised so the same password typed on different keyboards matches. */
export async function deriveKey(password: string, kdf: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: password.normalize('NFKC'),
    salt: fromBase64(kdf.salt),
    memorySize: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
}

/** The KDF parameters are authenticated as AES-GCM additional data, so they cannot be downgraded. */
function aad(kdf: KdfParams): Bytes {
  return utf8(`clef-vault-v1|${kdf.name}|${kdf.salt}|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}`);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealEnvelope(key: Uint8Array, kdf: KdfParams, plaintext: Uint8Array): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(kdf) }, await aesKey(key), asBytes(plaintext));
  return { v: 1, kdf, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function openEnvelope(key: Uint8Array, env: Envelope): Promise<Uint8Array> {
  if (env.v !== 1 || env.kdf.name !== 'argon2id') throw new Error('Unsupported vault format');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: aad(env.kdf) },
      await aesKey(key),
      fromBase64(env.ct),
    );
    return new Uint8Array(pt);
  } catch {
    throw new WrongPasswordError();
  }
}
