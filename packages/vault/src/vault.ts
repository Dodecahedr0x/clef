import { createKeyPairSignerFromPrivateKeyBytes, type Address } from '@solana/kit';
import { fromBase64, toBase64, utf8, zeroize } from './bytes';
import { deriveKey, newKdfParams, openEnvelope, sealEnvelope, type Envelope, type KdfCost, type KdfParams } from './crypto';
import { deriveEd25519, solanaPath } from './hd';
import { mnemonicToSeed, normalizeMnemonic, validateMnemonic } from './mnemonic';
import type { KeyValueStore } from './store';

export type NewSecret = { kind: 'mnemonic'; phrase: string } | { kind: 'keypair'; privateKey: Uint8Array };
export type Secret = { id: string; kind: 'mnemonic'; phrase: string } | { id: string; kind: 'keypair'; privateKey: string /* base64, 32 bytes */ };
export type KeyRef = { secretId: string; index?: number };

export class LockedError extends Error {
  constructor() {
    super('Wallet is locked');
    this.name = 'LockedError';
  }
}

const VAULT = 'vault';
const SESSION = 'session-key';
const MIN_PASSWORD = 8;

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
}

/**
 * Encrypted list of secrets. `local` holds only the envelope; `session` holds the derived key while
 * unlocked (in the extension: chrome.storage.session, so a service-worker restart keeps the wallet unlocked).
 */
export class Vault {
  constructor(
    private readonly local: KeyValueStore,
    private readonly session: KeyValueStore,
    /** Tests pass a cheap cost; production uses the strong defaults. */
    private readonly cost?: KdfCost,
  ) {}

  async exists(): Promise<boolean> {
    return (await this.local.get<Envelope>(VAULT)) !== undefined;
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.session.get<string>(SESSION)) !== undefined;
  }

  async create(password: string, secrets: NewSecret[]): Promise<string[]> {
    assertPassword(password);
    if (await this.exists()) throw new Error('A vault already exists');
    const stored = secrets.map(toStored);
    const kdf = newKdfParams(this.cost);
    const key = await deriveKey(password, kdf);
    try {
      await this.write(key, kdf, stored);
      await this.session.set(SESSION, toBase64(key));
    } finally {
      zeroize(key);
    }
    return stored.map((s) => s.id);
  }

  async unlock(password: string): Promise<void> {
    const env = await this.envelope();
    const key = await deriveKey(password, env.kdf);
    try {
      zeroize(await openEnvelope(key, env)); // throws WrongPasswordError
      await this.session.set(SESSION, toBase64(key));
    } finally {
      zeroize(key);
    }
  }

  async lock(): Promise<void> {
    await this.session.remove(SESSION);
  }

  async secrets(): Promise<Secret[]> {
    const { key, env } = await this.open();
    try {
      return await this.read(key, env);
    } finally {
      zeroize(key);
    }
  }

  async addSecret(secret: NewSecret): Promise<string> {
    const stored = toStored(secret);
    const { key, env } = await this.open();
    try {
      await this.write(key, env.kdf, [...(await this.read(key, env)), stored]);
    } finally {
      zeroize(key);
    }
    return stored.id;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    assertPassword(newPassword);
    const env = await this.envelope();
    const oldKey = await deriveKey(oldPassword, env.kdf);
    let pt: Uint8Array;
    try {
      pt = await openEnvelope(oldKey, env);
    } finally {
      zeroize(oldKey);
    }
    const kdf = newKdfParams(this.cost);
    const key = await deriveKey(newPassword, kdf);
    try {
      await this.local.set(VAULT, await sealEnvelope(key, kdf, pt));
      await this.session.set(SESSION, toBase64(key));
    } finally {
      zeroize(key, pt);
    }
  }

  /** Runs `fn` with the 32-byte private key and its address; the key is zeroed afterwards whatever happens. */
  async withPrivateKey<T>(ref: KeyRef, fn: (privateKey: Uint8Array, address: Address) => Promise<T>): Promise<T> {
    const secret = (await this.secrets()).find((s) => s.id === ref.secretId);
    if (!secret) throw new Error('Unknown secret');
    let privateKey: Uint8Array;
    if (secret.kind === 'mnemonic') {
      const seed = await mnemonicToSeed(secret.phrase);
      try {
        privateKey = deriveEd25519(seed, solanaPath(ref.index ?? 0));
      } finally {
        zeroize(seed);
      }
    } else {
      privateKey = fromBase64(secret.privateKey);
    }
    try {
      const { address } = await createKeyPairSignerFromPrivateKeyBytes(privateKey);
      return await fn(privateKey, address);
    } finally {
      zeroize(privateKey);
    }
  }

  private async envelope(): Promise<Envelope> {
    const env = await this.local.get<Envelope>(VAULT);
    if (!env) throw new Error('No vault');
    return env;
  }

  private async open(): Promise<{ key: Uint8Array; env: Envelope }> {
    const b64 = await this.session.get<string>(SESSION);
    if (!b64) throw new LockedError();
    return { key: fromBase64(b64), env: await this.envelope() };
  }

  private async read(key: Uint8Array, env: Envelope): Promise<Secret[]> {
    const pt = await openEnvelope(key, env);
    try {
      return JSON.parse(new TextDecoder().decode(pt)) as Secret[];
    } finally {
      zeroize(pt);
    }
  }

  private async write(key: Uint8Array, kdf: KdfParams, secrets: Secret[]): Promise<void> {
    const pt = utf8(JSON.stringify(secrets));
    try {
      await this.local.set(VAULT, await sealEnvelope(key, kdf, pt));
    } finally {
      zeroize(pt);
    }
  }
}

function toStored(s: NewSecret): Secret {
  const id = crypto.randomUUID();
  if (s.kind === 'mnemonic') {
    if (!validateMnemonic(s.phrase)) throw new Error('Invalid recovery phrase');
    return { id, kind: 'mnemonic', phrase: normalizeMnemonic(s.phrase) };
  }
  if (s.privateKey.length !== 32) throw new Error('Expected a 32-byte private key');
  return { id, kind: 'keypair', privateKey: toBase64(s.privateKey) };
}
