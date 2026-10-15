# Milestone 2 — Vault, Software Signing & Wallet Standard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** A loadable Chromium MV3 extension that creates/imports a BIP39 wallet (and raw keypairs / watch-only addresses), stores secrets in an Argon2id + AES-GCM vault, registers "Clef" through Wallet Standard, and lets dApps `connect`, `signTransaction`, `signAndSendTransaction`, `signMessage` and `signIn` — every request approved in a separate window that shows the M1 explanation (Basic view + warnings, danger acknowledgement).

**Architecture:** Three new pure-TS packages hold all logic and are unit-tested in Node: `@clef/vault` (KDF, envelope encryption, BIP39, SLIP-0010, the `Vault`), `@clef/signers` (software signing of wire transactions and messages), `@clef/wallet-core` (accounts, permissions, settings, the dApp protocol, message inspection, auto-lock, `WalletService` and the internal popup API). `apps/extension` (WXT + React + Tailwind) is thin glue: chrome adapters, entrypoints (background, MAIN-world inpage wallet, ISOLATED relay, popup, approval page). End-to-end behaviour is verified with Playwright against the built extension.

**Tech Stack:** WXT 0.21 (MV3), React 19, Tailwind 4 (`@tailwindcss/vite`), `@wallet-standard/wallet` / `base` / `features`, `@solana/wallet-standard-features`, `@solana/wallet-standard-util` (SIWS), `@scure/bip39`, `@noble/hashes` (HMAC-SHA512 for SLIP-0010), `hash-wasm` (Argon2id), `@solana/kit` 8.5 (Ed25519 via WebCrypto, tx codecs), Vitest, Playwright.

**Design doc:** `docs/plans/2026-10-15-clef-wallet-design.md` (sections 1, 3, 4). M1 plan: `docs/plans/2026-10-15-m1-explain-engine.md`.

---

## Facts verified before writing this plan (2026-10-15)

Checked against installed packages and runnable prototypes — trust these over memory:

- **SLIP-0010 ed25519** with `hmac(sha512, …)` from `@noble/hashes/hmac.js` / `@noble/hashes/sha2.js` reproduces test vector 1 (seed `000102…0f`): master key `2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7`, `m/0'` key `68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3`.
- Mnemonic `abandon ×11 about`, empty passphrase, path `m/44'/501'/0'/0'` → address **`HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk`** (the Phantom/Solflare default account).
- `@scure/bip39` 2.x: `generateMnemonic(wordlist, 128|256)`, `validateMnemonic(m, wordlist)`, `mnemonicToSeedSync` / `mnemonicToSeed(m, passphrase)`; wordlist import path **`@scure/bip39/wordlists/english.js`** (the `.js` suffix is required).
- `hash-wasm` `argon2id({ password, salt, parallelism, iterations, memorySize, hashLength, outputType: 'binary' })` → `Uint8Array`; 64 MiB / t=3 / p=1 ≈ 100 ms in Node 25. In an MV3 extension, WASM needs `'wasm-unsafe-eval'` in the `extension_pages` CSP.
- Kit 8.5: `createKeyPairFromPrivateKeyBytes(bytes32, extractable?)`, `createKeyPairSignerFromPrivateKeyBytes`, `signBytes(privateKey, data)`, `verifySignature(publicKey, sig, data)`, `getAddressFromPublicKey(publicKey)`; `getTransactionDecoder/Encoder` handle legacy, v0 and v1 (v1 is message-first).
- Wallet Standard: `registerWallet(wallet)` is exported from **`@wallet-standard/wallet`** (with `ReadonlyWalletAccount`); `Wallet` = `{ version: '1.0.0', name, icon, chains, features, accounts }`. Features from `@wallet-standard/features`: `standard:connect`, `standard:disconnect`, `standard:events`. From `@solana/wallet-standard-features`: `solana:signTransaction` (`supportedTransactionVersions: ('legacy'|0|1)[]`, input `{ account, transaction: Uint8Array, chain?, options? }` → `{ signedTransaction }`), `solana:signAndSendTransaction` (`chain` required → `{ signature: Uint8Array }`), `solana:signMessage` (`{ account, message }` → `{ signedMessage, signature, signatureType? }`), `solana:signIn` (input fields `domain, address, statement, uri, version, chainId, nonce, issuedAt, expirationTime, notBefore, requestId, resources` → `{ account, signedMessage, signature }`).
- `@solana/wallet-standard-util`: `createSignInMessage(inputWithRequiredFields)`, `parseSignInMessage(bytes)`, `verifySignIn(input, output)`, `verifySignMessage`.
- WXT 0.21: `defineBackground`, `defineContentScript({ matches, runAt, world: 'MAIN' | 'ISOLATED', main })`, `defineUnlistedScript`; imports from `wxt/utils/define-background`, `wxt/utils/define-content-script`, `wxt/browser`; HTML entrypoints `entrypoints/<name>/index.html` → `/<name>.html`; `entrypoints/popup/` is the action popup. Testing: `wxt/testing/fake-browser` (`fakeBrowser`) and `wxt/testing/vitest-plugin` (`WxtVitest`).

If any call does not typecheck exactly as written, read the package `.d.ts` and adapt the call — do not change the design.

## Conventions (same as M1)

- Commands run from the worktree root `/Users/dode/Documents/solana/clef/.worktrees/m2-vault-signing`.
- One test file: `pnpm vitest run <path>`. All: `pnpm test`. Types: `pnpm typecheck`.
- Packages export TS source (`"exports": { ".": "./src/index.ts" }`).
- **ASCII-only source.** Non-ASCII in strings uses `\u` escapes; verify with `LC_ALL=C grep -rn '[^ -~\t]' <dirs>` (tool writes have been observed converting escapes into literal characters — check the bytes).
- Test first; one commit per task with the given message; no attribution lines.
- Secrets: never log them, never put them in error messages, zero `Uint8Array` key material after use (`bytes.fill(0)`), never persist anything but the encrypted envelope (local) and the derived session key (session storage).

## Security invariants for this milestone (reviewers check these)

1. The page/dApp never sees secrets, the session key, or the vault; it only receives public keys, signatures and signed transactions.
2. The origin of every dApp request is taken from `port.sender.origin` in the background — never from message content.
3. Internal (popup/approval) API calls are accepted only from extension pages (`sender.url` starts with the extension's own URL and `sender.id === runtime.id`) — content scripts share `sender.id`, so the URL check is mandatory.
4. Nothing is signed without an explicit approval in an extension-owned window. `danger` warnings require a ticked acknowledgement before Approve is enabled.
5. A request can only use accounts the origin was granted in `connect`; the chain must match the active network.
6. The session key lives only in `chrome.storage.session` (in-memory, trusted contexts); auto-lock and manual lock remove it.
7. Watch-only accounts never sign.

---

### Task 1: Scaffold packages and the extension app

**Files:**
- Create: `packages/vault/package.json`, `packages/signers/package.json`, `packages/wallet-core/package.json` (+ `src/index.ts` each with `export {};`)
- Create: `apps/extension/package.json`, `apps/extension/wxt.config.ts`, `apps/extension/tsconfig.json`, `apps/extension/entrypoints/background.ts`
- Modify: root `tsconfig.json` (exclude the extension), root `package.json` scripts

**Step 1: Package manifests** — same shape as M1 (`"type": "module"`, `"exports": { ".": "./src/index.ts" }`), names `@clef/vault`, `@clef/signers`, `@clef/wallet-core`, `@clef/extension` (the extension has no `exports`, but has scripts — see Step 4).

**Step 2: Dependencies**
```bash
pnpm add --filter @clef/vault @solana/kit @scure/bip39 @noble/hashes hash-wasm
pnpm add --filter @clef/signers @solana/kit "@clef/vault@workspace:*"
pnpm add --filter @clef/wallet-core @solana/kit @solana/wallet-standard-features @solana/wallet-standard-util "@clef/vault@workspace:*" "@clef/signers@workspace:*" "@clef/rpc@workspace:*"
pnpm add --filter @clef/extension react react-dom @wallet-standard/wallet @wallet-standard/base @wallet-standard/features @solana/wallet-standard-features @solana/kit "@clef/wallet-core@workspace:*" "@clef/vault@workspace:*" "@clef/explain@workspace:*" "@clef/rpc@workspace:*"
pnpm add -D --filter @clef/extension wxt@0.21.4 @wxt-dev/module-react tailwindcss @tailwindcss/vite @types/react @types/react-dom @types/chrome
pnpm add -Dw @playwright/test
```

**Step 3: WXT config** — `apps/extension/wxt.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports everywhere
  manifest: {
    name: 'Clef',
    description: 'A Solana wallet that explains what you sign.',
    permissions: ['storage', 'alarms'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
```

`apps/extension/entrypoints/background.ts` (placeholder, replaced in Task 17):
```ts
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {});
```

**Step 4: Type-checking split.** WXT generates `apps/extension/.wxt/tsconfig.json` on `wxt prepare`.
- `apps/extension/tsconfig.json`: `{ "extends": "./.wxt/tsconfig.json", "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "jsx": "react-jsx" } }`
- `apps/extension/package.json` scripts: `"dev": "wxt"`, `"build": "wxt build"`, `"prepare": "wxt prepare"`, `"typecheck": "wxt prepare && tsc --noEmit -p tsconfig.json"`.
- Root `tsconfig.json`: add `"exclude": ["apps/extension"]`.
- Root `package.json`: `"typecheck": "tsc -p tsconfig.json && pnpm --filter @clef/extension typecheck"`, `"build:ext": "pnpm --filter @clef/extension build"`.
- Root `.gitignore`: add `apps/extension/.wxt/`, `apps/extension/.output/`, `test-results/`, `playwright-report/`.

**Step 5: Verify**
Run: `pnpm typecheck` → exit 0. Run: `pnpm build:ext` → `apps/extension/.output/chrome-mv3/manifest.json` exists and contains `wasm-unsafe-eval`. Run: `pnpm test` → all M1 tests still pass.

**Step 6: Commit** — `chore: scaffold vault, signers, wallet-core and the WXT extension`

---

### Task 2: `@clef/vault` — bytes helpers and key-value stores

**Files:** Create `packages/vault/src/bytes.ts`, `packages/vault/src/store.ts`; modify `src/index.ts`; Test `packages/vault/test/store.test.ts`

**Step 1: Failing test**
```ts
import { describe, expect, it } from 'vitest';
import { fromBase64, MemoryStore, toBase64, zeroize } from '../src';

describe('bytes and stores', () => {
  it('round-trips base64', () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it('zeroizes in place', () => {
    const b = new Uint8Array([1, 2, 3]);
    zeroize(b);
    expect([...b]).toEqual([0, 0, 0]);
  });

  it('memory store returns copies', async () => {
    const s = new MemoryStore();
    await s.set('k', { a: [1] });
    const v = await s.get<{ a: number[] }>('k');
    v!.a.push(2);
    expect(await s.get('k')).toEqual({ a: [1] });
    await s.remove('k');
    expect(await s.get('k')).toBeUndefined();
  });
});
```

**Step 2: Run → FAIL** (`pnpm vitest run packages/vault/test/store.test.ts`).

**Step 3: Implement**

`packages/vault/src/bytes.ts`:
```ts
import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

export const toBase64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);
export const fromBase64 = (text: string): Uint8Array => new Uint8Array(getBase64Encoder().encode(text));
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Best-effort wipe of key material (JS cannot guarantee no copies exist). */
export function zeroize(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}
```

`packages/vault/src/store.ts`:
```ts
/** Minimal async key-value storage; values must be JSON-compatible. Implemented by memory (tests) and chrome.storage (extension). */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}
```

`src/index.ts`: `export * from './bytes'; export * from './store';`

**Step 4: Run → PASS.** **Step 5: Commit** — `feat(vault): bytes helpers and key-value stores`

---

### Task 3: `@clef/vault` — Argon2id + AES-GCM envelope

**Files:** Create `packages/vault/src/crypto.ts`; Test `packages/vault/test/crypto.test.ts`

**Step 1: Failing test**
```ts
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
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/vault/src/crypto.ts`:
```ts
import { argon2id } from 'hash-wasm';
import { fromBase64, toBase64, utf8 } from './bytes';

export type KdfParams = { name: 'argon2id'; salt: string; memoryKiB: number; iterations: number; parallelism: number };
export type Envelope = { v: 1; kdf: KdfParams; iv: string; ct: string };

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
    this.name = 'WrongPasswordError';
  }
}

const DEFAULT_COST = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

export function newKdfParams(cost: Omit<KdfParams, 'name' | 'salt'> = DEFAULT_COST): KdfParams {
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
function aad(kdf: KdfParams): Uint8Array {
  return utf8(`clef-vault-v1|${kdf.name}|${kdf.salt}|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}`);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealEnvelope(key: Uint8Array, kdf: KdfParams, plaintext: Uint8Array): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(kdf) }, await aesKey(key), plaintext);
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
```

Export from `src/index.ts`. **Step 4: PASS.** **Step 5: Commit** — `feat(vault): argon2id + AES-GCM envelope with authenticated KDF params`

---

### Task 4: `@clef/vault` — SLIP-0010 ed25519 derivation

**Files:** Create `packages/vault/src/hd.ts`; Test `packages/vault/test/hd.test.ts`

**Step 1: Failing test** (official SLIP-0010 vector 1 + the well-known Solana default account)
```ts
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { deriveEd25519, mnemonicToSeed, solanaPath, toHexForTest } from '../src';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('SLIP-0010 ed25519', () => {
  it('matches test vector 1', () => {
    const seed = hex('000102030405060708090a0b0c0d0e0f');
    expect(toHexForTest(deriveEd25519(seed, []))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
    expect(toHexForTest(deriveEd25519(seed, [0]))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  });

  it("derives the standard Solana account m/44'/501'/0'/0'", async () => {
    const seed = await mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const key = deriveEd25519(seed, solanaPath(0));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(key);
    expect(signer.address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  });

  it('rejects out-of-range indexes', () => {
    expect(() => solanaPath(-1)).toThrow();
    expect(() => solanaPath(2 ** 31)).toThrow();
  });
});
```
(`mnemonicToSeed` is implemented in Task 5 — implement Task 5's `mnemonic.ts` `mnemonicToSeed` now if you run this test before Task 5, or order the two tasks' Step 3s together; commit separately.)

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/vault/src/hd.ts`:
```ts
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8, zeroize } from './bytes';

const HARDENED = 0x80000000;

/** SLIP-0010 ed25519 derivation. Every segment is hardened (ed25519 has no non-hardened derivation). Returns the 32-byte private key. */
export function deriveEd25519(seed: Uint8Array, path: readonly number[]): Uint8Array {
  let I = hmac(sha512, utf8('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  zeroize(I);
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(`Invalid path index ${index}`);
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index + HARDENED) >>> 0, false);
    I = hmac(sha512, chain, data);
    zeroize(key, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
    zeroize(I);
  }
  zeroize(chain);
  return key;
}

/** m/44'/501'/index'/0' — the path used by Phantom, Solflare and Backpack. */
export function solanaPath(index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(`Invalid account index ${index}`);
  return [44, 501, index, 0];
}

export const toHexForTest = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
```

**Step 4: PASS** (after Task 5's `mnemonicToSeed` exists). **Step 5: Commit** — `feat(vault): SLIP-0010 ed25519 derivation`

---

### Task 5: `@clef/vault` — mnemonics and imported keypairs

**Files:** Create `packages/vault/src/mnemonic.ts`, `packages/vault/src/keypair.ts`; Test `packages/vault/test/mnemonic.test.ts`

**Step 1: Failing test**
```ts
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateMnemonic, InvalidSecretError, normalizeMnemonic, parseSecretKey, validateMnemonic } from '../src';

describe('mnemonics', () => {
  it('generates valid 12 and 24 word phrases', () => {
    expect(generateMnemonic(12).split(' ')).toHaveLength(12);
    expect(validateMnemonic(generateMnemonic(24))).toBe(true);
  });

  it('normalizes whitespace and case before validating', () => {
    const m = '  Abandon abandon ABANDON abandon abandon abandon abandon abandon abandon abandon abandon   about ';
    expect(normalizeMnemonic(m)).toBe('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    expect(validateMnemonic(m)).toBe(true);
    expect(validateMnemonic('abandon abandon abandon')).toBe(false);
  });
});

describe('imported secret keys', () => {
  const seed = new Uint8Array(32).fill(7);
  let signer: Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>;
  let full: Uint8Array;
  beforeAll(async () => {
    signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    full = new Uint8Array([...seed, ...pub]);
  });

  it('accepts base58 and JSON-array forms and returns the 32-byte seed + address', async () => {
    for (const input of [getBase58Decoder().decode(full), JSON.stringify([...full])]) {
      const parsed = await parseSecretKey(input);
      expect(parsed.address).toBe(signer.address);
      expect(parsed.privateKey).toEqual(seed);
    }
  });

  it('rejects a secret whose public half does not match', async () => {
    const bad = new Uint8Array(full);
    bad[63] ^= 1;
    await expect(parseSecretKey(JSON.stringify([...bad]))).rejects.toBeInstanceOf(InvalidSecretError);
  });

  it('rejects garbage without echoing it', async () => {
    const err = await parseSecretKey('not a key at all').catch((e: Error) => e);
    expect(err).toBeInstanceOf(InvalidSecretError);
    expect((err as Error).message).not.toContain('not a key');
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

`packages/vault/src/mnemonic.ts`:
```ts
import { generateMnemonic as gen, mnemonicToSeed as toSeed, validateMnemonic as valid } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export const normalizeMnemonic = (m: string) => m.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');

export const generateMnemonic = (words: 12 | 24 = 12) => gen(wordlist, words === 12 ? 128 : 256);

export const validateMnemonic = (m: string) => valid(normalizeMnemonic(m), wordlist);

export async function mnemonicToSeed(m: string, passphrase = ''): Promise<Uint8Array> {
  return toSeed(normalizeMnemonic(m), passphrase);
}
```

`packages/vault/src/keypair.ts`:
```ts
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, type Address } from '@solana/kit';
import { zeroize } from './bytes';

export class InvalidSecretError extends Error {
  constructor(reason: string) {
    super(`Invalid secret key: ${reason}`);
    this.name = 'InvalidSecretError';
  }
}

function decode(input: string): Uint8Array {
  const text = input.trim();
  if (text.startsWith('[')) {
    let arr: unknown;
    try {
      arr = JSON.parse(text);
    } catch {
      throw new InvalidSecretError('malformed JSON array');
    }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new InvalidSecretError('expected an array of bytes');
    }
    return Uint8Array.from(arr as number[]);
  }
  try {
    return new Uint8Array(getBase58Encoder().encode(text));
  } catch {
    throw new InvalidSecretError('not base58');
  }
}

/** Accepts a 64-byte secret key (Phantom base58 export, or Solana CLI JSON array). Verifies the public half. */
export async function parseSecretKey(input: string): Promise<{ address: Address; privateKey: Uint8Array }> {
  const bytes = decode(input);
  try {
    if (bytes.length !== 64) throw new InvalidSecretError('expected 64 bytes');
    const privateKey = bytes.slice(0, 32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    if (!pub.every((b, i) => b === bytes[32 + i])) {
      zeroize(privateKey);
      throw new InvalidSecretError('public key does not match');
    }
    return { address: signer.address, privateKey };
  } finally {
    zeroize(bytes);
  }
}
```
Export both. **Step 4: PASS** (Task 4's test should pass too now). **Step 5: Commit** — `feat(vault): BIP39 mnemonics and imported secret keys`

---

### Task 6: `@clef/vault` — the `Vault`

The vault holds an encrypted list of secrets. Unlocking derives the key once and stores it in the **session** store so an MV3 service-worker restart does not lock the user out; locking removes it.

**Files:** Create `packages/vault/src/vault.ts`; Test `packages/vault/test/vault.test.ts`

**Step 1: Failing test**
```ts
import { describe, expect, it } from 'vitest';
import { LockedError, MemoryStore, Vault, WrongPasswordError } from '../src';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 };

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
    expect(await vault.isUnlocked()).toBe(true);
    await vault.lock();
    expect(await vault.isUnlocked()).toBe(false);
    await expect(vault.secrets()).rejects.toBeInstanceOf(LockedError);
    await vault.unlock('a long password');
    expect((await vault.secrets())[0]).toMatchObject({ id: ids[0], kind: 'mnemonic' });
  });

  it('rejects short passwords, a second create, and wrong passwords', async () => {
    const { vault } = setup();
    await expect(vault.create('short', [])).rejects.toThrow(/at least 8/);
    await vault.create('a long password', []);
    await expect(vault.create('a long password', [])).rejects.toThrow(/already exists/);
    await vault.lock();
    await expect(vault.unlock('nope nope nope')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('survives a service-worker restart via the session store', async () => {
    const { local, session, vault } = setup();
    await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    const restarted = new Vault(local, session, FAST);
    expect(await restarted.isUnlocked()).toBe(true);
    expect(await restarted.secrets()).toHaveLength(1);
  });

  it('derives HD keys and zeroes them after use', async () => {
    const { vault } = setup();
    const [id] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    let seen: Uint8Array | undefined;
    const address = await vault.withPrivateKey({ secretId: id!, index: 0 }, async (key, addr) => {
      seen = key;
      return addr;
    });
    expect(address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
    expect([...seen!].every((b) => b === 0)).toBe(true);
  });

  it('adds secrets and changes the password', async () => {
    const { vault } = setup();
    await vault.create('a long password', []);
    await vault.addSecret({ kind: 'mnemonic', phrase: ABANDON });
    await vault.changePassword('a long password', 'another long password');
    await vault.lock();
    await expect(vault.unlock('a long password')).rejects.toBeInstanceOf(WrongPasswordError);
    await vault.unlock('another long password');
    expect(await vault.secrets()).toHaveLength(1);
  });

  it('never persists plaintext', async () => {
    const { local, vault } = setup();
    await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
    expect(JSON.stringify(await local.get('vault'))).not.toContain('abandon');
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/vault/src/vault.ts`:
```ts
import type { Address } from '@solana/kit';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { fromBase64, toBase64, utf8, zeroize } from './bytes';
import { deriveKey, newKdfParams, openEnvelope, sealEnvelope, type Envelope, type KdfParams } from './crypto';
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

type Cost = Omit<KdfParams, 'name' | 'salt'>;

export class Vault {
  constructor(
    private readonly local: KeyValueStore,
    private readonly session: KeyValueStore,
    private readonly cost?: Cost, // tests pass a cheap cost; production uses the defaults
  ) {}

  async exists(): Promise<boolean> {
    return (await this.local.get<Envelope>(VAULT)) !== undefined;
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.session.get<string>(SESSION)) !== undefined;
  }

  async create(password: string, secrets: NewSecret[]): Promise<string[]> {
    if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
    if (await this.exists()) throw new Error('A vault already exists');
    const kdf = newKdfParams(this.cost);
    const key = await deriveKey(password, kdf);
    const stored = secrets.map(toStored);
    await this.write(key, kdf, stored);
    await this.session.set(SESSION, toBase64(key));
    zeroize(key);
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
      const pt = await openEnvelope(key, env);
      const parsed = JSON.parse(new TextDecoder().decode(pt)) as Secret[];
      zeroize(pt);
      return parsed;
    } finally {
      zeroize(key);
    }
  }

  async addSecret(secret: NewSecret): Promise<string> {
    const { key, env } = await this.open();
    try {
      const current = await this.secrets();
      const stored = toStored(secret);
      await this.write(key, env.kdf, [...current, stored]);
      return stored.id;
    } finally {
      zeroize(key);
    }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
    const env = await this.envelope();
    const oldKey = await deriveKey(oldPassword, env.kdf);
    const pt = await openEnvelope(oldKey, env).finally(() => zeroize(oldKey));
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
      privateKey = deriveEd25519(seed, solanaPath(ref.index ?? 0));
      zeroize(seed);
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
```

Export everything. **Step 4: PASS.** **Step 5: Commit** — `feat(vault): encrypted vault with session unlock and scoped key access`

---

### Task 7: `@clef/signers` — sign wire transactions and messages

**Files:** Create `packages/signers/src/software.ts`, `src/index.ts`; Test `packages/signers/test/software.test.ts` (+ copy `buildWire`/`buildV1Wire` from `packages/explain/test/helpers.ts` into `packages/signers/test/helpers.ts`, trimmed to what is needed)

**Step 1: Failing test**
```ts
import { getTransferSolInstruction } from '@solana-program/system';
import { createKeyPairSignerFromPrivateKeyBytes, createNoopSigner, getTransactionDecoder, verifySignature, address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { NotASignerError, signMessageBytes, signTransactionWire } from '../src';
import { buildV1Wire, buildWire } from './helpers';

const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
let key: Uint8Array;
let signer: Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>;

beforeAll(async () => {
  key = new Uint8Array(32).fill(9);
  signer = await createKeyPairSignerFromPrivateKeyBytes(key);
});

describe.each([['v0', buildWire], ['v1', buildV1Wire]] as const)('signTransactionWire (%s)', (_name, build) => {
  it('fills exactly the signer slot with a valid signature', async () => {
    const ix = getTransferSolInstruction({ source: createNoopSigner(signer.address), destination: OTHER, amount: 1n });
    const wire = build([ix], { feePayer: signer.address });
    const signed = getTransactionDecoder().decode(await signTransactionWire(wire, signer.address, new Uint8Array(key)));
    const sig = signed.signatures[signer.address];
    expect(sig).toBeTruthy();
    expect(await verifySignature(signer.keyPair.publicKey, sig!, signed.messageBytes)).toBe(true);
  });
});

describe('guards', () => {
  it('refuses when the account is not a required signer', async () => {
    const ix = getTransferSolInstruction({ source: createNoopSigner(OTHER), destination: signer.address, amount: 1n });
    const wire = buildWire([ix], { feePayer: OTHER });
    await expect(signTransactionWire(wire, signer.address, new Uint8Array(key))).rejects.toBeInstanceOf(NotASignerError);
  });

  it('refuses when the key does not belong to the account', async () => {
    const ix = getTransferSolInstruction({ source: createNoopSigner(signer.address), destination: OTHER, amount: 1n });
    const wire = buildWire([ix], { feePayer: signer.address });
    await expect(signTransactionWire(wire, signer.address, new Uint8Array(32).fill(1))).rejects.toThrow(/does not match/);
  });

  it('signs messages', async () => {
    const msg = new TextEncoder().encode('hello');
    const sig = await signMessageBytes(msg, signer.address, new Uint8Array(key));
    expect(await verifySignature(signer.keyPair.publicKey, sig, msg)).toBe(true);
  });
});
```
Add `@solana-program/system` as a dev dependency of `@clef/signers`.

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/signers/src/software.ts`:
```ts
import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  type Address,
  type SignatureBytes,
} from '@solana/kit';

export class NotASignerError extends Error {
  constructor(account: string) {
    super(`${account} is not a required signer of this transaction`);
    this.name = 'NotASignerError';
  }
}

async function keyFor(account: Address, privateKey: Uint8Array): Promise<CryptoKey> {
  const pair = await createKeyPairFromPrivateKeyBytes(privateKey);
  if ((await getAddressFromPublicKey(pair.publicKey)) !== account) throw new Error('Private key does not match the account');
  return pair.privateKey;
}

/** Adds `account`'s signature to a wire transaction (legacy, v0 or v1). Other signatures are left untouched. */
export async function signTransactionWire(wire: Uint8Array, account: Address, privateKey: Uint8Array): Promise<Uint8Array> {
  const tx = getTransactionDecoder().decode(wire);
  if (!Object.hasOwn(tx.signatures, account)) throw new NotASignerError(account);
  const key = await keyFor(account, privateKey);
  const signature = await signBytes(key, tx.messageBytes);
  return new Uint8Array(getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [account]: signature } }));
}

export async function signMessageBytes(message: Uint8Array, account: Address, privateKey: Uint8Array): Promise<SignatureBytes> {
  return signBytes(await keyFor(account, privateKey), message);
}
```
(`createKeyPairFromPrivateKeyBytes` imports the key non-extractable; the caller still zeroes its byte copy.)

**Step 4: PASS.** **Step 5: Commit** — `feat(signers): sign wire transactions (legacy/v0/v1) and messages`

---

### Task 8: `@clef/rpc` — `TransactionSender`

**Files:** Create `packages/rpc/src/sender.ts`; Modify `packages/rpc/src/kit.ts` (implement it), `src/index.ts`; Test `packages/rpc/test/sender.test.ts`

**Step 1: Failing test** (offline, with the injectable fake RPC pattern from `kit.test.ts`)
```ts
import { describe, expect, it, vi } from 'vitest';
import { KitChainReader, MemorySender } from '../src';

describe('TransactionSender', () => {
  it('KitChainReader.send base64-encodes the wire and returns the signature', async () => {
    const sendTransaction = vi.fn(() => ({ send: async () => '5sig' }));
    const reader = new KitChainReader({ sendTransaction } as never);
    expect(await reader.send(new Uint8Array([1, 2]), { skipPreflight: false })).toBe('5sig');
    expect(sendTransaction).toHaveBeenCalledWith('AQI=', expect.objectContaining({ encoding: 'base64', preflightCommitment: 'confirmed' }));
  });

  it('MemorySender records what it was asked to send', async () => {
    const s = new MemorySender('sig1');
    expect(await s.send(new Uint8Array([9]))).toBe('sig1');
    expect(s.sent).toEqual([new Uint8Array([9])]);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/rpc/src/sender.ts`:
```ts
export type SendOptions = { skipPreflight?: boolean; maxRetries?: number; minContextSlot?: bigint };

/** Submits a fully signed wire transaction; resolves with its base58 signature once the RPC accepted it. */
export interface TransactionSender {
  send(wire: Uint8Array, options?: SendOptions): Promise<string>;
}

export class MemorySender implements TransactionSender {
  readonly sent: Uint8Array[] = [];
  constructor(private readonly signature = '1111111111111111111111111111111111111111111111111111111111111111') {}
  async send(wire: Uint8Array): Promise<string> {
    this.sent.push(new Uint8Array(wire));
    return this.signature;
  }
}
```
In `kit.ts`, make `KitChainReader` also `implements TransactionSender`:
```ts
  async send(wire: Uint8Array, options: SendOptions = {}): Promise<string> {
    const encoded = getBase64Decoder().decode(wire) as Base64EncodedWireTransaction;
    return this.rpc
      .sendTransaction(encoded, {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
        skipPreflight: options.skipPreflight ?? false,
        ...(options.maxRetries !== undefined && { maxRetries: BigInt(options.maxRetries) }),
        ...(options.minContextSlot !== undefined && { minContextSlot: options.minContextSlot }),
      })
      .send();
  }
```
**Step 4: PASS.** **Step 5: Commit** — `feat(rpc): transaction sender`

---

### Task 9: `@clef/wallet-core` — settings, accounts and permissions

**Files:** Create `packages/wallet-core/src/settings.ts`, `accounts.ts`, `permissions.ts`; Test `packages/wallet-core/test/stores.test.ts`

**Step 1: Failing test**
```ts
import { MemoryStore } from '@clef/vault';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountStore, chainFor, DEFAULT_SETTINGS, PermissionStore, SettingsStore } from '../src';

const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const B = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

describe('stores', () => {
  it('settings default and validate', async () => {
    const s = new SettingsStore(new MemoryStore());
    expect(await s.get()).toEqual(DEFAULT_SETTINGS);
    await s.update({ network: 'devnet', autoLockMinutes: 5 });
    expect(chainFor((await s.get()).network)).toBe('solana:devnet');
    await expect(s.update({ autoLockMinutes: 0 })).rejects.toThrow();
    await expect(s.update({ rpcUrl: 'javascript:alert(1)' })).rejects.toThrow(/https/);
  });

  it('accounts: add, dedupe, rename, remove; watch accounts cannot sign', async () => {
    const a = new AccountStore(new MemoryStore());
    await a.add({ kind: 'hd', address: A, label: 'Account 1', secretId: 's1', index: 0 });
    await expect(a.add({ kind: 'watch', address: A, label: 'dup' })).rejects.toThrow(/already/);
    await a.add({ kind: 'watch', address: B, label: 'Cold' });
    await a.rename(B, 'Cold storage');
    expect((await a.get(B))?.label).toBe('Cold storage');
    expect(await a.canSign(B)).toBe(false);
    expect(await a.canSign(A)).toBe(true);
    await a.remove(B);
    expect(await a.list()).toHaveLength(1);
  });

  it('permissions are per origin', async () => {
    const p = new PermissionStore(new MemoryStore());
    await p.grant('https://dapp.example', [A]);
    expect(await p.allowed('https://dapp.example', A)).toBe(true);
    expect(await p.allowed('https://evil.example', A)).toBe(false);
    await p.revoke('https://dapp.example');
    expect(await p.get('https://dapp.example')).toBeNull();
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement**

`settings.ts`:
```ts
import type { KeyValueStore } from '@clef/vault';

export type Network = 'mainnet' | 'devnet';
export type Settings = { network: Network; rpcUrl: string; autoLockMinutes: number };

export const DEFAULT_RPC: Record<Network, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};
export const DEFAULT_SETTINGS: Settings = { network: 'mainnet', rpcUrl: DEFAULT_RPC.mainnet, autoLockMinutes: 15 };

export const chainFor = (n: Network) => (n === 'mainnet' ? 'solana:mainnet' : 'solana:devnet') as const;

const KEY = 'settings';

export class SettingsStore {
  constructor(private readonly store: KeyValueStore) {}

  async get(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await this.store.get<Partial<Settings>>(KEY)) };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    if (patch.network && !patch.rpcUrl) next.rpcUrl = DEFAULT_RPC[patch.network];
    if (!['mainnet', 'devnet'].includes(next.network)) throw new Error('Unknown network');
    const url = new URL(next.rpcUrl);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('RPC URL must use https (http only for localhost)');
    if (!Number.isInteger(next.autoLockMinutes) || next.autoLockMinutes < 1 || next.autoLockMinutes > 24 * 60) {
      throw new Error('Auto-lock must be between 1 minute and 24 hours');
    }
    await this.store.set(KEY, next);
    return next;
  }
}
```

`accounts.ts`:
```ts
import type { KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';

export type Account =
  | { kind: 'hd'; address: Address; label: string; secretId: string; index: number }
  | { kind: 'imported'; address: Address; label: string; secretId: string }
  | { kind: 'watch'; address: Address; label: string };

const KEY = 'accounts';

export class AccountStore {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<Account[]> {
    return (await this.store.get<Account[]>(KEY)) ?? [];
  }

  async get(address: string): Promise<Account | undefined> {
    return (await this.list()).find((a) => a.address === address);
  }

  async add(account: Account): Promise<void> {
    const all = await this.list();
    if (all.some((a) => a.address === account.address)) throw new Error('Account already added');
    await this.store.set(KEY, [...all, account]);
  }

  async rename(address: string, label: string): Promise<void> {
    const clean = label.trim().slice(0, 32);
    if (!clean) throw new Error('Label required');
    await this.store.set(KEY, (await this.list()).map((a) => (a.address === address ? { ...a, label: clean } : a)));
  }

  async remove(address: string): Promise<void> {
    await this.store.set(KEY, (await this.list()).filter((a) => a.address !== address));
  }

  async canSign(address: string): Promise<boolean> {
    const a = await this.get(address);
    return a !== undefined && a.kind !== 'watch';
  }

  async nextHdIndex(secretId: string): Promise<number> {
    const used = (await this.list()).filter((a) => a.kind === 'hd' && a.secretId === secretId).map((a) => (a as { index: number }).index);
    return used.length ? Math.max(...used) + 1 : 0;
  }
}
```

`permissions.ts`:
```ts
import type { KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';

export type Permission = { origin: string; accounts: Address[]; connectedAt: number };
const KEY = 'permissions';

export class PermissionStore {
  constructor(private readonly store: KeyValueStore, private readonly now: () => number = Date.now) {}

  private async all(): Promise<Record<string, Permission>> {
    return (await this.store.get<Record<string, Permission>>(KEY)) ?? {};
  }

  async get(origin: string): Promise<Permission | null> {
    const all = await this.all();
    return Object.hasOwn(all, origin) ? all[origin]! : null;
  }

  async list(): Promise<Permission[]> {
    return Object.values(await this.all());
  }

  async grant(origin: string, accounts: Address[]): Promise<void> {
    await this.store.set(KEY, { ...(await this.all()), [origin]: { origin, accounts, connectedAt: this.now() } });
  }

  async revoke(origin: string): Promise<void> {
    const all = await this.all();
    delete all[origin];
    await this.store.set(KEY, all);
  }

  async allowed(origin: string, account: string): Promise<boolean> {
    return (await this.get(origin))?.accounts.includes(account as Address) ?? false;
  }
}
```

Export all. **Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): settings, accounts and permissions stores`

---

### Task 10: `@clef/wallet-core` — dApp protocol and validation

Everything that crosses from a page into the extension is untrusted. This module defines the wire format (JSON-safe; bytes as base64) and validates it strictly.

**Files:** Create `packages/wallet-core/src/protocol.ts`; Test `packages/wallet-core/test/protocol.test.ts`

**Step 1: Failing test**
```ts
import { describe, expect, it } from 'vitest';
import { ERR, parseRequest, ProtocolError } from '../src';

const ok = (method: string, params: unknown) => ({ id: 'r1', method, params });

describe('parseRequest', () => {
  it('accepts well-formed requests', () => {
    expect(parseRequest(ok('connect', { silent: true }))).toEqual({ id: 'r1', method: 'connect', params: { silent: true } });
    const tx = parseRequest(ok('signTransaction', { account: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', chain: 'solana:mainnet', transactions: ['AQI='] }));
    expect(tx.method).toBe('signTransaction');
  });

  it.each([
    ['unknown method', ok('eth_sign', {})],
    ['bad id', { id: 5, method: 'connect', params: {} }],
    ['non-base64 tx', ok('signTransaction', { account: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', chain: 'solana:mainnet', transactions: ['%%%'] })],
    ['bad account', ok('signMessage', { account: 'nope', message: 'AQI=' })],
    ['too many txs', ok('signTransaction', { account: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', chain: 'solana:mainnet', transactions: Array(17).fill('AQI=') })],
    ['oversized message', ok('signMessage', { account: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', message: 'A'.repeat(30000) })],
    ['extra keys in signIn', ok('signIn', { input: { domain: 'x', __proto__: { polluted: true }, evil: 1 } })],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseRequest(raw)).toThrow(ProtocolError);
    try {
      parseRequest(raw);
    } catch (e) {
      expect((e as ProtocolError).code).toBe(ERR.INVALID_PARAMS);
    }
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/wallet-core/src/protocol.ts`:
```ts
import { fromBase64 } from '@clef/vault';
import { isAddress } from '@solana/kit';

export const ERR = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED: 4200,
  BUSY: 4429,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export class ProtocolError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const MAX_TX_BYTES = 4096; // v1 maximum; legacy/v0 are smaller
const MAX_BATCH = 16;
const MAX_MESSAGE_BYTES = 16 * 1024;
const SIGN_IN_FIELDS = ['domain', 'address', 'statement', 'uri', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime', 'notBefore', 'requestId', 'resources'] as const;

export type SignInInput = Partial<Record<Exclude<(typeof SIGN_IN_FIELDS)[number], 'resources'>, string>> & { resources?: string[] };

export type Request =
  | { id: string; method: 'connect'; params: { silent: boolean } }
  | { id: string; method: 'disconnect'; params: Record<string, never> }
  | { id: string; method: 'signTransaction'; params: { account: string; chain: string; transactions: Uint8Array[] } }
  | { id: string; method: 'signAndSendTransaction'; params: { account: string; chain: string; transaction: Uint8Array; skipPreflight: boolean } }
  | { id: string; method: 'signMessage'; params: { account: string; message: Uint8Array } }
  | { id: string; method: 'signIn'; params: { input: SignInInput } };

export type Response = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: { code: number; message: string } };

const invalid = (msg: string) => new ProtocolError(ERR.INVALID_PARAMS, msg);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function str(v: unknown, name: string, max = 512): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw invalid(`${name} must be a non-empty string`);
  return v;
}

function account(v: unknown): string {
  const a = str(v, 'account', 64);
  if (!isAddress(a)) throw invalid('account is not an address');
  return a;
}

function chain(v: unknown): string {
  const c = str(v, 'chain', 64);
  if (!/^solana:[a-z]+$/.test(c)) throw invalid('unsupported chain');
  return c;
}

function b64(v: unknown, name: string, maxBytes: number): Uint8Array {
  const s = str(v, name, Math.ceil(maxBytes / 3) * 4 + 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw invalid(`${name} must be base64`);
  const bytes = fromBase64(s);
  if (bytes.length === 0 || bytes.length > maxBytes) throw invalid(`${name} has an invalid size`);
  return bytes;
}

export function parseRequest(raw: unknown): Request {
  if (!isObj(raw)) throw invalid('request must be an object');
  const id = str(raw.id, 'id', 64);
  const p = raw.params ?? {};
  if (!isObj(p)) throw invalid('params must be an object');
  switch (raw.method) {
    case 'connect':
      return { id, method: 'connect', params: { silent: p.silent === true } };
    case 'disconnect':
      return { id, method: 'disconnect', params: {} };
    case 'signTransaction': {
      if (!Array.isArray(p.transactions) || p.transactions.length === 0 || p.transactions.length > MAX_BATCH) throw invalid('transactions must be a non-empty array (max 16)');
      return { id, method: 'signTransaction', params: { account: account(p.account), chain: chain(p.chain), transactions: p.transactions.map((t, i) => b64(t, `transactions[${i}]`, MAX_TX_BYTES)) } };
    }
    case 'signAndSendTransaction':
      return { id, method: 'signAndSendTransaction', params: { account: account(p.account), chain: chain(p.chain), transaction: b64(p.transaction, 'transaction', MAX_TX_BYTES), skipPreflight: p.skipPreflight === true } };
    case 'signMessage':
      return { id, method: 'signMessage', params: { account: account(p.account), message: b64(p.message, 'message', MAX_MESSAGE_BYTES) } };
    case 'signIn': {
      const input = p.input ?? {};
      if (!isObj(input)) throw invalid('input must be an object');
      const out: SignInInput = {};
      for (const key of Object.keys(input)) {
        if (!(SIGN_IN_FIELDS as readonly string[]).includes(key)) throw invalid(`unknown signIn field ${key}`);
      }
      for (const key of SIGN_IN_FIELDS) {
        const v = input[key];
        if (v === undefined) continue;
        if (key === 'resources') {
          if (!Array.isArray(v) || v.length > 20) throw invalid('resources must be an array');
          out.resources = v.map((r, i) => str(r, `resources[${i}]`));
        } else {
          (out as Record<string, string>)[key] = str(v, key);
        }
      }
      if (out.address !== undefined && !isAddress(out.address)) throw invalid('address is not an address');
      return { id, method: 'signIn', params: { input: out } };
    }
    default:
      throw invalid('unknown method');
  }
}

export const failure = (id: string, e: unknown): Response => ({
  id,
  ok: false,
  error: e instanceof ProtocolError ? { code: e.code, message: e.message } : { code: ERR.INTERNAL, message: 'Internal error' },
});
```
(Internal errors never leak their message to the page.)

**Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): strict dApp request protocol`

---

### Task 11: `@clef/wallet-core` — message inspection (SIWS and transaction look-alikes)

**Files:** Create `packages/wallet-core/src/messages.ts`; Test `packages/wallet-core/test/messages.test.ts`

**Step 1: Failing test**
```ts
import { createSignInMessage } from '@solana/wallet-standard-util';
import { describe, expect, it } from 'vitest';
import { inspectMessage } from '../src';
// reuse a tiny wire builder (copy buildWire into wallet-core/test/helpers.ts)
import { sampleWire } from './helpers';

const ORIGIN = 'https://dapp.example';

describe('inspectMessage', () => {
  it('recognises SIWS and checks the domain against the origin', () => {
    const good = createSignInMessage({ domain: 'dapp.example', address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' });
    expect(inspectMessage(good, ORIGIN)).toMatchObject({ kind: 'siws', domainMatches: true });
    const phish = createSignInMessage({ domain: 'other.example', address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' });
    expect(inspectMessage(phish, ORIGIN)).toMatchObject({ kind: 'siws', domainMatches: false, danger: true });
  });

  it('flags messages that are actually transactions', () => {
    const wire = sampleWire();
    expect(inspectMessage(wire, ORIGIN)).toMatchObject({ looksLikeTransaction: true, danger: true });
  });

  it('shows printable text and hex for binary', () => {
    expect(inspectMessage(new TextEncoder().encode('Hello\nworld'), ORIGIN)).toMatchObject({ kind: 'text', text: 'Hello\nworld', danger: false });
    expect(inspectMessage(new Uint8Array([0, 1, 2]), ORIGIN)).toMatchObject({ kind: 'binary', hex: '000102' });
  });

  it('strips bidi/control characters from displayed text', () => {
    const r = inspectMessage(new TextEncoder().encode('pay ‮evil'), ORIGIN);
    expect(r.kind === 'text' && r.text).toBe('pay evil');
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `packages/wallet-core/src/messages.ts`:
```ts
import { sanitizeText } from '@clef/explain';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { parseSignInMessage } from '@solana/wallet-standard-util';

export type MessageInspection =
  | { kind: 'siws'; domain: string; domainMatches: boolean; fields: Record<string, string>; looksLikeTransaction: boolean; danger: boolean }
  | { kind: 'text'; text: string; looksLikeTransaction: boolean; danger: boolean }
  | { kind: 'binary'; hex: string; looksLikeTransaction: boolean; danger: boolean };

function decodesAsTransaction(bytes: Uint8Array): boolean {
  for (const attempt of [() => getTransactionDecoder().decode(bytes), () => getCompiledTransactionMessageDecoder().decode(bytes)]) {
    try {
      attempt();
      return true;
    } catch {
      /* not this shape */
    }
  }
  return false;
}

const keepNewlines = (s: string) => s.split('\n').map((line) => sanitizeText(line, 4096)).join('\n');

export function inspectMessage(bytes: Uint8Array, origin: string): MessageInspection {
  const looksLikeTransaction = decodesAsTransaction(bytes);
  const siws = parseSignInMessage(bytes);
  if (siws) {
    const host = new URL(origin).host;
    const domainMatches = siws.domain === host;
    const fields = Object.fromEntries(Object.entries(siws).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, sanitizeText(v as string, 512)]));
    return { kind: 'siws', domain: sanitizeText(siws.domain, 256), domainMatches, fields, looksLikeTransaction, danger: !domainMatches || looksLikeTransaction };
  }
  const text = new TextDecoder('utf-8', { fatal: true });
  try {
    const decoded = text.decode(bytes);
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) {
      return { kind: 'text', text: keepNewlines(decoded), looksLikeTransaction, danger: looksLikeTransaction };
    }
  } catch {
    /* not UTF-8 */
  }
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { kind: 'binary', hex, looksLikeTransaction, danger: looksLikeTransaction };
}
```
Add `@clef/explain` to `@clef/wallet-core` dependencies. **Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): message inspection (SIWS domain check, transaction look-alikes)`

---

### Task 12: `@clef/wallet-core` — auto-lock

**Files:** Create `packages/wallet-core/src/autolock.ts`; Test `packages/wallet-core/test/autolock.test.ts`

**Step 1: Failing test**
```ts
import { describe, expect, it, vi } from 'vitest';
import { AutoLock, type LockScheduler } from '../src';

function fakeScheduler() {
  let fire: (() => void) | null = null;
  const s: LockScheduler & { fire(): void; at: number | null } = {
    at: null,
    schedule(minutes, cb) { this.at = minutes; fire = cb; },
    cancel() { this.at = null; fire = null; },
    fire() { fire?.(); },
  };
  return s;
}

describe('AutoLock', () => {
  it('locks after the configured idle time and re-arms on activity', async () => {
    const lock = vi.fn(async () => {});
    const sched = fakeScheduler();
    const auto = new AutoLock(sched, lock, async () => 15);
    await auto.touch();
    expect(sched.at).toBe(15);
    sched.fire();
    expect(lock).toHaveBeenCalledOnce();
  });

  it('cancels when locked manually', async () => {
    const sched = fakeScheduler();
    const auto = new AutoLock(sched, async () => {}, async () => 15);
    await auto.touch();
    auto.stop();
    expect(sched.at).toBeNull();
  });
});
```

**Step 2–3: Implement** `autolock.ts`:
```ts
export interface LockScheduler {
  schedule(minutes: number, onFire: () => void): void;
  cancel(): void;
}

/** Re-arms a single idle timer on every user/dApp activity; firing locks the vault. */
export class AutoLock {
  constructor(
    private readonly scheduler: LockScheduler,
    private readonly lock: () => Promise<void>,
    private readonly minutes: () => Promise<number>,
  ) {}

  async touch(): Promise<void> {
    this.scheduler.schedule(await this.minutes(), () => void this.lock());
  }

  stop(): void {
    this.scheduler.cancel();
  }
}
```
**Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): auto-lock`

---

### Task 13: `@clef/wallet-core` — `WalletService`: connect, disconnect, events

`WalletService` is the background's brain. It is pure: chrome-specific pieces are injected.

**Files:** Create `packages/wallet-core/src/service.ts`; Test `packages/wallet-core/test/service-connect.test.ts`, plus `test/fixture.ts` (shared setup)

**Step 1: Shared fixture** `packages/wallet-core/test/fixture.ts`:
```ts
import { MemorySender } from '@clef/rpc';
import { MemoryStore, Vault } from '@clef/vault';
import { address } from '@solana/kit';
import { AccountStore, PermissionStore, SettingsStore, WalletService, type ApprovalDecision, type ApprovalRequest } from '../src';

export const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const A = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
export const ORIGIN = 'https://dapp.example';

export async function setup(decide: (r: ApprovalRequest) => ApprovalDecision = () => ({ approved: true })) {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore(), { memoryKiB: 1024, iterations: 1, parallelism: 1 });
  const [secretId] = await vault.create('a long password', [{ kind: 'mnemonic', phrase: ABANDON }]);
  const accounts = new AccountStore(local);
  await accounts.add({ kind: 'hd', address: A, label: 'Account 1', secretId: secretId!, index: 0 });
  const approvals: ApprovalRequest[] = [];
  const events: { origin: string; accounts: string[] }[] = [];
  const sender = new MemorySender('5sigBase58');
  const service = new WalletService({
    vault,
    accounts,
    permissions: new PermissionStore(local),
    settings: new SettingsStore(local),
    sender,
    approver: { request: async (r) => (approvals.push(r), decide(r)) },
    emit: (origin, accts) => events.push({ origin, accounts: accts }),
    activity: async () => {},
  });
  return { service, vault, accounts, approvals, events, sender };
}
```

**Step 2: Failing test** `service-connect.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ERR } from '../src';
import { A, ORIGIN, setup } from './fixture';

const req = (method: string, params: unknown = {}) => ({ id: 'r', method, params });

describe('WalletService connect', () => {
  it('silent connect returns nothing for unknown origins and does not prompt', async () => {
    const { service, approvals } = await setup();
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toEqual({ id: 'r', ok: true, result: { accounts: [] } });
    expect(approvals).toEqual([]);
  });

  it('interactive connect asks, grants and returns the chosen accounts', async () => {
    const { service, approvals } = await setup((r) => ({ approved: true, accounts: r.kind === 'connect' ? [A] : undefined }));
    const res = await service.handle(ORIGIN, req('connect'));
    expect(res).toEqual({ id: 'r', ok: true, result: { accounts: [A] } });
    expect(approvals[0]).toMatchObject({ kind: 'connect', origin: ORIGIN });
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [A] } });
  });

  it('rejection maps to 4001', async () => {
    const { service } = await setup(() => ({ approved: false }));
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ ok: false, error: { code: ERR.USER_REJECTED } });
  });

  it('cannot grant accounts the wallet does not hold', async () => {
    const { service } = await setup(() => ({ approved: true, accounts: ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'] }));
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ ok: false });
  });

  it('disconnect revokes and emits an empty account list', async () => {
    const { service, events } = await setup((r) => ({ approved: true, accounts: r.kind === 'connect' ? [A] : undefined }));
    await service.handle(ORIGIN, req('connect'));
    await service.handle(ORIGIN, req('disconnect'));
    expect(events.at(-1)).toEqual({ origin: ORIGIN, accounts: [] });
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [] } });
  });

  it('limits concurrent pending requests per origin', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { service } = await setup(() => ({ approved: false }));
    (service as unknown as { deps: { approver: { request: () => Promise<unknown> } } }).deps.approver.request = () => gate.then(() => ({ approved: false }));
    const pending = [1, 2, 3].map(() => service.handle(ORIGIN, req('connect')));
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ ok: false, error: { code: ERR.BUSY } });
    release();
    await Promise.all(pending);
  });

  it('rejects malformed requests without throwing', async () => {
    const { service } = await setup();
    expect(await service.handle(ORIGIN, { id: 'x', method: 'nope' })).toMatchObject({ ok: false, error: { code: ERR.INVALID_PARAMS } });
  });
});
```

**Step 3: Run → FAIL.**

**Step 4: Implement** `packages/wallet-core/src/service.ts` (connect part; signing in Task 14):
```ts
import type { TransactionSender } from '@clef/rpc';
import type { Vault } from '@clef/vault';
import type { Address } from '@solana/kit';
import type { AccountStore } from './accounts';
import type { PermissionStore } from './permissions';
import { ERR, failure, parseRequest, ProtocolError, type Request, type Response, type SignInInput } from './protocol';
import { chainFor, type SettingsStore } from './settings';

export type ApprovalRequest =
  | { kind: 'connect'; origin: string }
  | { kind: 'signTransactions'; origin: string; account: Address; chain: string; transactions: Uint8Array[]; send: boolean }
  | { kind: 'signMessage'; origin: string; account: Address; message: Uint8Array }
  | { kind: 'signIn'; origin: string; account: Address | null; input: SignInInput };

export type ApprovalDecision = { approved: false } | { approved: true; accounts?: string[]; account?: string };

export interface Approver {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export type WalletServiceDeps = {
  vault: Vault;
  accounts: AccountStore;
  permissions: PermissionStore;
  settings: SettingsStore;
  sender: TransactionSender;
  approver: Approver;
  /** Push an accounts-changed event to every page of `origin`. */
  emit: (origin: string, accounts: string[]) => void;
  /** Called on every request: re-arms auto-lock. */
  activity: () => Promise<void>;
};

const MAX_PENDING_PER_ORIGIN = 3;

export class WalletService {
  private readonly pending = new Map<string, number>();

  constructor(private readonly deps: WalletServiceDeps) {}

  async handle(origin: string, raw: unknown): Promise<Response> {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '';
    try {
      const req = parseRequest(raw);
      await this.deps.activity();
      const count = this.pending.get(origin) ?? 0;
      if (count >= MAX_PENDING_PER_ORIGIN) throw new ProtocolError(ERR.BUSY, 'Too many pending requests');
      this.pending.set(origin, count + 1);
      try {
        return { id: req.id, ok: true, result: await this.dispatch(origin, req) };
      } finally {
        this.pending.set(origin, (this.pending.get(origin) ?? 1) - 1);
      }
    } catch (e) {
      return failure(id, e);
    }
  }

  private async dispatch(origin: string, req: Request): Promise<unknown> {
    switch (req.method) {
      case 'connect':
        return this.connect(origin, req.params.silent);
      case 'disconnect':
        await this.deps.permissions.revoke(origin);
        this.deps.emit(origin, []);
        return {};
      default:
        return this.sign(origin, req); // Task 14
    }
  }

  private async connect(origin: string, silent: boolean): Promise<{ accounts: string[] }> {
    const existing = await this.deps.permissions.get(origin);
    if (existing) return { accounts: existing.accounts };
    if (silent) return { accounts: [] };
    const decision = await this.deps.approver.request({ kind: 'connect', origin });
    if (!decision.approved) throw new ProtocolError(ERR.USER_REJECTED, 'User rejected the request');
    const held = new Set((await this.deps.accounts.list()).map((a) => a.address));
    const chosen = decision.accounts ?? [];
    if (chosen.length === 0 || !chosen.every((a) => held.has(a as Address))) throw new ProtocolError(ERR.INTERNAL, 'Invalid account selection');
    await this.deps.permissions.grant(origin, chosen as Address[]);
    this.deps.emit(origin, chosen);
    return { accounts: chosen };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sign(_origin: string, _req: Request): Promise<unknown> {
    throw new ProtocolError(ERR.UNSUPPORTED, 'Not implemented');
  }

  protected async activeChain(): Promise<string> {
    return chainFor((await this.deps.settings.get()).network);
  }
}
```

**Step 5: Run → PASS.** **Step 6: Commit** — `feat(wallet-core): WalletService connect, disconnect, rate limit`

---

### Task 14: `@clef/wallet-core` — `WalletService`: signing flows

**Files:** Modify `packages/wallet-core/src/service.ts`; Test `packages/wallet-core/test/service-sign.test.ts` (+ `sampleWire(feePayer)` helper)

**Step 1: Failing test**
```ts
import { fromBase64, toBase64 } from '@clef/vault';
import { createSignInMessage, verifySignIn } from '@solana/wallet-standard-util';
import { getTransactionDecoder, getBase58Encoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ERR } from '../src';
import { A, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const req = (method: string, params: unknown) => ({ id: 'r', method, params });
const connected = async (decide?: Parameters<typeof setup>[0]) => {
  const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [A] } : decide ? decide(r) : { approved: true }));
  await ctx.service.handle(ORIGIN, req('connect', {}));
  return ctx;
};

describe('WalletService signing', () => {
  it('signs a transaction for a connected account after approval', async () => {
    const { service, approvals } = await connected();
    const wire = sampleWire(A);
    const res = await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [toBase64(wire)] }));
    expect(res.ok).toBe(true);
    const signed = getTransactionDecoder().decode(fromBase64((res as { result: { signedTransactions: string[] } }).result.signedTransactions[0]!));
    expect(signed.signatures[A]).toBeTruthy();
    expect(approvals.at(-1)).toMatchObject({ kind: 'signTransactions', send: false, account: A });
  });

  it('refuses accounts not granted to the origin, wrong chains, and watch-only accounts', async () => {
    const { service, accounts } = await connected();
    const wire = toBase64(sampleWire(A));
    expect(await service.handle('https://other.example', req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [wire] }))).toMatchObject({ error: { code: ERR.UNAUTHORIZED } });
    expect(await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:devnet', transactions: [wire] }))).toMatchObject({ error: { code: ERR.UNSUPPORTED } });
    await accounts.remove(A);
    await accounts.add({ kind: 'watch', address: A, label: 'w' });
    expect(await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [wire] }))).toMatchObject({ error: { code: ERR.UNAUTHORIZED } });
  });

  it('rejection signs nothing', async () => {
    const { service } = await connected(() => ({ approved: false }));
    expect(await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [toBase64(sampleWire(A))] }))).toMatchObject({ error: { code: ERR.USER_REJECTED } });
  });

  it('a locked vault is reported after approval without signing', async () => {
    const { service, vault } = await connected();
    await vault.lock();
    expect(await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [toBase64(sampleWire(A))] }))).toMatchObject({ ok: false });
  });

  it('signAndSend submits the signed wire and returns the signature bytes', async () => {
    const { service, sender } = await connected();
    const res = await service.handle(ORIGIN, req('signAndSendTransaction', { account: A, chain: 'solana:mainnet', transaction: toBase64(sampleWire(A)) }));
    expect(sender.sent).toHaveLength(1);
    expect((res as { result: { signature: string } }).result.signature).toBe(toBase64(new Uint8Array(getBase58Encoder().encode('5sigBase58'))));
  });

  it('signMessage returns the message and a signature', async () => {
    const { service } = await connected();
    const res = await service.handle(ORIGIN, req('signMessage', { account: A, message: toBase64(new TextEncoder().encode('hi')) }));
    expect((res as { result: { signedMessage: string } }).result.signedMessage).toBe(toBase64(new TextEncoder().encode('hi')));
  });

  it('signIn binds the domain to the requesting origin and connects', async () => {
    const { service } = await setup((r) => (r.kind === 'signIn' ? { approved: true, account: A } : { approved: true }));
    const res = await service.handle(ORIGIN, req('signIn', { input: { statement: 'Welcome' } }));
    expect(res.ok).toBe(true);
    const out = (res as { result: { account: string; signedMessage: string; signature: string } }).result;
    expect(new TextDecoder().decode(fromBase64(out.signedMessage))).toContain('dapp.example wants you to sign in');
    expect(verifySignIn({ domain: 'dapp.example', statement: 'Welcome', address: A }, {
      account: { address: A, publicKey: new Uint8Array(getBase58Encoder().encode(A)), chains: [], features: [] },
      signedMessage: fromBase64(out.signedMessage),
      signature: fromBase64(out.signature),
    })).toBe(true);
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [A] } });
  });

  it('signIn refuses a domain that is not the origin', async () => {
    const { service } = await setup(() => ({ approved: true, account: A }));
    expect(await service.handle(ORIGIN, req('signIn', { input: { domain: 'bank.example' } }))).toMatchObject({ error: { code: ERR.INVALID_PARAMS } });
  });
});
```
(`createSignInMessage` import is used by `verifySignIn` internally; remove it if unused.)

**Step 2: Run → FAIL.**

**Step 3: Implement** — replace `sign()` in `service.ts`:
```ts
import { signMessageBytes, signTransactionWire } from '@clef/signers';
import { toBase64 } from '@clef/vault';
import { getBase58Encoder, type Address } from '@solana/kit';
import { createSignInMessage } from '@solana/wallet-standard-util';

  private async signableAccount(origin: string, account: string): Promise<Address> {
    if (!(await this.deps.permissions.allowed(origin, account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account not connected');
    if (!(await this.deps.accounts.canSign(account))) throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return account as Address;
  }

  private async requireChain(chain: string): Promise<void> {
    if (chain !== (await this.activeChain())) throw new ProtocolError(ERR.UNSUPPORTED, 'Wrong network');
  }

  private async withKey<T>(address: Address, fn: (key: Uint8Array) => Promise<T>): Promise<T> {
    const account = await this.deps.accounts.get(address);
    if (!account || account.kind === 'watch') throw new ProtocolError(ERR.UNAUTHORIZED, 'Account cannot sign');
    return this.deps.vault.withPrivateKey(
      { secretId: account.secretId, ...(account.kind === 'hd' && { index: account.index }) },
      async (key, derived) => {
        if (derived !== address) throw new Error('Key mismatch');
        return fn(key);
      },
    );
  }

  private async approve(req: ApprovalRequest): Promise<ApprovalDecision & { approved: true }> {
    const decision = await this.deps.approver.request(req);
    if (!decision.approved) throw new ProtocolError(ERR.USER_REJECTED, 'User rejected the request');
    return decision;
  }

  private async sign(origin: string, req: Request): Promise<unknown> {
    switch (req.method) {
      case 'signTransaction': {
        const { account, chain, transactions } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.requireChain(chain);
        await this.approve({ kind: 'signTransactions', origin, account: address, chain, transactions, send: false });
        const signed = await this.withKey(address, (key) => Promise.all(transactions.map((t) => signTransactionWire(t, address, key))));
        return { signedTransactions: signed.map(toBase64) };
      }
      case 'signAndSendTransaction': {
        const { account, chain, transaction, skipPreflight } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.requireChain(chain);
        await this.approve({ kind: 'signTransactions', origin, account: address, chain, transactions: [transaction], send: true });
        const signed = await this.withKey(address, (key) => signTransactionWire(transaction, address, key));
        const signature = await this.deps.sender.send(signed, { skipPreflight });
        return { signature: toBase64(new Uint8Array(getBase58Encoder().encode(signature))) };
      }
      case 'signMessage': {
        const { account, message } = req.params;
        const address = await this.signableAccount(origin, account);
        await this.approve({ kind: 'signMessage', origin, account: address, message });
        const signature = await this.withKey(address, (key) => signMessageBytes(message, address, key));
        return { signedMessage: toBase64(message), signature: toBase64(new Uint8Array(signature)) };
      }
      case 'signIn': {
        const host = new URL(origin).host;
        const { input } = req.params;
        if (input.domain !== undefined && input.domain !== host) throw new ProtocolError(ERR.INVALID_PARAMS, 'Sign-in domain does not match the requesting site');
        const decision = await this.approve({ kind: 'signIn', origin, account: (input.address as Address | undefined) ?? null, input: { ...input, domain: host } });
        const address = (input.address ?? decision.account) as Address | undefined;
        if (!address || !(await this.deps.accounts.canSign(address))) throw new ProtocolError(ERR.INTERNAL, 'Invalid account selection');
        const message = createSignInMessage({ ...input, domain: host, address });
        const signature = await this.withKey(address, (key) => signMessageBytes(message, address, key));
        await this.deps.permissions.grant(origin, [...new Set([...((await this.deps.permissions.get(origin))?.accounts ?? []), address])]);
        this.deps.emit(origin, (await this.deps.permissions.get(origin))!.accounts);
        return { account: address, signedMessage: toBase64(message), signature: toBase64(new Uint8Array(signature)) };
      }
      default:
        throw new ProtocolError(ERR.UNSUPPORTED, 'Unsupported method');
    }
  }
```
Map vault `LockedError` to a protocol error: in `handle()`'s catch, `if (e instanceof LockedError) return failure(id, new ProtocolError(ERR.UNAUTHORIZED, 'Wallet is locked'))`. (The approval window unlocks before approving — Task 21 — so this only fires if the wallet locked in between.)

**Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): signing flows (transactions, send, message, sign-in)`

---

### Task 15: `@clef/wallet-core` — internal API for extension pages

The popup and approval pages talk to the background through one typed, validated dispatcher. Passwords and mnemonics pass through it, so the background must only accept these calls from extension pages (enforced in Task 17).

**Files:** Create `packages/wallet-core/src/internal.ts`; Test `packages/wallet-core/test/internal.test.ts`

**Step 1: Failing test**
```ts
import { MemoryStore, Vault } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { AccountStore, InternalApi, PermissionStore, SettingsStore } from '../src';
import { ABANDON } from './fixture';

function api() {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore(), { memoryKiB: 1024, iterations: 1, parallelism: 1 });
  return new InternalApi({ vault, accounts: new AccountStore(local), permissions: new PermissionStore(local), settings: new SettingsStore(local), onLock: () => {}, onUnlock: async () => {} });
}

describe('InternalApi', () => {
  it('onboards from a mnemonic and derives the first account', async () => {
    const a = api();
    expect(await a.call({ type: 'state' })).toMatchObject({ hasVault: false });
    await a.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON });
    const state = await a.call({ type: 'state' });
    expect(state).toMatchObject({ hasVault: true, unlocked: true, accounts: [{ address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', kind: 'hd' }] });
  });

  it('adds derived, imported and watch accounts', async () => {
    const a = api();
    await a.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON });
    await a.call({ type: 'accounts:derive' });
    await a.call({ type: 'accounts:watch', address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', label: 'Cold' });
    const { accounts } = (await a.call({ type: 'state' })) as { accounts: { kind: string }[] };
    expect(accounts.map((x) => x.kind)).toEqual(['hd', 'hd', 'watch']);
  });

  it('never returns secrets in state', async () => {
    const a = api();
    await a.call({ type: 'vault:create', password: 'a long password', mnemonic: ABANDON });
    expect(JSON.stringify(await a.call({ type: 'state' }))).not.toContain('abandon');
  });

  it('rejects unknown and malformed calls', async () => {
    await expect(api().call({ type: 'vault:export' })).rejects.toThrow(/unknown/i);
    await expect(api().call({ type: 'vault:unlock' })).rejects.toThrow();
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `internal.ts` — a `switch` over `type` with hand-validated fields:
- `state` → `{ hasVault, unlocked, accounts: Account[] without secretId, settings, permissions }`
- `vault:create { password, mnemonic? }` (no mnemonic → error; the popup generates it with `generateMnemonic()` from `@clef/vault`, shows it, confirms it, then sends it) → creates the vault, adds account index 0 labelled "Account 1", calls `onUnlock()`
- `vault:unlock { password }` → `vault.unlock`, `onUnlock()`; `vault:lock` → `vault.lock()`, `onLock()`
- `accounts:derive` → next index of the first mnemonic secret; label `Account N`
- `accounts:import { secretKey }` → `parseSecretKey` → `vault.addSecret({ kind: 'keypair', privateKey })` → account `imported`; zero the key afterwards
- `accounts:watch { address, label }` → `isAddress` check
- `accounts:rename { address, label }`, `accounts:remove { address }` (remove also strips it from every permission)
- `permissions:revoke { origin }`
- `settings:update { patch }` (only `network`, `rpcUrl`, `autoLockMinutes` keys)

Every string field is type-checked; unknown `type` → `Error('Unknown call')`. Error messages never include inputs.

**Step 4: PASS.** **Step 5: Commit** — `feat(wallet-core): internal API for extension pages`

---

### Task 16: Extension — chrome adapters

**Files:** Create `apps/extension/lib/chrome-store.ts`, `lib/alarm-scheduler.ts`, `lib/approvals.ts`; Test `apps/extension/test/approvals.test.ts`, `apps/extension/test/chrome-store.test.ts`

`chrome-store.ts`:
```ts
import type { KeyValueStore } from '@clef/vault';
import { browser } from 'wxt/browser';

type Area = 'local' | 'session';

export class ChromeStore implements KeyValueStore {
  constructor(private readonly area: Area) {}

  async get<T>(key: string): Promise<T | undefined> {
    const r = await browser.storage[this.area].get(key);
    return r[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await browser.storage[this.area].set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await browser.storage[this.area].remove(key);
  }
}

/** Session storage defaults to trusted contexts in Chrome; assert it so content scripts can never read the session key. */
export async function lockDownSessionStorage(): Promise<void> {
  await browser.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}
```

`alarm-scheduler.ts` (MV3 service workers die; `setTimeout` is unreliable — use `chrome.alarms`):
```ts
import type { LockScheduler } from '@clef/wallet-core';
import { browser } from 'wxt/browser';

const NAME = 'clef-autolock';

export class AlarmScheduler implements LockScheduler {
  private onFire: (() => void) | null = null;

  constructor() {
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === NAME) this.onFire?.();
    });
  }

  schedule(minutes: number, onFire: () => void): void {
    this.onFire = onFire;
    void browser.alarms.create(NAME, { delayInMinutes: Math.max(0.5, minutes) });
  }

  cancel(): void {
    this.onFire = null;
    void browser.alarms.clear(NAME);
  }

  /** After a service-worker restart the alarm still exists; re-attach the handler. */
  attach(onFire: () => void): void {
    this.onFire = onFire;
  }
}
```

`approvals.ts` — a queue that the background owns; the approval page fetches and decides by id:
```ts
import type { ApprovalDecision, ApprovalRequest, Approver } from '@clef/wallet-core';

type Pending = { id: string; request: ApprovalRequest; resolve: (d: ApprovalDecision) => void; windowId?: number };

export class ApprovalQueue implements Approver {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly open: (id: string) => Promise<number | undefined>, private readonly close: (windowId: number) => void) {}

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const entry: Pending = { id, request, resolve };
      this.pending.set(id, entry);
      void this.open(id).then((windowId) => {
        entry.windowId = windowId;
      }, () => this.decide(id, { approved: false }));
    });
  }

  get(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)?.request;
  }

  decide(id: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(decision);
    if (entry.windowId !== undefined) this.close(entry.windowId);
  }

  /** Closing the window without deciding is a rejection. */
  windowClosed(windowId: number): void {
    for (const e of this.pending.values()) if (e.windowId === windowId) this.decide(e.id, { approved: false });
  }
}
```

Tests (`approvals.test.ts`): request → `open` called with an id → `get(id)` returns the request → `decide(id, …)` resolves the promise and calls `close`; `windowClosed` rejects; deciding twice is a no-op; `open` failure rejects. `chrome-store.test.ts`: use `fakeBrowser` from `wxt/testing/fake-browser` (configure Vitest for this one file with the `WxtVitest()` plugin via `apps/extension/vitest.config.ts`, and add that config to a root `vitest.workspace`/`projects` entry, or call `fakeBrowser` directly if the plugin is not needed) — set/get/remove round-trip on `local` and `session`.

**Commit** — `feat(extension): chrome storage, alarm scheduler and approval queue`

---

### Task 17: Extension — background wiring

**Files:** Replace `apps/extension/entrypoints/background.ts`; Create `apps/extension/lib/messages.ts` (shared port/message names and types)

`lib/messages.ts`:
```ts
export const DAPP_PORT = 'clef-dapp';
export type DappEnvelope = { type: 'request'; request: unknown } | { type: 'response'; response: unknown } | { type: 'event'; accounts: string[] };
export type InternalEnvelope = { channel: 'internal'; call: unknown } | { channel: 'approval'; op: 'get' | 'decide'; id: string; decision?: unknown };
```

`entrypoints/background.ts` — responsibilities, in this order:
1. `lockDownSessionStorage()`.
2. Build `ChromeStore('local')`, `ChromeStore('session')`, `Vault`, `AccountStore`, `PermissionStore`, `SettingsStore`.
3. `KitChainReader` as the sender, rebuilt whenever settings change (read settings per send: `new KitChainReader((await settings.get()).rpcUrl)`).
4. `ApprovalQueue` with `open = (id) => browser.windows.create({ url: browser.runtime.getURL(`/approval.html?id=${id}`), type: 'popup', width: 400, height: 640, focused: true }).then((w) => w.id)` and `close = (wid) => browser.windows.remove(wid)`; `browser.windows.onRemoved.addListener((wid) => queue.windowClosed(wid))`.
5. `AutoLock(new AlarmScheduler(), () => vault.lock(), async () => (await settings.get()).autoLockMinutes)`; on startup `scheduler.attach(() => void vault.lock())`.
6. `WalletService` with `emit = (origin, accounts) => for each connected port whose origin === origin: port.postMessage({ type: 'event', accounts })`.
7. **dApp ports:** `browser.runtime.onConnect.addListener((port) => { … })`:
   - accept only `port.name === DAPP_PORT`;
   - **origin = `port.sender?.origin`**; reject (disconnect) if missing, if not `https:` (allow `http://localhost` / `http://127.0.0.1` for development), or if `port.sender.url` starts with the extension's own URL;
   - track ports per origin; on message `{ type: 'request', request }` → `service.handle(origin, request)` → `port.postMessage({ type: 'response', response })`;
   - remove the port on disconnect.
8. **Internal messages:** `browser.runtime.onMessage.addListener((msg, sender) => …)`:
   - accept only if `sender.id === browser.runtime.id` **and** `sender.url?.startsWith(browser.runtime.getURL('/'))` (content scripts share `sender.id`; the URL check excludes them);
   - `channel: 'internal'` → `internalApi.call(msg.call)`; each call `autoLock.touch()`;
   - `channel: 'approval'`, `op: 'get'` → `queue.get(id)` serialized (bytes → base64); `op: 'decide'` → validate the decision shape (`approved` boolean; `accounts`/`account` arrays/strings of addresses) → `queue.decide`;
   - return a Promise (WXT's `browser` polyfill supports promise-returning listeners); errors → `{ error: 'message' }` with a fixed generic text for unexpected errors.

No unit test for the entrypoint itself (it is glue); it is covered by the Playwright test (Task 22). Run `pnpm build:ext` and `pnpm typecheck`.

**Commit** — `feat(extension): background service wiring`

---

### Task 18: Extension — in-page Wallet Standard wallet

**Files:** Create `apps/extension/lib/clef-wallet.ts`, `apps/extension/lib/icon.ts`, `apps/extension/entrypoints/inpage.content.ts`; Test `apps/extension/test/clef-wallet.test.ts`

The wallet object lives in the page's MAIN world. It talks to the ISOLATED relay through `window.postMessage` with a per-load random channel tag, and converts bytes ↔ base64.

`lib/clef-wallet.ts` (core shape):
```ts
import { ReadonlyWalletAccount } from '@wallet-standard/wallet';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardEventsListeners } from '@wallet-standard/features';
import { SolanaSignAndSendTransaction, SolanaSignIn, SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features';
import { getBase58Encoder } from '@solana/kit';
import { ICON } from './icon';

export interface Bridge {
  request(method: string, params: unknown): Promise<unknown>;
  onEvent(cb: (accounts: string[]) => void): void;
}

const CHAINS = ['solana:mainnet', 'solana:devnet'] as const;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class ClefWallet implements Wallet {
  readonly version = '1.0.0' as const;
  readonly name = 'Clef';
  readonly icon = ICON;
  readonly chains = CHAINS;
  #accounts: WalletAccount[] = [];
  #listeners: { [E in keyof StandardEventsListeners]?: StandardEventsListeners[E][] } = {};

  constructor(private readonly bridge: Bridge) {
    bridge.onEvent((addresses) => this.#setAccounts(addresses));
  }

  get accounts() {
    return this.#accounts.slice();
  }

  get features() {
    return {
      [StandardConnect]: { version: '1.0.0', connect: this.#connect },
      [StandardDisconnect]: { version: '1.0.0', disconnect: this.#disconnect },
      [StandardEvents]: { version: '1.0.0', on: this.#on },
      [SolanaSignTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0, 1], signTransaction: this.#signTransaction },
      [SolanaSignAndSendTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0, 1], signAndSendTransaction: this.#signAndSend },
      [SolanaSignMessage]: { version: '1.1.0', signMessage: this.#signMessage },
      [SolanaSignIn]: { version: '1.0.0', signIn: this.#signIn },
    } as const;
  }

  #account(address: string): WalletAccount {
    return new ReadonlyWalletAccount({
      address,
      publicKey: new Uint8Array(getBase58Encoder().encode(address)),
      chains: CHAINS,
      features: [SolanaSignTransaction, SolanaSignAndSendTransaction, SolanaSignMessage, SolanaSignIn],
    });
  }

  #setAccounts(addresses: string[]) {
    this.#accounts = addresses.map((a) => this.#account(a));
    for (const l of this.#listeners.change ?? []) l({ accounts: this.accounts });
  }

  #connect = async ({ silent }: { silent?: boolean } = {}) => {
    const { accounts } = (await this.bridge.request('connect', { silent: !!silent })) as { accounts: string[] };
    this.#setAccounts(accounts);
    return { accounts: this.accounts };
  };
  // #disconnect, #on (returns an unsubscribe fn), #signTransaction (batch: one request with all
  // transactions for the same account+chain, preserving input order; chain defaults to the
  // account's first chain when absent), #signAndSend (one input at a time), #signMessage, #signIn —
  // each converts Uint8Array <-> base64 and maps the result to the feature's output type.
}
```
Implement every method fully (the comment lists what to write; keep each under ~15 lines). Errors from the bridge become `Error` objects with `code` and `message` properties (e.g. `Object.assign(new Error(message), { code })`), so wallet adapters can recognise 4001.

`lib/icon.ts`: `export const ICON = 'data:image/svg+xml;base64,…' as const;` — a simple 128×128 SVG (a treble clef glyph or a "C"), base64-encoded, ASCII only.

`entrypoints/inpage.content.ts`:
```ts
import { registerWallet } from '@wallet-standard/wallet';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { ClefWallet } from '../lib/clef-wallet';
import { pageBridge } from '../lib/page-bridge';

export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    registerWallet(new ClefWallet(pageBridge()));
  },
});
```

`lib/page-bridge.ts`: posts `{ source: 'clef-inpage', id, method, params }` with `window.postMessage(msg, window.location.origin)`; listens for `{ source: 'clef-relay', id, response }` / `{ source: 'clef-relay', event }` where `event.source === window`; resolves pending promises by id; ignores anything else.

**Test** (`clef-wallet.test.ts`, Node environment, fake `Bridge`):
- `connect` → bridge called with `('connect', { silent: false })`, accounts become `ReadonlyWalletAccount`s with the right `publicKey` bytes, `change` listeners fire;
- `signTransaction` with two inputs for one account → one bridge call with both base64 transactions in order, outputs mapped back to `Uint8Array`;
- `signMessage` round-trip; `signIn` returns `account` as a `WalletAccount`;
- a bridge rejection `{ code: 4001 }` surfaces as an Error with `code === 4001`;
- `on('change', cb)` returns an unsubscribe that works.

**Commit** — `feat(extension): Wallet Standard wallet in the page`

---

### Task 19: Extension — relay content script

**Files:** Create `apps/extension/entrypoints/relay.content.ts`

```ts
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DAPP_PORT } from '../lib/messages';

export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_start',
  main() {
    let port: ReturnType<typeof browser.runtime.connect> | null = null;
    const connect = () => {
      port = browser.runtime.connect({ name: DAPP_PORT });
      port.onMessage.addListener((msg: { type: string; response?: unknown; accounts?: string[] }) => {
        if (msg.type === 'response') window.postMessage({ source: 'clef-relay', response: msg.response }, window.location.origin);
        if (msg.type === 'event') window.postMessage({ source: 'clef-relay', event: { accounts: msg.accounts } }, window.location.origin);
      });
      port.onDisconnect.addListener(() => {
        port = null; // MV3 service worker restarted; reconnect lazily on next request
      });
    };
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; id?: unknown; method?: unknown; params?: unknown };
      if (data?.source !== 'clef-inpage' || typeof data.id !== 'string') return;
      if (!port) connect();
      port!.postMessage({ type: 'request', request: { id: data.id, method: data.method, params: data.params } });
    });
  },
});
```
The background responds with the request id inside `response`, so the page bridge matches it. If the service worker restarts mid-request, the page receives no response: the page bridge times out pending requests after 10 minutes (approvals can take a while) with code `4900` "Disconnected".

Build and typecheck. **Commit** — `feat(extension): relay content script`

---

### Task 20: Extension — popup UI

**Files:** Create `apps/extension/entrypoints/popup/index.html`, `main.tsx`, `App.tsx`, `apps/extension/lib/api.ts`, `apps/extension/assets/tailwind.css` (`@import "tailwindcss";`), and components under `apps/extension/components/`.

`lib/api.ts`: `export async function call<T>(c: object): Promise<T>` → `browser.runtime.sendMessage({ channel: 'internal', call: c })`, throws on `{ error }`.

Screens (React state machine driven by `state` from the background, polled on focus):
1. **Welcome** (no vault): "Create a new wallet" / "Import a recovery phrase".
2. **Create**: generate a 12-word phrase with `generateMnemonic()` (import from `@clef/vault`; it runs in the extension page), show it in a 3×4 grid with a "I have written it down" checkbox, then a confirmation step asking for 3 random word positions, then password + confirm (min 8, show strength hint) → `vault:create`.
3. **Import**: textarea for the phrase (`validateMnemonic` live feedback), password + confirm → `vault:create`.
4. **Unlock** (vault exists, locked): password field → `vault:unlock`; wrong password shows "Wrong password".
5. **Home**: network badge, account list (label, short address, copy button, kind badge: HD / Imported / Watch), buttons "New account" (`accounts:derive`), "Import private key", "Add watch address", "Lock".
6. **Settings**: network (mainnet/devnet), RPC URL, auto-lock minutes, connected sites with "Disconnect" (`permissions:revoke`).

Rules: never put the mnemonic in any storage or URL; clear React state holding it after create; inputs `autoComplete="off"`, `spellCheck={false}`; the popup is 360×600.

Verification: `pnpm build:ext`, load `apps/extension/.output/chrome-mv3` in Chrome (`chrome://extensions` → Developer mode → Load unpacked) and click through create → lock → unlock → derive → settings. Record what you did in the commit body.

**Commit** — `feat(extension): popup onboarding, unlock, accounts and settings`

---

### Task 21: Extension — approval page

**Files:** Create `apps/extension/entrypoints/approval/index.html`, `main.tsx`, `Approval.tsx`, components `TxReview.tsx`, `MessageReview.tsx`, `ConnectReview.tsx`, `Unlock.tsx`.

Flow:
1. Read `id` from `location.search`; `browser.runtime.sendMessage({ channel: 'approval', op: 'get', id })` → the serialized `ApprovalRequest` (bytes as base64). Unknown id → "This request is no longer pending" and a Close button.
2. If the vault is locked (`state.unlocked === false`) → show **Unlock** first (password → `vault:unlock`), then continue. Approving is impossible while locked.
3. Header: the requesting **origin** (from the request, which the background took from the port sender), shown prominently with its scheme and host; the account label + short address.
4. By kind:
   - **connect**: checkbox list of signable accounts (first one pre-selected); Approve sends `{ approved: true, accounts }`.
   - **signTransactions**: for each transaction run M1's engine in this page:
     ```ts
     const settings = state.settings;
     const reader = new KitChainReader(settings.rpcUrl);
     const ctx = defaultExplainContext(reader, [account], labelsFromAccounts(state.accounts));
     const ex = await explain({ wire }, ctx);
     const view = viewFor(ex, 'basic');
     ```
     Render: the summary (large), warnings sorted danger → warn → info (danger in red with a "DANGER" label), "Your balance changes" (or "unknown — simulation unavailable" when null), the network fee when present, and a "Show details" toggle that renders the intermediate view's instruction list (program, instruction name, accounts with labels and badges) — the full UI polish is M3. Explanation errors render as a danger "Clef could not explain this transaction" (fail closed).
     If `send` is true, the button reads "Approve and send".
   - **signMessage**: `inspectMessage(message, origin)` (from `@clef/wallet-core`) → SIWS fields table / text (monospace, preserving newlines) / hex; `danger` → red banner ("This message is a transaction" or "This sign-in request is for a different site").
   - **signIn**: show the domain (= origin host), statement, and account picker if no address was requested.
5. **Danger acknowledgement:** if any danger is shown, Approve stays disabled until "I understand the risks" is ticked.
6. Buttons: Reject (always enabled) and Approve. Decide → `{ channel: 'approval', op: 'decide', id, decision }` → `window.close()`.
7. The page never re-reads the request from the URL or the page; only from the background by id.

Verification: `pnpm build:ext`; manual run against a test dApp (Task 22's page works in a normal browser too). Commit body lists what was clicked.

**Commit** — `feat(extension): approval window with explanation and danger acknowledgement`

---

### Task 22: End-to-end test with Playwright

**Files:** Create `e2e/clef.spec.ts`, `e2e/dapp/index.html`, `e2e/fixtures.ts`, `playwright.config.ts`; root script `"e2e": "pnpm build:ext && playwright test"`

`playwright.config.ts`: `testDir: 'e2e'`, `timeout: 60_000`, `workers: 1`, `use: { trace: 'retain-on-failure' }`.

`e2e/fixtures.ts`: a Playwright fixture that
- starts a local HTTP server (Node `http`) on a random port serving `e2e/dapp/index.html`, and a stub JSON-RPC endpoint at `/rpc` that answers every method with `{"jsonrpc":"2.0","id":…,"error":{"code":-32601,"message":"stub"}}` (the explanation then degrades with issues — that is fine and itself tested);
- launches `chromium.launchPersistentContext('', { headless: true, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] })` with `ext = apps/extension/.output/chrome-mv3`;
- finds the extension id from the service worker URL (`context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')`).

`e2e/dapp/index.html`: plain HTML + inline module script implementing the Wallet Standard **app** side without dependencies:
```js
const wallets = [];
const api = { register: (...ws) => { wallets.push(...ws); return () => {}; } };
window.addEventListener('wallet-standard:register-wallet', (e) => e.detail(api));
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
window.clef = () => wallets.find((w) => w.name === 'Clef');
```
plus a helper `window.verify = async (pub, sig, msg) => crypto.subtle.verify('Ed25519', await crypto.subtle.importKey('raw', pub, 'Ed25519', false, ['verify']), sig, msg)`.

`e2e/clef.spec.ts` — one serial test:
1. Open `chrome-extension://<id>/popup.html`; import `abandon … about` with password `a long password`; set the RPC URL to the stub server's `/rpc`; assert the account `HAgk14…KpqK` is listed.
2. Open the dApp page (`http://127.0.0.1:<port>/`); `await page.evaluate(() => !!window.clef())` → true.
3. `connect`: start `page.evaluate(() => clef().features['standard:connect'].connect())`, wait for the approval page (`context.waitForEvent('page')` whose URL contains `approval.html`), click Approve, assert the dApp got one account `HAgk14…KpqK`.
4. `signMessage('hello')`: approve → `window.verify(account.publicKey, signature, message)` is true.
5. `signTransaction` of a System transfer built in the page from base64 constant bytes (pre-build the wire in the test with kit and pass it in via `evaluate` args): approval shows a summary or a fail-closed danger (stub RPC); tick the acknowledgement if present; approve; decode the result in Node with kit and `verifySignature`.
6. Reject path: start another `signMessage`, close the approval window → the promise rejects with code 4001.
7. Lock from the popup; a new `signMessage` opens the approval page showing the Unlock form.
8. Disconnect from the popup's settings → the dApp's `change` listener receives `accounts: []`.

Run: `pnpm e2e` → 1 passed. If headless extension loading fails in this environment, run headed (`headless: false`, drop `--headless=new`) and note it.

**Commit** — `test(e2e): connect, sign, reject, lock and disconnect against the built extension`

---

### Task 23: Final verification

1. `pnpm test` — all unit tests (M1 + M2) pass.
2. `pnpm typecheck` — exit 0 (root + extension).
3. `pnpm e2e` — passes.
4. ASCII check over `packages/*/src`, `apps/*/src`, `apps/extension/{entrypoints,lib,components}`, `e2e`.
5. Manual checklist in Chrome with the unpacked build, written into the PR/merge description:
   - create wallet → write down → confirm → lock → unlock;
   - kill the service worker (`chrome://serviceworker-internals` → Stop) → the wallet stays unlocked until auto-lock;
   - set auto-lock to 1 minute → wait → locked;
   - connect from a real dApp on devnet (e.g. a Wallet Standard sample app), sign a message and a devnet transfer;
   - `chrome.storage.local` (DevTools → Application) contains only the encrypted envelope, accounts, permissions and settings — no phrase, no key.
6. Use superpowers:requesting-code-review, then superpowers:finishing-a-development-branch.

---

## Out of scope for M2

- Ledger / Keystone / Squads accounts (M4, M5, M9).
- The full approval UI with Intermediate/Expert views, graph, settings for detail level (M3).
- Portfolio, send, swap, history (M6–M8).
- IndexedDB IDL cache and prices in the approval page (M3).
- Firefox build.
- Iframe-embedded dApps (content scripts run in the top frame only).
- Phishing list.
