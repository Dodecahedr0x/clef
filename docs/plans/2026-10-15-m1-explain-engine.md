# Milestone 1 — Explain Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the `@clef/rpc`, `@clef/idl` and `@clef/explain` packages plus a `clef` CLI that explains any Solana transaction (by signature or raw base64) at Basic / Intermediate / Expert detail, with IDL-derived names and *verified* account relationships (PDA seeds, Anchor `has_one`, token ownership).

**Architecture:** A pure-TypeScript pipeline: decode wire tx (resolving lookup tables) → resolve IDLs per program through a prioritized source chain (user → bundled → Program Metadata → on-chain Anchor), all normalized to Codama `RootNode`s → identify/decode instructions with `@codama/dynamic-parsers` → verify relationships → balance changes (from tx meta or simulation) → risk rules → summary. All chain access goes through a tiny `ChainReader` interface so tests run offline from recorded fixtures. Detail levels are pure *views* over one `ExplainedTransaction`.

**Tech Stack:** pnpm workspaces, TypeScript 5 (strict), Vitest, tsx, `@solana/kit` 8.x, Codama (`@codama/nodes`, `@codama/nodes-from-anchor`, `@codama/dynamic-parsers`, `@codama/dynamic-codecs`, `@codama/visitors-core`), `@solana-program/token`, `@solana-program/program-metadata`, `fflate`.

**Design doc:** `docs/plans/2026-10-15-clef-wallet-design.md` (section 2 is this milestone).

---

## Facts verified before writing this plan (2026-10-15)

These were checked against installed packages — trust them over memory:

- `parseInstruction(root, instruction)` from `@codama/dynamic-parsers` returns `{ data, path, accounts: (AccountMeta & { name })[], remainingAccounts }` or `undefined`. `data` includes a `discriminator` field.
- `rootNodeFromAnchor(idl)` (from `@codama/nodes-from-anchor`) **drops Anchor `relations`** (has_one) and **skips PDAs whose seeds use nested paths** (`"path": "pool.mint"`). That is why `@clef/idl` keeps `anchorExtras` extracted from the raw Anchor JSON.
- PDA re-derivation from Codama works with `getNodeCodecVisitor` / `getValueNodeVisitor` (from `@codama/dynamic-codecs`) + `LinkableDictionary` / `getRecordLinkablesVisitor` / `visit` (from `@codama/visitors-core`). Tested: matches `findAssociatedTokenPda` exactly.
- Official Codama IDLs live at `https://raw.githubusercontent.com/solana-program/<repo>/main/idl.json` for `system`, `token`, `token-2022`, `associated-token-account`, `compute-budget`, `memo`.
- Native instruction names: System `transferSol(source, destination; amount)`, `assign(account; programAddress)`, `assignWithSeed`, `advanceNonceAccount(nonceAccount, …)`. Token `transfer(source, destination, authority; amount)`, `transferChecked(source, mint, destination, authority; amount, decimals)`, `approve(source, delegate, owner; amount)`, `approveChecked`, `setAuthority(owned, owner; authorityType, newAuthority)`, `closeAccount(account, destination, owner)`. Compute budget `setComputeUnitLimit(units)`, `setComputeUnitPrice(microLamports)`.
- Program Metadata: `findMetadataPda({ program, authority: null, seed: 'idl' })`, `getMetadataDecoder()` → `{ dataSource, compression, encoding, dataLength, data, … }`, `DataSource.{Direct,Url,External}`, `unpackDirectData`, `unpackAndFetchUrlData`, `packDirectData`, `getMetadataEncoder`, `Format`.
- Kit: `getTransactionDecoder`, `getCompiledTransactionMessageDecoder` (message has `version`, `header.{numSignerAccounts,numReadonlySignerAccounts,numReadonlyNonSignerAccounts}`, `staticAccounts`, `instructions[].{programAddressIndex,accountIndices,data}`, `addressTableLookups[].{lookupTableAddress,writableIndexes,readonlyIndexes}`, `lifetimeToken`), `createAddressWithSeed`, `getProgramDerivedAddress`, `getAddressEncoder/Decoder`, `getBase64Encoder/Decoder`.
- Kit also decodes a `version: 1` message type; we explicitly reject it in M1.

If a call doesn't typecheck exactly as written, read the package's `.d.ts` and adapt the call — don't change the design.

## Conventions

- All commands run from the worktree root: `/Users/dode/Documents/solana/clef/.worktrees/m1-explain-engine`.
- Run one test file: `pnpm vitest run <path>`. Full suite: `pnpm test`. Types: `pnpm typecheck`.
- Workspace packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`) — no build step in M1.
- Tests that hit a real RPC are gated: `describe.skipIf(!process.env.CLEF_LIVE_RPC)`.
- Commit after every task with the message given.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/rpc/package.json`, `packages/idl/package.json`, `packages/explain/package.json`, `apps/cli/package.json`
- Create: `packages/rpc/src/index.ts`, `packages/rpc/test/smoke.test.ts`

**Step 1: Write root config**

`package.json`:
```json
{
  "name": "clef",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.4",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "clef": "tsx apps/cli/src/main.ts"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["packages/*/src", "packages/*/test", "apps/*/src", "apps/*/test", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'] },
});
```

**Step 2: Write package manifests**

Each of the four manifests follows this shape (swap the name):
```json
{
  "name": "@clef/rpc",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
Names: `@clef/rpc` (packages/rpc), `@clef/idl` (packages/idl), `@clef/explain` (packages/explain), `@clef/cli` (apps/cli).

**Step 3: Install dependencies**

```bash
pnpm add -Dw typescript vitest tsx @types/node
pnpm add --filter @clef/rpc @solana/kit
pnpm add --filter @clef/idl @solana/kit @codama/nodes @codama/nodes-from-anchor @solana-program/program-metadata fflate "@clef/rpc@workspace:*"
pnpm add --filter @clef/explain @solana/kit @codama/nodes @codama/visitors-core @codama/dynamic-parsers @codama/dynamic-codecs @solana-program/token "@clef/rpc@workspace:*" "@clef/idl@workspace:*"
pnpm add -D --filter @clef/explain @solana-program/system @solana-program/compute-budget
pnpm add --filter @clef/cli @solana/kit "@clef/rpc@workspace:*" "@clef/idl@workspace:*" "@clef/explain@workspace:*"
```

**Step 4: Smoke test**

`packages/rpc/src/index.ts`:
```ts
export {};
```

`packages/rpc/test/smoke.test.ts`:
```ts
import { expect, it } from 'vitest';

it('runs', () => {
  expect(1 + 1).toBe(2);
});
```

Run: `pnpm test` → Expected: 1 passed. Run: `pnpm typecheck` → Expected: no output, exit 0.

**Step 5: Commit**
```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with vitest"
```

---

### Task 2: `@clef/rpc` — types and JSON (de)serialization

Fixtures must store `bigint` and `Uint8Array` losslessly.

**Files:**
- Create: `packages/rpc/src/types.ts`, `packages/rpc/src/serde.ts`
- Modify: `packages/rpc/src/index.ts`
- Test: `packages/rpc/test/serde.test.ts` (delete `smoke.test.ts`)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { fromJson, toJson } from '../src/serde';

describe('serde', () => {
  it('round-trips bigint and bytes', () => {
    const value = { a: 1n << 70n, b: new Uint8Array([0, 1, 255]), c: [{ d: -5n }], e: 'x', f: null };
    expect(fromJson(toJson(value))).toEqual(value);
  });

  it('is deterministic for identical input', () => {
    expect(toJson({ x: [1n] })).toBe(toJson({ x: [1n] }));
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/rpc/test/serde.test.ts` → Expected: FAIL, cannot resolve `../src/serde`.

**Step 3: Implement**

`packages/rpc/src/types.ts`:
```ts
import type { Address } from '@solana/kit';

export type RawAccount = {
  address: Address;
  owner: Address;
  lamports: bigint;
  data: Uint8Array;
  executable: boolean;
};

export type TokenBalance = {
  accountIndex: number;
  mint: Address;
  owner: Address | null;
  amount: bigint;
  decimals: number;
};

export type TxMeta = {
  err: unknown;
  fee: bigint;
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  loadedAddresses: { writable: Address[]; readonly: Address[] };
  logMessages: string[];
};

export type FetchedTransaction = {
  wire: Uint8Array;
  meta: TxMeta | null;
  slot: bigint;
  blockTime: bigint | null;
};

export type SimulationResult = {
  err: unknown;
  logs: string[];
  unitsConsumed: bigint | null;
  /** Post-simulation state, same order as the `addresses` passed to `simulate`. */
  postAccounts: (RawAccount | null)[];
};

/** Every chain read the engine performs goes through this interface (live, recorded, or replayed). */
export interface ChainReader {
  getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
  simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult>;
}
```

`packages/rpc/src/serde.ts`:
```ts
import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

const BIGINT = '$bigint';
const BYTES = '$bytes';

export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) => {
      if (typeof v === 'bigint') return { [BIGINT]: v.toString() };
      if (v instanceof Uint8Array) return { [BYTES]: getBase64Decoder().decode(v) };
      return v;
    },
    space,
  );
}

export function fromJson(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === BIGINT) return BigInt((v as Record<string, string>)[BIGINT]!);
      if (keys.length === 1 && keys[0] === BYTES) {
        return new Uint8Array(getBase64Encoder().encode((v as Record<string, string>)[BYTES]!));
      }
    }
    return v;
  });
}
```

`packages/rpc/src/index.ts`:
```ts
export * from './types';
export * from './serde';
```

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/rpc/test/serde.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git rm -q packages/rpc/test/smoke.test.ts
git add -A && git commit -m "feat(rpc): ChainReader types and lossless JSON serde"
```

---

### Task 3: `@clef/rpc` — Memory, Recording and Fixture readers

**Files:**
- Create: `packages/rpc/src/memory.ts`, `packages/rpc/src/fixture.ts`
- Modify: `packages/rpc/src/index.ts`
- Test: `packages/rpc/test/fixture.test.ts`

**Step 1: Write the failing test**

```ts
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { FixtureChainReader, MemoryChainReader, RecordingChainReader } from '../src';

const A = address('So11111111111111111111111111111111111111112');
const B = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

describe('fixture readers', () => {
  it('memory reader returns stored accounts and null for unknown ones', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, lamports: 5n, data: new Uint8Array([1, 2]) });
    const [a, b] = await mem.getAccounts([A, B]);
    expect(a?.data).toEqual(new Uint8Array([1, 2]));
    expect(a?.executable).toBe(false);
    expect(b).toBeNull();
  });

  it('replays exactly what was recorded and fails loudly on a miss', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, lamports: 5n, data: new Uint8Array([1, 2]) });
    const rec = new RecordingChainReader(mem);
    const live = await rec.getAccounts([A, B]);

    const fixture = rec.toFixture({ note: 'test' });
    const replay = FixtureChainReader.fromJson(fixture);
    expect(await replay.getAccounts([A, B])).toEqual(live);
    expect(replay.input).toEqual({ note: 'test' });
    await expect(replay.getAccounts([B])).rejects.toThrow(/fixture miss/);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/rpc/test/fixture.test.ts` → Expected: FAIL, exports missing.

**Step 3: Implement**

`packages/rpc/src/memory.ts`:
```ts
import type { Address } from '@solana/kit';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult } from './types';

type AccountInput = Omit<RawAccount, 'executable' | 'lamports'> & Partial<Pick<RawAccount, 'executable' | 'lamports'>>;

/** In-memory chain for unit tests. Simulation defaults to "nothing changes". */
export class MemoryChainReader implements ChainReader {
  readonly accounts = new Map<string, RawAccount>();
  readonly transactions = new Map<string, FetchedTransaction>();
  simulateImpl: (wire: Uint8Array, addresses: readonly Address[]) => Promise<SimulationResult> = async (
    _wire,
    addresses,
  ) => ({
    err: null,
    logs: [],
    unitsConsumed: null,
    postAccounts: addresses.map((a) => this.accounts.get(a) ?? null),
  });

  setAccount(input: AccountInput): void {
    this.accounts.set(input.address, { lamports: 1_000_000n, executable: false, ...input });
  }

  async getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]> {
    return addresses.map((a) => this.accounts.get(a) ?? null);
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    return this.transactions.get(signature) ?? null;
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult> {
    return this.simulateImpl(wire, addresses);
  }
}
```

`packages/rpc/src/fixture.ts`:
```ts
import type { Address } from '@solana/kit';
import { fromJson, toJson } from './serde';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult } from './types';

export type FixtureFile = { version: 1; input?: unknown; calls: Record<string, unknown> };

export function callKey(method: string, args: unknown[]): string {
  return `${method}:${toJson(args)}`;
}

/** Wraps a live reader and remembers every response so it can be replayed offline. */
export class RecordingChainReader implements ChainReader {
  readonly calls: Record<string, unknown> = {};

  constructor(private readonly inner: ChainReader) {}

  private async record<T>(method: string, args: unknown[], run: () => Promise<T>): Promise<T> {
    const result = await run();
    this.calls[callKey(method, args)] = result;
    return result;
  }

  getAccounts(addresses: readonly Address[]) {
    return this.record('getAccounts', [addresses], () => this.inner.getAccounts(addresses));
  }

  getTransaction(signature: string) {
    return this.record('getTransaction', [signature], () => this.inner.getTransaction(signature));
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]) {
    return this.record('simulate', [wire, addresses], () => this.inner.simulate(wire, addresses));
  }

  toFixture(input?: unknown): string {
    const file: FixtureFile = { version: 1, input, calls: this.calls };
    return toJson(file, 1);
  }
}

/** Replays a recorded fixture; any request that was not recorded throws. */
export class FixtureChainReader implements ChainReader {
  constructor(private readonly fixture: FixtureFile) {}

  static fromJson(text: string): FixtureChainReader {
    return new FixtureChainReader(fromJson(text) as FixtureFile);
  }

  get input(): unknown {
    return this.fixture.input;
  }

  private lookup<T>(method: string, args: unknown[]): Promise<T> {
    const key = callKey(method, args);
    if (!(key in this.fixture.calls)) {
      return Promise.reject(new Error(`fixture miss: ${key.slice(0, 200)}`));
    }
    return Promise.resolve(this.fixture.calls[key] as T);
  }

  getAccounts(addresses: readonly Address[]) {
    return this.lookup<(RawAccount | null)[]>('getAccounts', [addresses]);
  }

  getTransaction(signature: string) {
    return this.lookup<FetchedTransaction | null>('getTransaction', [signature]);
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]) {
    return this.lookup<SimulationResult>('simulate', [wire, addresses]);
  }
}
```

Append to `packages/rpc/src/index.ts`:
```ts
export * from './memory';
export * from './fixture';
```

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/rpc/test/fixture.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(rpc): memory, recording and fixture chain readers"
```

---

### Task 4: `@clef/rpc` — live `KitChainReader`

**Files:**
- Create: `packages/rpc/src/kit.ts`
- Modify: `packages/rpc/src/index.ts`
- Test: `packages/rpc/test/kit.live.test.ts`

**Step 1: Write the (gated) test**

```ts
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { KitChainReader } from '../src';

describe.skipIf(!process.env.CLEF_LIVE_RPC)('KitChainReader (live)', () => {
  const reader = new KitChainReader(process.env.CLEF_LIVE_RPC ?? '');

  it('fetches the USDC mint', async () => {
    const usdc = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const [mint] = await reader.getAccounts([usdc]);
    expect(mint?.owner).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(mint?.data.length).toBe(82);
  });
});
```

**Step 2: Run without the env var**
Run: `pnpm vitest run packages/rpc/test/kit.live.test.ts` → Expected: FAIL (import of `KitChainReader` missing). After implementing, it should report "skipped" without the env var.

**Step 3: Implement**

`packages/rpc/src/kit.ts`:
```ts
import {
  createSolanaRpc,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedWireTransaction,
  type Signature,
} from '@solana/kit';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult, TokenBalance } from './types';

const MAX_ACCOUNTS_PER_CALL = 100;

type EncodedAccount = { data: readonly [string, string]; owner: Address; lamports: bigint | number; executable: boolean };

function toRaw(address: Address, acc: EncodedAccount): RawAccount {
  return {
    address,
    owner: acc.owner,
    lamports: BigInt(acc.lamports),
    data: new Uint8Array(getBase64Encoder().encode(acc.data[0])),
    executable: acc.executable,
  };
}

type RpcTokenBalance = {
  accountIndex: number;
  mint: Address;
  owner?: Address;
  uiTokenAmount: { amount: string; decimals: number };
};

function toTokenBalance(t: RpcTokenBalance): TokenBalance {
  return {
    accountIndex: t.accountIndex,
    mint: t.mint,
    owner: t.owner ?? null,
    amount: BigInt(t.uiTokenAmount.amount),
    decimals: t.uiTokenAmount.decimals,
  };
}

export class KitChainReader implements ChainReader {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  constructor(url: string) {
    this.rpc = createSolanaRpc(url);
  }

  async getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]> {
    const out: (RawAccount | null)[] = [];
    for (let i = 0; i < addresses.length; i += MAX_ACCOUNTS_PER_CALL) {
      const chunk = addresses.slice(i, i + MAX_ACCOUNTS_PER_CALL);
      const { value } = await this.rpc.getMultipleAccounts(chunk, { encoding: 'base64' }).send();
      value.forEach((acc, j) => out.push(acc ? toRaw(chunk[j]!, acc as EncodedAccount) : null));
    }
    return out;
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    const res = await this.rpc
      .getTransaction(signature as Signature, { encoding: 'base64', maxSupportedTransactionVersion: 0 })
      .send();
    if (!res) return null;
    const m = res.meta;
    return {
      wire: new Uint8Array(getBase64Encoder().encode(res.transaction[0])),
      slot: BigInt(res.slot),
      blockTime: res.blockTime === null ? null : BigInt(res.blockTime),
      meta: m && {
        err: m.err,
        fee: BigInt(m.fee),
        preBalances: m.preBalances.map((v) => BigInt(v)),
        postBalances: m.postBalances.map((v) => BigInt(v)),
        preTokenBalances: (m.preTokenBalances ?? []).map((t) => toTokenBalance(t as RpcTokenBalance)),
        postTokenBalances: (m.postTokenBalances ?? []).map((t) => toTokenBalance(t as RpcTokenBalance)),
        loadedAddresses: {
          writable: [...(m.loadedAddresses?.writable ?? [])],
          readonly: [...(m.loadedAddresses?.readonly ?? [])],
        },
        logMessages: [...(m.logMessages ?? [])],
      },
    };
  }

  async simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult> {
    const encoded = getBase64Decoder().decode(wire) as Base64EncodedWireTransaction;
    const { value } = await this.rpc
      .simulateTransaction(encoded, {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: 'base64', addresses: [...addresses] },
      })
      .send();
    return {
      err: value.err,
      logs: [...(value.logs ?? [])],
      unitsConsumed: value.unitsConsumed ?? null,
      postAccounts: (value.accounts ?? []).map((acc, i) =>
        acc ? toRaw(addresses[i]!, acc as unknown as EncodedAccount) : null,
      ),
    };
  }
}
```

Append to `packages/rpc/src/index.ts`: `export * from './kit';`

**Step 4: Verify**
Run: `pnpm vitest run packages/rpc/test/kit.live.test.ts` → Expected: 1 skipped.
Run: `CLEF_LIVE_RPC=https://api.mainnet-beta.solana.com pnpm vitest run packages/rpc/test/kit.live.test.ts` → Expected: 1 passed.
Run: `pnpm typecheck` → Expected: exit 0 (fix casts against kit's `.d.ts` if needed).

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(rpc): live KitChainReader over @solana/kit RPC"
```

---

### Task 5: `@clef/idl` — vendor native program IDLs

**Files:**
- Create: `packages/idl/scripts/vendor-idls.sh`
- Create (generated): `packages/idl/idls/{system,token,token-2022,associated-token-account,compute-budget,memo}.json`

**Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Vendors official Codama IDLs for native programs. Re-run to update; commit the result.
set -euo pipefail
cd "$(dirname "$0")/../idls"
for repo in system token token-2022 associated-token-account compute-budget memo; do
  curl -fsSL "https://raw.githubusercontent.com/solana-program/$repo/main/idl.json" -o "$repo.json"
  echo "$repo -> $(node -e "const r=require('./$repo.json'); console.log(r.kind, r.program.name, r.program.publicKey)")"
done
```

**Step 2: Run it**
```bash
mkdir -p packages/idl/idls && chmod +x packages/idl/scripts/vendor-idls.sh && packages/idl/scripts/vendor-idls.sh
```
Expected: six lines, each starting `rootNode`, with program ids `11111111111111111111111111111111`, `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`, `ComputeBudget111111111111111111111111111111`, `Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH` (memo v4; also aliased under MemoSq4… v3).

**Step 3: Commit**
```bash
git add -A && git commit -m "chore(idl): vendor official Codama IDLs for native programs"
```

---

### Task 6: `@clef/idl` — Anchor extras (relations + nested PDA seeds)

**Files:**
- Create: `packages/idl/src/anchor-extras.ts`
- Create: `packages/idl/test/fixtures/vault-anchor.json`
- Test: `packages/idl/test/anchor-extras.test.ts`

**Step 1: Add the test IDL**

`packages/idl/test/fixtures/vault-anchor.json` — a small Anchor v0.30+ IDL used throughout the tests. It covers a const+account PDA (`pool`), a PDA of a PDA (`pool_vault`), a nested-path PDA (`user_position` uses `pool.mint`), and two `has_one` relations (`pool.mint`, `pool.authority`). Discriminators are arbitrary; the tests encode with the same IDL.
```json
{
  "address": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
  "metadata": { "name": "vault", "version": "0.1.0", "spec": "0.1.0" },
  "instructions": [
    {
      "name": "deposit",
      "discriminator": [242, 35, 198, 137, 82, 225, 242, 182],
      "accounts": [
        { "name": "user", "writable": true, "signer": true },
        {
          "name": "pool",
          "pda": { "seeds": [{ "kind": "const", "value": [112, 111, 111, 108] }, { "kind": "account", "path": "mint" }] }
        },
        { "name": "mint", "relations": ["pool"] },
        {
          "name": "pool_vault",
          "writable": true,
          "pda": { "seeds": [{ "kind": "const", "value": [118, 97, 117, 108, 116] }, { "kind": "account", "path": "pool" }] }
        },
        {
          "name": "user_position",
          "writable": true,
          "pda": {
            "seeds": [
              { "kind": "const", "value": [112, 111, 115] },
              { "kind": "account", "path": "pool.mint", "account": "Pool" },
              { "kind": "account", "path": "user" }
            ]
          }
        },
        { "name": "authority", "relations": ["pool"] }
      ],
      "args": [{ "name": "amount", "type": "u64" }]
    }
  ],
  "accounts": [{ "name": "Pool", "discriminator": [241, 154, 109, 4, 17, 177, 109, 188] }],
  "types": [
    {
      "name": "Pool",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "mint", "type": "pubkey" },
          { "name": "authority", "type": "pubkey" },
          { "name": "bump", "type": "u8" }
        ]
      }
    }
  ]
}
```

**Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { extractAnchorExtras } from '../src/anchor-extras';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

describe('extractAnchorExtras', () => {
  it('keeps relations and nested-path PDA seeds, camelCased like Codama', () => {
    expect(extractAnchorExtras(vault)).toEqual({
      deposit: {
        mint: { relations: ['pool'] },
        authority: { relations: ['pool'] },
        userPosition: {
          relations: [],
          nestedSeeds: [
            { kind: 'const', bytes: [112, 111, 115] },
            { kind: 'account', path: ['pool', 'mint'] },
            { kind: 'account', path: ['user'] },
          ],
        },
      },
    });
  });

  it('returns nothing for legacy (pre-0.30) IDLs', () => {
    expect(extractAnchorExtras({ version: '0.1.0', name: 'x', instructions: [] })).toEqual({});
  });
});
```

**Step 3: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/anchor-extras.test.ts` → Expected: FAIL, module not found.

**Step 4: Implement**

`packages/idl/src/anchor-extras.ts`:
```ts
import { camelCase } from '@codama/nodes';

type V01Seed = { kind: 'const'; value: number[] } | { kind: 'arg' | 'account'; path: string; account?: string };
type V01LeafAccount = { name: string; relations?: string[]; pda?: { seeds: V01Seed[]; program?: V01Seed } };
type V01Account = V01LeafAccount | { name: string; accounts: V01Account[] };
type V01Idl = { address?: string; instructions: { name: string; accounts?: V01Account[] }[] };

export type AnchorSeed = { kind: 'const'; bytes: number[] } | { kind: 'arg' | 'account'; path: string[] };

export type AnchorAccountExtras = {
  /** Accounts that hold a field (named like this account) which must equal this account — Anchor `has_one`. */
  relations: string[];
  /** Only set when a seed uses a nested path (`pool.mint`), which Codama cannot represent. */
  nestedSeeds?: AnchorSeed[];
  seedProgram?: AnchorSeed;
};

/** instruction name → account name → extras (all camelCase, matching Codama node names). */
export type AnchorExtras = Record<string, Record<string, AnchorAccountExtras>>;

function flatten(accounts: V01Account[]): V01LeafAccount[] {
  return accounts.flatMap((a) => ('accounts' in a ? flatten(a.accounts) : [a]));
}

function toSeed(seed: V01Seed): AnchorSeed {
  return seed.kind === 'const'
    ? { kind: 'const', bytes: seed.value }
    : { kind: seed.kind, path: seed.path.split('.').map((p) => camelCase(p)) };
}

/** Recovers what `rootNodeFromAnchor` drops: has_one relations and nested-path PDA seeds. */
export function extractAnchorExtras(idl: unknown): AnchorExtras {
  const v = idl as V01Idl;
  if (typeof v.address !== 'string') return {}; // legacy IDL format: no extras
  const out: AnchorExtras = {};
  for (const ix of v.instructions) {
    const flat = flatten(ix.accounts ?? []);
    const names = flat.map((a) => a.name);
    // Codama prefixes duplicate names inside composite accounts; skip instead of guessing.
    if (new Set(names).size !== names.length) continue;

    const entries: Record<string, AnchorAccountExtras> = {};
    for (const acc of flat) {
      const relations = (acc.relations ?? []).map((r) => camelCase(r));
      const seeds = acc.pda?.seeds ?? [];
      const nested = seeds.some((s) => s.kind !== 'const' && s.path.includes('.'));
      if (!relations.length && !nested) continue;
      const extras: AnchorAccountExtras = { relations };
      if (nested) {
        extras.nestedSeeds = seeds.map(toSeed);
        if (acc.pda?.program) extras.seedProgram = toSeed(acc.pda.program);
      }
      entries[camelCase(acc.name)] = extras;
    }
    if (Object.keys(entries).length) out[camelCase(ix.name)] = entries;
  }
  return out;
}
```

**Step 5: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/anchor-extras.test.ts` → Expected: 2 passed.

**Step 6: Commit**
```bash
git add -A && git commit -m "feat(idl): extract Anchor relations and nested PDA seeds"
```

---

### Task 7: `@clef/idl` — types and `normalizeIdl`

**Files:**
- Create: `packages/idl/src/types.ts`, `packages/idl/src/normalize.ts`, `packages/idl/src/index.ts`
- Test: `packages/idl/test/normalize.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeIdl } from '../src';
import token from '../idls/token.json' with { type: 'json' };
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

describe('normalizeIdl', () => {
  it('converts Anchor IDLs to Codama and keeps the extras', async () => {
    const n = await normalizeIdl(vault);
    expect(n.root.program.publicKey).toBe('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    expect(n.root.program.instructions.map((i) => i.name)).toEqual(['deposit']);
    expect(n.anchorExtras?.deposit?.mint?.relations).toEqual(['pool']);
    expect(n.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts Codama roots as-is', async () => {
    const n = await normalizeIdl(JSON.stringify(token));
    expect(n.root.program.name).toBe('token');
    expect(n.anchorExtras).toBeUndefined();
  });

  it('rejects unknown formats', async () => {
    await expect(normalizeIdl({ hello: 'world' })).rejects.toThrow(/Unrecognized IDL/);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/normalize.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/idl/src/types.ts`:
```ts
import type { RootNode } from '@codama/nodes';
import type { Address } from '@solana/kit';
import type { AnchorExtras } from './anchor-extras';

/** How much to trust names coming from this IDL. */
export type TrustTier = 'curated' | 'authority' | 'user';
export type IdlSourceKind = 'user' | 'bundled' | 'program-metadata' | 'anchor-onchain';

export type NormalizedIdl = { root: RootNode; anchorExtras?: AnchorExtras; hash: string };

export type ResolvedIdl = NormalizedIdl & {
  programId: Address;
  source: IdlSourceKind;
  trust: TrustTier;
};

export interface IdlSource {
  readonly kind: IdlSourceKind;
  load(programId: Address): Promise<ResolvedIdl | null>;
}
```

`packages/idl/src/normalize.ts`:
```ts
import type { RootNode } from '@codama/nodes';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { extractAnchorExtras } from './anchor-extras';
import type { NormalizedIdl } from './types';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Accepts a Codama root or an Anchor IDL (as JSON text or parsed object) and returns a Codama root. */
export async function normalizeIdl(input: string | object): Promise<NormalizedIdl> {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const parsed = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
  const hash = await sha256Hex(text);

  if (parsed.kind === 'rootNode') return { root: parsed as unknown as RootNode, hash };
  if (Array.isArray(parsed.instructions)) {
    return {
      root: rootNodeFromAnchor(parsed as unknown as AnchorIdl),
      anchorExtras: extractAnchorExtras(parsed),
      hash,
    };
  }
  throw new Error('Unrecognized IDL format (expected a Codama rootNode or an Anchor IDL)');
}
```

`packages/idl/src/index.ts`:
```ts
export * from './types';
export * from './anchor-extras';
export * from './normalize';
```

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/normalize.test.ts` → Expected: 3 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(idl): normalize Anchor and Codama IDLs to Codama roots"
```

---

### Task 8: `@clef/idl` — static sources (bundled + user)

**Files:**
- Create: `packages/idl/src/static-source.ts`, `packages/idl/src/bundled.ts`
- Modify: `packages/idl/src/index.ts`
- Test: `packages/idl/test/static-source.test.ts`

**Step 1: Write the failing test**

```ts
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createBundledSource, UserIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

describe('static IDL sources', () => {
  it('bundled source serves native programs as curated', async () => {
    const idl = await createBundledSource().load(TOKEN);
    expect(idl).toMatchObject({ programId: TOKEN, source: 'bundled', trust: 'curated' });
    expect(idl?.root.program.name).toBe('token');
  });

  it('bundled source returns null for unknown programs', async () => {
    expect(await createBundledSource().load(VAULT)).toBeNull();
  });

  it('user source serves what the user added, marked as user trust', async () => {
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    expect(await user.load(VAULT)).toMatchObject({ source: 'user', trust: 'user' });
    user.delete(VAULT);
    expect(await user.load(VAULT)).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/static-source.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/idl/src/static-source.ts`:
```ts
import type { Address } from '@solana/kit';
import { normalizeIdl } from './normalize';
import type { IdlSource, IdlSourceKind, ResolvedIdl, TrustTier } from './types';

/** Serves IDLs from an in-memory map of program id → IDL JSON. */
export class StaticIdlSource implements IdlSource {
  constructor(
    readonly kind: IdlSourceKind,
    private readonly trust: TrustTier,
    protected readonly idls = new Map<string, string | object>(),
  ) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const idl = this.idls.get(programId);
    if (!idl) return null;
    return { programId, source: this.kind, trust: this.trust, ...(await normalizeIdl(idl)) };
  }
}

export class UserIdlSource extends StaticIdlSource {
  constructor() {
    super('user', 'user');
  }

  set(programId: Address, json: string): void {
    this.idls.set(programId, json);
  }

  delete(programId: Address): void {
    this.idls.delete(programId);
  }
}
```

`packages/idl/src/bundled.ts`:
```ts
import ata from '../idls/associated-token-account.json' with { type: 'json' };
import computeBudget from '../idls/compute-budget.json' with { type: 'json' };
import memo from '../idls/memo.json' with { type: 'json' };
import system from '../idls/system.json' with { type: 'json' };
import token2022 from '../idls/token-2022.json' with { type: 'json' };
import token from '../idls/token.json' with { type: 'json' };
import { StaticIdlSource } from './static-source';

const BUNDLED: { program: { publicKey: string } }[] = [system, token, token2022, ata, computeBudget, memo];

export function createBundledSource(): StaticIdlSource {
  return new StaticIdlSource('bundled', 'curated', new Map(BUNDLED.map((idl) => [idl.program.publicKey, idl])));
}
```

Append to `packages/idl/src/index.ts`:
```ts
export * from './static-source';
export * from './bundled';
```

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/static-source.test.ts` → Expected: 3 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(idl): bundled and user IDL sources"
```

---

### Task 9: `@clef/idl` — on-chain Anchor IDL source

The Anchor IDL account lives at `createWithSeed(base = PDA([], program), "anchor:idl", program)`. Layout: 8-byte discriminator, 32-byte authority, u32 LE length, zlib-compressed JSON.

**Files:**
- Create: `packages/idl/src/anchor-onchain.ts`
- Modify: `packages/idl/src/index.ts`
- Test: `packages/idl/test/anchor-onchain.test.ts`

**Step 1: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import { address } from '@solana/kit';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { anchorIdlAddress, AnchorOnchainIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

function idlAccountData(json: string): Uint8Array {
  const compressed = zlibSync(new TextEncoder().encode(json));
  const data = new Uint8Array(44 + compressed.length);
  new DataView(data.buffer).setUint32(40, compressed.length, true);
  data.set(compressed, 44);
  return data;
}

describe('AnchorOnchainIdlSource', () => {
  it('loads and inflates the IDL account', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: await anchorIdlAddress(VAULT), owner: VAULT, data: idlAccountData(JSON.stringify(vault)) });
    const idl = await new AnchorOnchainIdlSource(reader).load(VAULT);
    expect(idl).toMatchObject({ source: 'anchor-onchain', trust: 'authority', programId: VAULT });
    expect(idl?.anchorExtras?.deposit).toBeDefined();
  });

  it('returns null when the program has no IDL account', async () => {
    expect(await new AnchorOnchainIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/anchor-onchain.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/idl/src/anchor-onchain.ts`:
```ts
import type { ChainReader } from '@clef/rpc';
import { createAddressWithSeed, getProgramDerivedAddress, type Address } from '@solana/kit';
import { unzlibSync } from 'fflate';
import { normalizeIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

const HEADER = 8 + 32; // discriminator + authority

export async function anchorIdlAddress(programId: Address): Promise<Address> {
  const [base] = await getProgramDerivedAddress({ programAddress: programId, seeds: [] });
  return createAddressWithSeed({ baseAddress: base, programAddress: programId, seed: 'anchor:idl' });
}

export function decodeAnchorIdlAccount(data: Uint8Array): string {
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(HEADER, true);
  const start = HEADER + 4;
  return new TextDecoder().decode(unzlibSync(data.subarray(start, start + length)));
}

export class AnchorOnchainIdlSource implements IdlSource {
  readonly kind = 'anchor-onchain' as const;

  constructor(private readonly reader: ChainReader) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [account] = await this.reader.getAccounts([await anchorIdlAddress(programId)]);
    if (!account) return null;
    const json = decodeAnchorIdlAccount(account.data);
    return { programId, source: this.kind, trust: 'authority', ...(await normalizeIdl(json)) };
  }
}
```

Append to `packages/idl/src/index.ts`: `export * from './anchor-onchain';`

Also: `pnpm add -D --filter @clef/idl "@clef/rpc@workspace:*"` is already a dependency from Task 1 — nothing to do.

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/anchor-onchain.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(idl): on-chain Anchor IDL source"
```

---

### Task 10: `@clef/idl` — Program Metadata Program source

**Files:**
- Create: `packages/idl/src/program-metadata.ts`
- Modify: `packages/idl/src/index.ts`
- Test: `packages/idl/test/program-metadata.test.ts`

**Step 1: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import {
  Compression,
  DataSource,
  Encoding,
  findMetadataPda,
  Format,
  getMetadataEncoder,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from '@solana-program/program-metadata';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ProgramMetadataIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

describe('ProgramMetadataIdlSource', () => {
  it('reads a canonical, directly stored IDL', async () => {
    const packed = packDirectData({ content: JSON.stringify(vault), compression: Compression.Zlib, encoding: Encoding.Utf8 });
    const data = getMetadataEncoder().encode({
      program: VAULT,
      authority: null,
      mutable: true,
      canonical: true,
      seed: 'idl',
      encoding: packed.encoding,
      compression: packed.compression,
      format: Format.Json,
      dataSource: DataSource.Direct,
      dataLength: packed.data.length,
      data: packed.data,
    });
    const [pda] = await findMetadataPda({ program: VAULT, authority: null, seed: 'idl' });
    const reader = new MemoryChainReader();
    reader.setAccount({ address: pda, owner: PROGRAM_METADATA_PROGRAM_ADDRESS, data: new Uint8Array(data) });

    const idl = await new ProgramMetadataIdlSource(reader).load(VAULT);
    expect(idl).toMatchObject({ source: 'program-metadata', trust: 'authority' });
    expect(idl?.root.program.name).toBe('vault');
  });

  it('returns null when there is no metadata account', async () => {
    expect(await new ProgramMetadataIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/program-metadata.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/idl/src/program-metadata.ts`:
```ts
import type { ChainReader } from '@clef/rpc';
import {
  DataSource,
  findMetadataPda,
  getMetadataDecoder,
  unpackAndFetchUrlData,
  unpackDirectData,
} from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { normalizeIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

/** Canonical IDLs published by the program's upgrade authority through the Program Metadata Program. */
export class ProgramMetadataIdlSource implements IdlSource {
  readonly kind = 'program-metadata' as const;

  constructor(private readonly reader: ChainReader) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [pda] = await findMetadataPda({ program: programId, authority: null, seed: 'idl' });
    const [account] = await this.reader.getAccounts([pda]);
    if (!account) return null;

    const md = getMetadataDecoder().decode(account.data);
    const packed = { compression: md.compression, encoding: md.encoding, data: md.data.slice(0, md.dataLength) };
    let json: string;
    if (md.dataSource === DataSource.Direct) json = unpackDirectData(packed);
    else if (md.dataSource === DataSource.Url) json = await unpackAndFetchUrlData(packed);
    else throw new Error('Program Metadata "external" data source is not supported yet');

    return { programId, source: this.kind, trust: 'authority', ...(await normalizeIdl(json)) };
  }
}
```

Append to `packages/idl/src/index.ts`: `export * from './program-metadata';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/program-metadata.test.ts` → Expected: 2 passed. If `getMetadataEncoder` needs fields not shown above, add them from `node_modules/@solana-program/program-metadata/dist/types/generated/accounts/metadata.d.ts`.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(idl): Program Metadata Program IDL source"
```

---

### Task 11: `@clef/idl` — `IdlResolver` (priority chain + cache + fall-through)

`candidates()` yields IDLs lazily in priority order, so the engine only hits the network when cheaper sources fail to decode an instruction.

**Files:**
- Create: `packages/idl/src/resolver.ts`
- Modify: `packages/idl/src/index.ts`
- Test: `packages/idl/test/resolver.test.ts`

**Step 1: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultResolver, IdlResolver, UserIdlSource, type IdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

async function all(resolver: IdlResolver, id: Address, onError?: (e: unknown) => void) {
  const out = [];
  for await (const idl of resolver.candidates(id, onError)) out.push(idl.source);
  return out;
}

describe('IdlResolver', () => {
  it('yields sources in priority order and skips misses', async () => {
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const resolver = createDefaultResolver(new MemoryChainReader(), user);
    expect(await all(resolver, VAULT)).toEqual(['user']);
  });

  it('reports failing sources and keeps going', async () => {
    const broken: IdlSource = { kind: 'program-metadata', load: () => Promise.reject(new Error('boom')) };
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vault));
    const onError = vi.fn();
    expect(await all(new IdlResolver([broken, user]), VAULT, onError)).toEqual(['user']);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ source: 'program-metadata', message: 'boom' }));
  });

  it('loads each source at most once per program', async () => {
    const load = vi.fn().mockResolvedValue(null);
    const resolver = new IdlResolver([{ kind: 'anchor-onchain', load }]);
    await all(resolver, VAULT);
    await all(resolver, VAULT);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/idl/test/resolver.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/idl/src/resolver.ts`:
```ts
import type { ChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AnchorOnchainIdlSource } from './anchor-onchain';
import { createBundledSource } from './bundled';
import { ProgramMetadataIdlSource } from './program-metadata';
import type { UserIdlSource } from './static-source';
import type { IdlSource, IdlSourceKind, ResolvedIdl } from './types';

export type IdlLoadError = { source: IdlSourceKind; programId: Address; message: string };

export class IdlResolver {
  private readonly cache = new Map<string, Promise<ResolvedIdl | null>>();

  constructor(private readonly sources: readonly IdlSource[]) {}

  /** Yields every available IDL for `programId`, best source first. Loads lazily and caches per source. */
  async *candidates(programId: Address, onError: (e: IdlLoadError) => void = () => {}): AsyncGenerator<ResolvedIdl> {
    for (const source of this.sources) {
      const key = `${source.kind}:${programId}`;
      let pending = this.cache.get(key);
      if (!pending) {
        pending = source.load(programId);
        this.cache.set(key, pending);
      }
      try {
        const idl = await pending;
        if (idl) yield idl;
      } catch (e) {
        onError({ source: source.kind, programId, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  invalidate(programId: Address): void {
    for (const source of this.sources) this.cache.delete(`${source.kind}:${programId}`);
  }
}

/** user → curated bundle → Program Metadata → on-chain Anchor IDL. */
export function createDefaultResolver(reader: ChainReader, user: UserIdlSource): IdlResolver {
  return new IdlResolver([user, createBundledSource(), new ProgramMetadataIdlSource(reader), new AnchorOnchainIdlSource(reader)]);
}
```

Append to `packages/idl/src/index.ts`: `export * from './resolver';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/idl/test/resolver.test.ts` → Expected: 3 passed. Then `pnpm test && pnpm typecheck` → all green.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(idl): prioritized, cached IdlResolver"
```

---

### Task 12: `@clef/explain` — model types and known registry

**Files:**
- Create: `packages/explain/src/types.ts`, `packages/explain/src/registry.ts`, `packages/explain/src/index.ts`

No test of its own (types + constants); it's exercised by every following task.

**Step 1: Write `packages/explain/src/types.ts`**

```ts
import type { ChainReader } from '@clef/rpc';
import type { IdlResolver, IdlSourceKind, TrustTier } from '@clef/idl';
import type { Address } from '@solana/kit';

export type DetailLevel = 'basic' | 'intermediate' | 'expert';
export type Severity = 'info' | 'warn' | 'danger';

export type Issue = {
  stage: 'decode' | 'idl' | 'parse' | 'relations' | 'simulate';
  message: string;
  instructionIndex?: number;
};

export type Warning = { rule: string; severity: Severity; message: string; instructionIndex?: number };

export type AccountRef = { address: Address; signer: boolean; writable: boolean; lookupTable?: Address };

export type DecodedInstruction = { index: number; programId: Address; accounts: AccountRef[]; data: Uint8Array };

export type DecodedTransaction = {
  version: 'legacy' | 0;
  feePayer: Address;
  recentBlockhash: string;
  accounts: AccountRef[];
  instructions: DecodedInstruction[];
  wire: Uint8Array;
};

export type NamedAccount = AccountRef & { name?: string; label?: string; mine: boolean };

export type ExplainedInstruction = {
  index: number;
  programId: Address;
  programName?: string;
  /** Undefined when no IDL could decode the instruction. */
  name?: string;
  args?: Record<string, unknown>;
  idl?: { source: IdlSourceKind; trust: TrustTier; hash: string };
  accounts: NamedAccount[];
  data: Uint8Array;
  /** How to format an `amount` argument, when known. */
  amountUnit?: { symbol: string; decimals: number };
};

export type SeedInfo = { kind: 'const' | 'account' | 'arg'; display: string };

export type RelationEdge = {
  kind: 'pda' | 'has_one' | 'token-owner' | 'token-mint' | 'ata';
  /** The account the fact is about. */
  from: Address;
  /** The related account (owner, mint, holder, or deriving program). */
  to: Address;
  label: string;
  status: 'verified' | 'mismatch' | 'unverified';
  detail?: string;
  instructionIndex?: number;
  seeds?: SeedInfo[];
  bump?: number;
};

export type BalanceChange = {
  owner: Address;
  mint: Address | 'SOL';
  symbol?: string;
  decimals: number;
  delta: bigint;
};

export type ExplainedTransaction = {
  tx: DecodedTransaction;
  instructions: ExplainedInstruction[];
  relations: RelationEdge[];
  /** Null when neither tx meta nor a successful simulation was available. */
  balanceChanges: BalanceChange[] | null;
  me: Address[];
  summary: string;
  warnings: Warning[];
  issues: Issue[];
};

export type ExplainContext = {
  reader: ChainReader;
  idls: IdlResolver;
  /** Addresses that belong to the user. */
  me: readonly Address[];
  addressBook?: Readonly<Record<string, string>>;
};
```

**Step 2: Write `packages/explain/src/registry.ts`**

```ts
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

/** Programs whose instructions are never "the point" of a transaction. */
export const PLUMBING_PROGRAMS: ReadonlySet<string> = new Set([COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM]);

export const KNOWN_PROGRAMS: Readonly<Record<string, string>> = {
  [SYSTEM_PROGRAM]: 'System Program',
  [TOKEN_PROGRAM]: 'Token Program',
  [TOKEN_2022_PROGRAM]: 'Token-2022 Program',
  [ATA_PROGRAM]: 'Associated Token Program',
  [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget',
  [MEMO_PROGRAM]: 'Memo Program',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter Aggregator v6',
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: 'Squads v4',
};

export const KNOWN_MINTS: Readonly<Record<string, { symbol: string; decimals: number }>> = {
  So11111111111111111111111111111111111111112: { symbol: 'wSOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
};

export const U64_MAX = (1n << 64n) - 1n;
```

**Step 3: Write `packages/explain/src/index.ts`**
```ts
export * from './types';
export * from './registry';
```

**Step 4: Verify** Run: `pnpm typecheck` → exit 0.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): model types and known-address registry"
```

---

### Task 13: `@clef/explain` — test helpers + `decodeTransaction` (with lookup tables)

**Files:**
- Create: `packages/explain/src/decode.ts`
- Create: `packages/explain/test/helpers.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/decode.test.ts`

**Step 1: Write the test helpers**

`packages/explain/test/helpers.ts`:
```ts
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressEncoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import type { MemoryChainReader } from '@clef/rpc';

export const ME = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
export const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
export const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash;

/** Builds an unsigned wire transaction (v0) from kit instructions. */
export function buildWire(
  instructions: Instruction[],
  opts: { feePayer?: Address; lookupTables?: Record<Address, Address[]> } = {},
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(opts.feePayer ?? ME, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const compressed = opts.lookupTables
    ? compressTransactionMessageUsingAddressLookupTables(message, opts.lookupTables)
    : message;
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)));
}

/** Stores an address lookup table account (56-byte header + 32-byte addresses). */
export function setLookupTable(reader: MemoryChainReader, table: Address, addresses: Address[]): void {
  const data = new Uint8Array(56 + 32 * addresses.length);
  addresses.forEach((a, i) => data.set(getAddressEncoder().encode(a), 56 + 32 * i));
  reader.setAccount({ address: table, owner: address('AddressLookupTab1e1111111111111111111111111'), data });
}
```

**Step 2: Write the failing test**

`packages/explain/test/decode.test.ts`:
```ts
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction } from '../src';
import { BLOCKHASH, buildWire, ME, OTHER, setLookupTable } from './helpers';

const transfer = () =>
  getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1_500_000_000n });

describe('decodeTransaction', () => {
  it('decodes accounts with signer/writable flags', async () => {
    const tx = await decodeTransaction(buildWire([transfer()]), new MemoryChainReader());
    expect(tx).toMatchObject({ version: 0, feePayer: ME, recentBlockhash: BLOCKHASH });
    expect(tx.instructions).toHaveLength(1);
    const [ix] = tx.instructions;
    expect(ix!.programId).toBe('11111111111111111111111111111111');
    expect(ix!.accounts).toEqual([
      { address: ME, signer: true, writable: true },
      { address: OTHER, signer: false, writable: true },
    ]);
  });

  it('resolves address lookup tables through the reader', async () => {
    const table = address('2immgwYNHBbyVQKVGCEkgWpi53bLwWNRMB5G2nbgYV17');
    const reader = new MemoryChainReader();
    setLookupTable(reader, table, [OTHER]);
    const tx = await decodeTransaction(buildWire([transfer()], { lookupTables: { [table]: [OTHER] } }), reader);
    expect(tx.instructions[0]!.accounts[1]).toEqual({ address: OTHER, signer: false, writable: true, lookupTable: table });
  });

  it('prefers loaded addresses from tx meta over fetching tables', async () => {
    const table = address('2immgwYNHBbyVQKVGCEkgWpi53bLwWNRMB5G2nbgYV17');
    const wire = buildWire([transfer()], { lookupTables: { [table]: [OTHER] } });
    const tx = await decodeTransaction(wire, new MemoryChainReader(), { writable: [OTHER], readonly: [] });
    expect(tx.instructions[0]!.accounts[1]!.address).toBe(OTHER);
  });
});
```

**Step 3: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/decode.test.ts` → Expected: FAIL, `decodeTransaction` not exported.

**Step 4: Implement**

`packages/explain/src/decode.ts`:
```ts
import type { ChainReader } from '@clef/rpc';
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import type { AccountRef, DecodedTransaction } from './types';

const LOOKUP_TABLE_META_SIZE = 56;

type Lookup = { lookupTableAddress: Address; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] };
type Loaded = { writable: Address[]; readonly: Address[] };

async function resolveLookups(lookups: readonly Lookup[], reader: ChainReader): Promise<Loaded> {
  const tables = await reader.getAccounts(lookups.map((l) => l.lookupTableAddress));
  const decoder = getAddressDecoder();
  const loaded: Loaded = { writable: [], readonly: [] };
  lookups.forEach((lookup, i) => {
    const table = tables[i];
    if (!table) throw new Error(`Address lookup table ${lookup.lookupTableAddress} not found`);
    const at = (index: number) => decoder.decode(table.data, LOOKUP_TABLE_META_SIZE + index * 32);
    loaded.writable.push(...lookup.writableIndexes.map(at));
    loaded.readonly.push(...lookup.readonlyIndexes.map(at));
  });
  return loaded;
}

/**
 * Decodes a wire transaction into a flat account list and instructions.
 * `loaded` (from tx meta) takes precedence over fetching lookup tables, which may have changed since.
 */
export async function decodeTransaction(wire: Uint8Array, reader: ChainReader, loaded?: Loaded): Promise<DecodedTransaction> {
  const tx = getTransactionDecoder().decode(wire);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (msg.version !== 'legacy' && msg.version !== 0) {
    throw new Error(`Unsupported transaction version ${String(msg.version)}`);
  }

  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = msg.header;
  const statics = msg.staticAccounts;
  const accounts: AccountRef[] = statics.map((address, i) => ({
    address,
    signer: i < numSignerAccounts,
    writable:
      i < numSignerAccounts
        ? i < numSignerAccounts - numReadonlySignerAccounts
        : i < statics.length - numReadonlyNonSignerAccounts,
  }));

  const lookups: readonly Lookup[] = msg.version === 0 ? (msg.addressTableLookups ?? []) : [];
  if (lookups.length) {
    const resolved = loaded ?? (await resolveLookups(lookups, reader));
    const tablesFor = (key: 'writableIndexes' | 'readonlyIndexes') =>
      lookups.flatMap((l) => l[key].map(() => l.lookupTableAddress));
    const writableTables = tablesFor('writableIndexes');
    const readonlyTables = tablesFor('readonlyIndexes');
    accounts.push(
      ...resolved.writable.map((address, i) => ({ address, signer: false, writable: true, lookupTable: writableTables[i]! })),
      ...resolved.readonly.map((address, i) => ({ address, signer: false, writable: false, lookupTable: readonlyTables[i]! })),
    );
  }

  const account = (i: number): AccountRef => {
    const a = accounts[i];
    if (!a) throw new Error(`Instruction references missing account index ${i}`);
    return a;
  };

  return {
    version: msg.version,
    feePayer: statics[0]!,
    recentBlockhash: msg.lifetimeToken,
    accounts,
    instructions: msg.instructions.map((ix, index) => ({
      index,
      programId: account(ix.programAddressIndex).address,
      accounts: (ix.accountIndices ?? []).map(account),
      data: new Uint8Array(ix.data ?? []),
    })),
    wire,
  };
}
```

Append to `packages/explain/src/index.ts`: `export * from './decode';`

**Step 5: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/decode.test.ts` → Expected: 3 passed.

**Step 6: Commit**
```bash
git add -A && git commit -m "feat(explain): decode wire transactions incl. lookup tables"
```

---

### Task 14: `@clef/explain` — account cache and token helpers

**Files:**
- Create: `packages/explain/src/accounts.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/accounts.test.ts`

**Step 1: Add shared token helpers to `packages/explain/test/helpers.ts`**

Append (and add `none` to the `@solana/kit` import):
```ts
import { AccountState, getTokenEncoder } from '@solana-program/token';

export const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export function tokenAccountData(owner: Address = ME, mint: Address = USDC, amount = 10n): Uint8Array {
  return new Uint8Array(
    getTokenEncoder().encode({
      mint, owner, amount, delegate: none(), state: AccountState.Initialized,
      isNative: none(), delegatedAmount: 0n, closeAuthority: none(),
    }),
  );
}
```

**Step 2: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import { getMintEncoder } from '@solana-program/token';
import { address, none } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { AccountCache, decodeMintDecimals, decodeTokenAccount, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

describe('account helpers', () => {
  it('decodes token accounts and mint decimals', () => {
    const acc = { address: OTHER, owner: address(TOKEN_PROGRAM), lamports: 1n, executable: false, data: tokenAccountData() };
    expect(decodeTokenAccount(acc)).toEqual({ mint: USDC, owner: ME, amount: 10n, delegate: null });
    const mintData = new Uint8Array(
      getMintEncoder().encode({ mintAuthority: none(), supply: 1n, decimals: 6, isInitialized: true, freezeAuthority: none() }),
    );
    expect(decodeMintDecimals({ ...acc, data: mintData })).toBe(6);
    expect(decodeTokenAccount({ ...acc, owner: OTHER })).toBeNull();
  });

  it('fetches each address once', async () => {
    const reader = new MemoryChainReader();
    const spy = vi.spyOn(reader, 'getAccounts');
    const cache = new AccountCache(reader);
    await cache.load([ME, OTHER, ME]);
    await cache.load([ME]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([ME, OTHER]);
    expect(cache.get(ME)).toBeNull();
  });
});
```

**Step 3: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/accounts.test.ts` → Expected: FAIL.

**Step 4: Implement**

`packages/explain/src/accounts.ts`:
```ts
import type { ChainReader, RawAccount } from '@clef/rpc';
import { getTokenDecoder } from '@solana-program/token';
import type { Address } from '@solana/kit';
import { TOKEN_PROGRAMS } from './registry';

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
/** Token-2022 extended accounts store their type at byte 165: 1 = mint, 2 = token account. */
const ACCOUNT_TYPE_OFFSET = 165;

/** Memoized, batched account reads shared by all pipeline stages. */
export class AccountCache {
  private readonly cache = new Map<string, RawAccount | null>();

  constructor(private readonly reader: ChainReader) {}

  async load(addresses: readonly Address[]): Promise<void> {
    const missing = [...new Set(addresses)].filter((a) => !this.cache.has(a));
    if (!missing.length) return;
    const accounts = await this.reader.getAccounts(missing);
    missing.forEach((a, i) => this.cache.set(a, accounts[i] ?? null));
  }

  get(address: Address): RawAccount | null {
    return this.cache.get(address) ?? null;
  }
}

export type TokenAccountInfo = { mint: Address; owner: Address; amount: bigint; delegate: Address | null };

export function decodeTokenAccount(account: RawAccount | null): TokenAccountInfo | null {
  if (!account || !TOKEN_PROGRAMS.has(account.owner) || account.data.length < TOKEN_ACCOUNT_SIZE) return null;
  if (account.data.length > TOKEN_ACCOUNT_SIZE && account.data[ACCOUNT_TYPE_OFFSET] !== 2) return null;
  const t = getTokenDecoder().decode(account.data.subarray(0, TOKEN_ACCOUNT_SIZE));
  return { mint: t.mint, owner: t.owner, amount: t.amount, delegate: t.delegate.__option === 'Some' ? t.delegate.value : null };
}

export function decodeMintDecimals(account: RawAccount | null): number | null {
  if (!account || !TOKEN_PROGRAMS.has(account.owner)) return null;
  const isMint =
    account.data.length === MINT_SIZE ||
    (account.data.length > TOKEN_ACCOUNT_SIZE && account.data[ACCOUNT_TYPE_OFFSET] === 1);
  return isMint ? account.data[44]! : null;
}
```

Append to `packages/explain/src/index.ts`: `export * from './accounts';`

**Step 5: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/accounts.test.ts` → Expected: 2 passed.

**Step 6: Commit**
```bash
git add -A && git commit -m "feat(explain): account cache and token decoding helpers"
```

---

### Task 15: `@clef/explain` — instruction identification

**Files:**
- Create: `packages/explain/src/identify.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/identify.test.ts`

**Step 1: Write the failing test**

```ts
import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, identifyInstruction, type Issue } from '../src';
import { buildWire, ME, OTHER } from './helpers';

describe('identifyInstruction', () => {
  it('names the instruction, its args and accounts from the IDL', async () => {
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 5n })]);
    const tx = await decodeTransaction(wire, new MemoryChainReader());
    const issues: Issue[] = [];
    const out = await identifyInstruction(tx.instructions[0]!, new IdlResolver([createBundledSource()]), issues);
    expect(out).toMatchObject({
      name: 'transferSol',
      programName: 'system',
      args: { amount: 5n },
      idl: { source: 'bundled', trust: 'curated' },
    });
    expect(out.accounts.map((a) => a.name)).toEqual(['source', 'destination']);
    expect(issues).toEqual([]);
  });

  it('falls back to a raw instruction when no IDL decodes it', async () => {
    const unknown = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    const ix = { index: 0, programId: unknown, accounts: [], data: new Uint8Array([1, 2, 3]) };
    const out = await identifyInstruction(ix, new IdlResolver([new UserIdlSource()]), []);
    expect(out.name).toBeUndefined();
    expect(out.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/identify.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/identify.ts`:
```ts
import type { IdlResolver, ResolvedIdl } from '@clef/idl';
import { parseInstruction } from '@codama/dynamic-parsers';
import { findProgramNodeFromPath, getLastNodeFromPath } from '@codama/visitors-core';
import { AccountRole } from '@solana/kit';
import type { DecodedInstruction, ExplainedInstruction, Issue } from './types';

function role(a: { signer: boolean; writable: boolean }): AccountRole {
  return ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type IdentifiedInstruction = ExplainedInstruction & { resolvedIdl?: ResolvedIdl };

/** Tries each candidate IDL in priority order; the first one that decodes the instruction wins. */
export async function identifyInstruction(
  ix: DecodedInstruction,
  idls: IdlResolver,
  issues: Issue[],
): Promise<IdentifiedInstruction> {
  const raw: IdentifiedInstruction = {
    index: ix.index,
    programId: ix.programId,
    accounts: ix.accounts.map((a) => ({ ...a, mine: false })),
    data: ix.data,
  };
  const onError = (e: { source: string; message: string }) =>
    issues.push({ stage: 'idl', instructionIndex: ix.index, message: `${e.source}: ${e.message}` });

  for await (const idl of idls.candidates(ix.programId, onError)) {
    try {
      const parsed = parseInstruction(idl.root, {
        programAddress: ix.programId,
        accounts: ix.accounts.map((a) => ({ address: a.address, role: role(a) })),
        data: ix.data,
      });
      if (!parsed) continue;
      const node = getLastNodeFromPath(parsed.path);
      const named = parsed.accounts.length;
      return {
        ...raw,
        name: node.name,
        programName: findProgramNodeFromPath(parsed.path)?.name,
        args: parsed.data as Record<string, unknown>,
        idl: { source: idl.source, trust: idl.trust, hash: idl.hash },
        accounts: raw.accounts.map((a, i) => ({
          ...a,
          name: i < named ? parsed.accounts[i]!.name : `remaining${i - named}`,
        })),
        resolvedIdl: idl,
      };
    } catch (e) {
      issues.push({ stage: 'parse', instructionIndex: ix.index, message: `${idl.source} IDL failed to decode: ${message(e)}` });
    }
  }
  return raw;
}
```

Append to `packages/explain/src/index.ts`: `export * from './identify';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/identify.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): identify instructions via prioritized IDLs"
```

---

### Task 16: `@clef/explain` — vault test fixture helpers

Shared setup for the PDA and relations tests: builds the vault program's `deposit` instruction and `Pool` account data straight from the IDL with Codama codecs.

**Files:**
- Create: `packages/explain/test/vault.ts`
- Copy: `packages/idl/test/fixtures/vault-anchor.json` → `packages/explain/test/fixtures/vault-anchor.json`

**Step 1: Write `packages/explain/test/vault.ts`**

```ts
import { normalizeIdl, UserIdlSource, IdlResolver, type ResolvedIdl } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getNodeCodec } from '@codama/dynamic-codecs';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import type { DecodedInstruction } from '../src';
import vaultJson from './fixtures/vault-anchor.json' with { type: 'json' };
import { ME, OTHER, USDC } from './helpers';

export const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
export const AUTHORITY = address('HvwC9QSAzvGXhhVrgPmauVwFWcYZhne3hVot9EbHuFTm');
const enc = getAddressEncoder();

export async function vaultIdl(): Promise<ResolvedIdl> {
  return { programId: VAULT, source: 'user', trust: 'user', ...(await normalizeIdl(vaultJson)) };
}

export function vaultResolver(): IdlResolver {
  const user = new UserIdlSource();
  user.set(VAULT, JSON.stringify(vaultJson));
  return new IdlResolver([user]);
}

export async function vaultAddresses(mint: Address = USDC) {
  const [pool] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['pool', enc.encode(mint)] });
  const [poolVault] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['vault', enc.encode(pool)] });
  const [userPosition] = await getProgramDerivedAddress({ programAddress: VAULT, seeds: ['pos', enc.encode(mint), enc.encode(ME)] });
  return { user: ME, pool, mint, poolVault, userPosition, authority: AUTHORITY };
}

type VaultAccounts = Awaited<ReturnType<typeof vaultAddresses>>;

export async function depositInstruction(accounts: VaultAccounts, amount = 5n): Promise<DecodedInstruction> {
  const idl = await vaultIdl();
  const ixNode = idl.root.program.instructions[0]!;
  const data = getNodeCodec([idl.root, idl.root.program, ixNode]).encode({ amount });
  const flags: Record<string, [boolean, boolean]> = {
    user: [true, true], pool: [false, false], mint: [false, false],
    poolVault: [false, true], userPosition: [false, true], authority: [false, false],
  };
  return {
    index: 0,
    programId: VAULT,
    data: new Uint8Array(data),
    accounts: (Object.keys(flags) as (keyof VaultAccounts)[]).map((name) => ({
      address: accounts[name],
      signer: flags[name]![0],
      writable: flags[name]![1],
    })),
  };
}

/** Stores the Pool account (owned by the vault program) with the given fields. */
export async function setPool(reader: MemoryChainReader, pool: Address, fields: { mint: Address; authority: Address }) {
  const idl = await vaultIdl();
  const accountNode = idl.root.program.accounts[0]!;
  const data = getNodeCodec([idl.root, idl.root.program, accountNode]).encode({ ...fields, bump: 255 });
  reader.setAccount({ address: pool, owner: VAULT, data: new Uint8Array(data) });
}

export { OTHER };
```

**Step 2: Sanity-check it compiles and decodes**

Add `packages/explain/test/vault.test.ts`:
```ts
import { expect, it } from 'vitest';
import { identifyInstruction } from '../src';
import { depositInstruction, vaultAddresses, vaultResolver } from './vault';

it('vault fixture decodes as deposit', async () => {
  const ix = await depositInstruction(await vaultAddresses());
  const out = await identifyInstruction(ix, vaultResolver(), []);
  expect(out.name).toBe('deposit');
  expect(out.args).toMatchObject({ amount: 5n });
  expect(out.accounts.map((a) => a.name)).toEqual(['user', 'pool', 'mint', 'poolVault', 'userPosition', 'authority']);
});
```

Run: `pnpm vitest run packages/explain/test/vault.test.ts` → Expected: 1 passed. If `getNodeCodec(...).encode` rejects the missing `discriminator`, pass it explicitly: `{ discriminator: new Uint8Array([242,35,198,137,82,225,242,182]), amount }` (and the account discriminator for `Pool`).

**Step 3: Commit**
```bash
git add -A && git commit -m "test(explain): vault program fixture built from its IDL"
```

---

### Task 17: `@clef/explain` — PDA verification from Codama seeds

**Files:**
- Create: `packages/explain/src/pda.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/pda.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { identifyInstruction, verifyCodamaPdas } from '../src';
import { OTHER, depositInstruction, vaultAddresses, vaultResolver } from './vault';

async function edgesFor(overrides: Partial<Awaited<ReturnType<typeof vaultAddresses>>> = {}) {
  const accounts = { ...(await vaultAddresses()), ...overrides };
  const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
  return { accounts, edges: await verifyCodamaPdas(ix) };
}

describe('verifyCodamaPdas', () => {
  it('verifies PDAs whose seeds Codama can express', async () => {
    const { accounts, edges } = await edgesFor();
    // userPosition uses a nested seed (pool.mint) — handled by Anchor extras, not here.
    expect(edges.map((e) => [e.from, e.status])).toEqual([
      [accounts.pool, 'verified'],
      [accounts.poolVault, 'verified'],
    ]);
    expect(edges[0]!.seeds).toEqual([
      { kind: 'const', display: '"pool"' },
      { kind: 'account', display: 'mint' },
    ]);
    expect(edges[0]!.label).toBe('PDA("pool", mint)');
  });

  it('flags a substituted PDA as a mismatch', async () => {
    const { edges } = await edgesFor({ poolVault: OTHER });
    const vault = edges.find((e) => e.from === OTHER);
    expect(vault?.status).toBe('mismatch');
    expect(vault?.detail).toMatch(/^expected /);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/pda.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/pda.ts`:
```ts
import { getNodeCodecVisitor, getValueNodeVisitor } from '@codama/dynamic-codecs';
import { isNode, type PdaNode, type ProgramNode, type RootNode } from '@codama/nodes';
import { getRecordLinkablesVisitor, LinkableDictionary, visit } from '@codama/visitors-core';
import { getProgramDerivedAddress, type Address } from '@solana/kit';
import type { IdentifiedInstruction } from './identify';
import type { RelationEdge, SeedInfo } from './types';

class Unresolvable extends Error {}

type Visitors = { codec: ReturnType<typeof getNodeCodecVisitor>; value: ReturnType<typeof getValueNodeVisitor> };
const visitorsCache = new WeakMap<RootNode, Visitors>();

function visitorsFor(root: RootNode): Visitors {
  let v = visitorsCache.get(root);
  if (!v) {
    const linkables = new LinkableDictionary();
    visit(root, getRecordLinkablesVisitor(linkables));
    v = { codec: getNodeCodecVisitor(linkables), value: getValueNodeVisitor(linkables) };
    visitorsCache.set(root, v);
  }
  return v;
}

/** Printable ASCII is shown as a quoted string, anything else as hex. */
export function displayBytes(bytes: Uint8Array): string {
  const printable = bytes.length > 0 && bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? JSON.stringify(new TextDecoder().decode(bytes)) : `0x${Buffer.from(bytes).toString('hex')}`;
}

function findProgram(root: RootNode, programId: Address): ProgramNode | undefined {
  return [root.program, ...root.additionalPrograms].find((p) => p.publicKey === programId);
}

/** Re-derives every PDA declared on the instruction's accounts and compares it to what was passed. */
export async function verifyCodamaPdas(ix: IdentifiedInstruction): Promise<RelationEdge[]> {
  const idl = ix.resolvedIdl;
  if (!idl || !ix.name) return [];
  const program = findProgram(idl.root, ix.programId);
  const node = program?.instructions.find((i) => i.name === ix.name);
  if (!program || !node) return [];

  const { codec, value } = visitorsFor(idl.root);
  const byName = new Map(ix.accounts.filter((a) => a.name).map((a) => [a.name!, a.address]));
  const args = ix.args ?? {};
  const edges: RelationEdge[] = [];

  for (const accountNode of node.accounts) {
    const dv = accountNode.defaultValue;
    const actual = byName.get(accountNode.name);
    if (!dv || !isNode(dv, 'pdaValueNode') || !actual) continue;
    const pda: PdaNode | undefined = isNode(dv.pda, 'pdaNode') ? dv.pda : program.pdas.find((p) => p.name === dv.pda.name);
    if (!pda) continue;

    const seeds: SeedInfo[] = [];
    try {
      const encoded: Uint8Array[] = [];
      for (const seed of pda.seeds) {
        const seedCodec = visit(seed.type, codec);
        if (isNode(seed, 'constantPdaSeedNode')) {
          const bytes = new Uint8Array(seedCodec.encode(visit(seed.value, value)));
          encoded.push(bytes);
          seeds.push({ kind: 'const', display: displayBytes(bytes) });
          continue;
        }
        const seedValue = dv.seeds.find((s) => s.name === seed.name)?.value;
        if (!seedValue) throw new Unresolvable(`seed "${seed.name}" has no value`);
        let resolved: unknown;
        if (isNode(seedValue, 'accountValueNode')) {
          resolved = byName.get(seedValue.name);
          if (!resolved) throw new Unresolvable(`account "${seedValue.name}" is not in the instruction`);
          seeds.push({ kind: 'account', display: seedValue.name });
        } else if (isNode(seedValue, 'argumentValueNode')) {
          if (!(seedValue.name in args)) throw new Unresolvable(`argument "${seedValue.name}" is missing`);
          resolved = args[seedValue.name];
          seeds.push({ kind: 'arg', display: seedValue.name });
        } else {
          resolved = visit(seedValue, value);
          seeds.push({ kind: 'const', display: String(resolved) });
        }
        encoded.push(new Uint8Array(seedCodec.encode(resolved)));
      }

      let programAddress = (pda.programId ?? program.publicKey) as Address;
      if (dv.programId && isNode(dv.programId, 'accountValueNode')) {
        programAddress = byName.get(dv.programId.name) ?? programAddress;
      }
      const [expected, bump] = await getProgramDerivedAddress({ programAddress, seeds: encoded });
      edges.push({
        kind: 'pda',
        from: actual,
        to: programAddress,
        label: `PDA(${seeds.map((s) => s.display).join(', ')})`,
        status: expected === actual ? 'verified' : 'mismatch',
        instructionIndex: ix.index,
        seeds,
        bump,
        ...(expected !== actual && { detail: `expected ${expected}` }),
      });
    } catch (e) {
      if (!(e instanceof Unresolvable)) throw e;
      edges.push({ kind: 'pda', from: actual, to: program.publicKey as Address, label: 'PDA', status: 'unverified', detail: e.message, instructionIndex: ix.index });
    }
  }
  return edges;
}
```

`Buffer` is fine in Node; replace with a manual hex loop when this runs in the extension (M2).

Append to `packages/explain/src/index.ts`: `export * from './pda';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/pda.test.ts` → Expected: 2 passed. If the const seed displays differently (e.g. Codama stores Anchor const seeds as `bytesValueNode` base58), adjust only the *expected display* in the test — the derivation must still verify.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): verify PDAs from Codama seed definitions"
```

---

### Task 18: `@clef/explain` — Anchor extras (has_one + nested-path seeds)

**Files:**
- Create: `packages/explain/src/anchor-relations.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/anchor-relations.test.ts`

**Step 1: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache, identifyInstruction, verifyAnchorExtras } from '../src';
import { AUTHORITY, OTHER, depositInstruction, setPool, vaultAddresses, vaultResolver } from './vault';

async function run(poolFields: Partial<{ mint: Address; authority: Address }> = {}) {
  const accounts = await vaultAddresses();
  const reader = new MemoryChainReader();
  await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY, ...poolFields });
  const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
  return { accounts, edges: await verifyAnchorExtras(ix, new AccountCache(reader)) };
}

describe('verifyAnchorExtras', () => {
  it('verifies has_one relations and nested-path seeds against decoded account data', async () => {
    const { accounts, edges } = await run();
    // Order follows the IDL's account order: mint, user_position, authority.
    expect(edges.map((e) => [e.kind, e.label, e.status])).toEqual([
      ['has_one', 'pool.mint', 'verified'],
      ['pda', 'PDA("pos", pool.mint, user)', 'verified'],
      ['has_one', 'pool.authority', 'verified'],
    ]);
    expect(edges[0]).toMatchObject({ from: accounts.mint, to: accounts.pool });
  });

  it('flags a relation that does not hold', async () => {
    const { edges } = await run({ authority: OTHER });
    const authority = edges.find((e) => e.label === 'pool.authority');
    expect(authority).toMatchObject({ status: 'mismatch', detail: `pool.authority is ${OTHER}` });
  });

  it('marks relations unverified when the holder account cannot be read', async () => {
    const accounts = await vaultAddresses();
    const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
    const edges = await verifyAnchorExtras(ix, new AccountCache(new MemoryChainReader()));
    expect(new Set(edges.map((e) => e.status))).toEqual(new Set(['unverified']));
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/anchor-relations.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/anchor-relations.ts`:
```ts
import type { AnchorSeed } from '@clef/idl';
import { parseAccountData } from '@codama/dynamic-parsers';
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, isAddress, type Address } from '@solana/kit';
import type { AccountCache } from './accounts';
import type { IdentifiedInstruction } from './identify';
import { displayBytes } from './pda';
import type { RelationEdge, SeedInfo } from './types';

class Unresolvable extends Error {}

/** Checks what Codama cannot express: Anchor `has_one` relations and PDAs with nested-path seeds. */
export async function verifyAnchorExtras(ix: IdentifiedInstruction, cache: AccountCache): Promise<RelationEdge[]> {
  const idl = ix.resolvedIdl;
  const extras = ix.name ? idl?.anchorExtras?.[ix.name] : undefined;
  if (!idl || !extras) return [];

  const byName = new Map(ix.accounts.filter((a) => a.name).map((a) => [a.name!, a.address]));
  const decoded = new Map<string, Record<string, unknown> | null>();
  const decode = async (name: string): Promise<Record<string, unknown> | null> => {
    if (decoded.has(name)) return decoded.get(name)!;
    const address = byName.get(name);
    let data: Record<string, unknown> | null = null;
    if (address) {
      await cache.load([address]);
      const account = cache.get(address);
      if (account) data = (parseAccountData(idl.root, account.data)?.data as Record<string, unknown>) ?? null;
    }
    decoded.set(name, data);
    return data;
  };

  const edges: RelationEdge[] = [];
  for (const [target, extra] of Object.entries(extras)) {
    const targetAddress = byName.get(target);
    if (!targetAddress) continue;

    for (const holder of extra.relations) {
      const holderAddress = byName.get(holder) ?? targetAddress;
      const base = { kind: 'has_one' as const, from: targetAddress, to: holderAddress, label: `${holder}.${target}`, instructionIndex: ix.index };
      const data = await decode(holder);
      if (!data) {
        edges.push({ ...base, status: 'unverified', detail: `could not read ${holder}` });
        continue;
      }
      const field = data[target];
      edges.push(
        field === targetAddress
          ? { ...base, status: 'verified' }
          : { ...base, status: 'mismatch', detail: `${holder}.${target} is ${String(field)}` },
      );
    }

    if (extra.nestedSeeds) {
      edges.push(await verifyNestedSeeds(ix, target, targetAddress, extra.nestedSeeds, extra.seedProgram, byName, decode));
    }
  }
  return edges;
}

async function verifyNestedSeeds(
  ix: IdentifiedInstruction,
  target: string,
  targetAddress: Address,
  seeds: AnchorSeed[],
  seedProgram: AnchorSeed | undefined,
  byName: Map<string, Address>,
  decode: (name: string) => Promise<Record<string, unknown> | null>,
): Promise<RelationEdge> {
  const resolveAddress = async (seed: AnchorSeed): Promise<Address> => {
    if (seed.kind === 'const') return getAddressDecoder().decode(new Uint8Array(seed.bytes));
    const [head, ...fields] = seed.path;
    let value: unknown;
    if (seed.kind === 'arg') value = ix.args?.[head!];
    else if (!fields.length) value = byName.get(head!);
    else value = await decode(head!);
    for (const field of fields) value = (value as Record<string, unknown> | null)?.[field];
    if (typeof value !== 'string' || !isAddress(value)) {
      throw new Unresolvable(`seed ${seed.path.join('.')} is not a public key (only public-key nested seeds are supported)`);
    }
    return value;
  };

  const programId = ix.programId;
  const info: SeedInfo[] = [];
  try {
    const encoded: Uint8Array[] = [];
    for (const seed of seeds) {
      if (seed.kind === 'const') {
        const bytes = new Uint8Array(seed.bytes);
        encoded.push(bytes);
        info.push({ kind: 'const', display: displayBytes(bytes) });
      } else {
        encoded.push(new Uint8Array(getAddressEncoder().encode(await resolveAddress(seed))));
        info.push({ kind: seed.kind, display: seed.path.join('.') });
      }
    }
    const programAddress = seedProgram ? await resolveAddress(seedProgram) : programId;
    const [expected, bump] = await getProgramDerivedAddress({ programAddress, seeds: encoded });
    return {
      kind: 'pda',
      from: targetAddress,
      to: programAddress,
      label: `PDA(${info.map((s) => s.display).join(', ')})`,
      status: expected === targetAddress ? 'verified' : 'mismatch',
      instructionIndex: ix.index,
      seeds: info,
      bump,
      ...(expected !== targetAddress && { detail: `expected ${expected}` }),
    };
  } catch (e) {
    if (!(e instanceof Unresolvable)) throw e;
    return { kind: 'pda', from: targetAddress, to: programId, label: `PDA of ${target}`, status: 'unverified', detail: e.message, instructionIndex: ix.index };
  }
}
```

Append to `packages/explain/src/index.ts`: `export * from './anchor-relations';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/anchor-relations.test.ts` → Expected: 3 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): verify Anchor has_one relations and nested-path PDAs"
```

---

### Task 19: `@clef/explain` — token relations and labels

**Files:**
- Create: `packages/explain/src/labels.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/labels.test.ts`

**Step 1: Write the failing test**

```ts
import { MemoryChainReader } from '@clef/rpc';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address, type Address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountCache, Labeler, tokenRelations, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

describe('token relations and labels', () => {
  let myAta: Address;
  let cache: AccountCache;
  beforeAll(async () => {
    [myAta] = await findAssociatedTokenPda({ owner: ME, mint: USDC, tokenProgram: address(TOKEN_PROGRAM) });
    const reader = new MemoryChainReader();
    reader.setAccount({ address: myAta, owner: address(TOKEN_PROGRAM), data: tokenAccountData(ME, USDC) });
    cache = new AccountCache(reader);
    await cache.load([myAta, ME, OTHER, USDC]);
  });

  it('derives owner, mint and ATA facts from on-chain token accounts', async () => {
    const edges = await tokenRelations([myAta, ME], cache);
    expect(edges.map((e) => [e.kind, e.from, e.to, e.status])).toEqual([
      ['token-owner', myAta, ME, 'verified'],
      ['token-mint', myAta, USDC, 'verified'],
      ['ata', myAta, ME, 'verified'],
    ]);
  });

  it('labels wallets, token accounts, mints and programs', () => {
    const labeler = new Labeler([ME], cache, { [OTHER]: 'Alice' });
    expect(labeler.label(ME)).toBe('Your wallet');
    expect(labeler.label(OTHER)).toBe('Alice');
    expect(labeler.label(myAta)).toBe('Your USDC token account');
    expect(labeler.label(USDC)).toBe('USDC mint');
    expect(labeler.label(address(TOKEN_PROGRAM))).toBe('Token Program');
    expect(labeler.isMine(myAta)).toBe(true);
    expect(labeler.mintInfo(USDC)).toEqual({ symbol: 'USDC', decimals: 6 });
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/labels.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/labels.ts`:
```ts
import { findAssociatedTokenPda } from '@solana-program/token';
import type { Address } from '@solana/kit';
import { decodeMintDecimals, decodeTokenAccount, type AccountCache } from './accounts';
import { KNOWN_MINTS, KNOWN_PROGRAMS } from './registry';
import type { RelationEdge } from './types';

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Facts read straight from token account data — never from IDL names. */
export async function tokenRelations(addresses: readonly Address[], cache: AccountCache): Promise<RelationEdge[]> {
  const edges: RelationEdge[] = [];
  for (const address of new Set(addresses)) {
    const account = cache.get(address);
    const token = decodeTokenAccount(account);
    if (!account || !token) continue;
    edges.push(
      { kind: 'token-owner', from: address, to: token.owner, label: 'token owner', status: 'verified' },
      { kind: 'token-mint', from: address, to: token.mint, label: 'mint', status: 'verified' },
    );
    const [ata] = await findAssociatedTokenPda({ owner: token.owner, mint: token.mint, tokenProgram: account.owner });
    if (ata === address) edges.push({ kind: 'ata', from: address, to: token.owner, label: 'associated token account', status: 'verified' });
  }
  return edges;
}

export class Labeler {
  private readonly me: ReadonlySet<string>;

  constructor(
    me: readonly Address[],
    private readonly cache: AccountCache,
    private readonly addressBook: Readonly<Record<string, string>> = {},
  ) {
    this.me = new Set(me);
  }

  /** The user's wallets plus token accounts they own. */
  isMine(address: Address): boolean {
    return this.me.has(address) || this.me.has(decodeTokenAccount(this.cache.get(address))?.owner ?? '');
  }

  mintInfo(mint: Address): { symbol: string; decimals: number } | null {
    const known = KNOWN_MINTS[mint];
    if (known) return known;
    const decimals = decodeMintDecimals(this.cache.get(mint));
    return decimals === null ? null : { symbol: shortAddress(mint), decimals };
  }

  label(address: Address): string | undefined {
    if (this.me.has(address)) return 'Your wallet';
    const named = this.addressBook[address] ?? KNOWN_PROGRAMS[address];
    if (named) return named;
    if (KNOWN_MINTS[address]) return `${KNOWN_MINTS[address]!.symbol} mint`;
    const token = decodeTokenAccount(this.cache.get(address));
    if (token) {
      const symbol = this.mintInfo(token.mint)?.symbol ?? shortAddress(token.mint);
      const whose = this.me.has(token.owner) ? 'Your' : `${this.addressBook[token.owner] ?? shortAddress(token.owner)}'s`;
      return `${whose} ${symbol} token account`;
    }
    return undefined;
  }
}
```

Append to `packages/explain/src/index.ts`: `export * from './labels';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/labels.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): token relations and account labels"
```

---

### Task 20: `@clef/explain` — balance changes (tx meta and simulation)

**Files:**
- Create: `packages/explain/src/balances.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/balances.test.ts`

**Step 1: Write the failing test**

```ts
import type { RawAccount, TxMeta } from '@clef/rpc';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { balanceChangesFromMeta, balanceChangesFromSimulation, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

const ATA = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const accounts = [ME, OTHER, ATA];
const mintInfo = () => ({ symbol: 'USDC', decimals: 6 });

describe('balance changes', () => {
  it('reads SOL and token deltas from transaction meta', () => {
    const meta: TxMeta = {
      err: null, fee: 5000n, logMessages: [], loadedAddresses: { writable: [], readonly: [] },
      preBalances: [10n, 0n, 2n], postBalances: [4n, 6n, 2n],
      preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, amount: 100n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, amount: 40n, decimals: 6 }],
    };
    expect(balanceChangesFromMeta(accounts, meta, mintInfo)).toEqual([
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -6n },
      { owner: OTHER, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: 6n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -60n },
    ]);
  });

  it('diffs pre/post simulated account states', () => {
    const acc = (addr: typeof ME, lamports: bigint, data = new Uint8Array(), owner = addr): RawAccount =>
      ({ address: addr, owner, lamports, data, executable: false });
    const tokenOwner = address(TOKEN_PROGRAM);
    const pre = [acc(ME, 10n), acc(ATA, 2n, tokenAccountData(ME, USDC, 100n), tokenOwner)];
    const post = [acc(ME, 7n), acc(ATA, 2n, tokenAccountData(ME, USDC, 30n), tokenOwner)];
    expect(balanceChangesFromSimulation(pre, post, mintInfo)).toEqual([
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -3n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -70n },
    ]);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/balances.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/balances.ts`:
```ts
import type { RawAccount, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTokenAccount } from './accounts';
import type { BalanceChange } from './types';

type MintInfo = (mint: Address) => { symbol: string; decimals: number } | null;

const sol = (owner: Address, delta: bigint): BalanceChange => ({ owner, mint: 'SOL', symbol: 'SOL', decimals: 9, delta });

/** Sums deltas per (owner, mint), drops zeros, keeps first-seen order. */
function aggregate(changes: BalanceChange[]): BalanceChange[] {
  const out = new Map<string, BalanceChange>();
  for (const c of changes) {
    const key = `${c.owner}:${c.mint}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, delta: prev.delta + c.delta } : c);
  }
  return [...out.values()].filter((c) => c.delta !== 0n);
}

export function balanceChangesFromMeta(accounts: readonly Address[], meta: TxMeta, mintInfo: MintInfo): BalanceChange[] {
  const changes = accounts.map((a, i) => sol(a, (meta.postBalances[i] ?? 0n) - (meta.preBalances[i] ?? 0n)));
  const pre = new Map(meta.preTokenBalances.map((t) => [t.accountIndex, t]));
  const post = new Map(meta.postTokenBalances.map((t) => [t.accountIndex, t]));
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(index);
    const after = post.get(index);
    const ref = (after ?? before)!;
    changes.push({
      owner: ref.owner ?? accounts[index]!,
      mint: ref.mint,
      symbol: mintInfo(ref.mint)?.symbol,
      decimals: ref.decimals,
      delta: (after?.amount ?? 0n) - (before?.amount ?? 0n),
    });
  }
  return aggregate(changes);
}

export function balanceChangesFromSimulation(
  pre: readonly (RawAccount | null)[],
  post: readonly (RawAccount | null)[],
  mintInfo: MintInfo,
): BalanceChange[] {
  const changes: BalanceChange[] = [];
  pre.forEach((before, i) => {
    const after = post[i] ?? null;
    const address = (before ?? after)?.address;
    if (!address) return;
    const beforeToken = decodeTokenAccount(before);
    const afterToken = decodeTokenAccount(after);
    const token = afterToken ?? beforeToken;
    if (token) {
      const info = mintInfo(token.mint);
      changes.push({
        owner: token.owner,
        mint: token.mint,
        symbol: info?.symbol,
        decimals: info?.decimals ?? 0,
        delta: (afterToken?.amount ?? 0n) - (beforeToken?.amount ?? 0n),
      });
      return; // rent lamports on token accounts are noise for the user
    }
    changes.push(sol(address, (after?.lamports ?? 0n) - (before?.lamports ?? 0n)));
  });
  return aggregate(changes);
}
```

Append to `packages/explain/src/index.ts`: `export * from './balances';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/balances.test.ts` → Expected: 2 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): balance changes from tx meta and simulation"
```

---

### Task 21: `@clef/explain` — risk rules

**Files:**
- Create: `packages/explain/src/risk.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/risk.test.ts`

**Step 1: Write the failing test**

Tests use hand-built partial `ExplainedTransaction`s — rules are pure functions.

```ts
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { evaluateRisks, SYSTEM_PROGRAM, TOKEN_PROGRAM, U64_MAX, type ExplainedInstruction, type RiskInput } from '../src';
import { ME, OTHER } from './helpers';

const ix = (over: Partial<ExplainedInstruction>): ExplainedInstruction => ({
  index: 0, programId: address(TOKEN_PROGRAM), accounts: [], data: new Uint8Array(), ...over,
});
const input = (instructions: ExplainedInstruction[], over: Partial<RiskInput> = {}): RiskInput => ({
  instructions, relations: [], balanceChanges: [], issues: [], me: [ME], ...over,
});
const named = (name: string, address: typeof ME, mine = false) => ({ name, address, signer: false, writable: true, mine });
const rules = (i: RiskInput) => evaluateRisks(i).map((w) => [w.rule, w.severity]);

describe('evaluateRisks', () => {
  it('flags unlimited token delegation as danger, limited as warn', () => {
    expect(rules(input([ix({ name: 'approve', args: { amount: U64_MAX } })]))).toEqual([['delegation', 'danger']]);
    expect(rules(input([ix({ name: 'approve', args: { amount: 5n } })]))).toEqual([['delegation', 'warn']]);
  });

  it('flags authority changes and system reassignment of your accounts', () => {
    expect(rules(input([ix({ name: 'setAuthority' })]))).toEqual([['authority-change', 'danger']]);
    const assign = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named('account', ME, true)] });
    expect(rules(input([assign]))).toEqual([['authority-change', 'danger']]);
  });

  it('flags closing an account to someone else', () => {
    const close = ix({ name: 'closeAccount', accounts: [named('account', ME, true), named('destination', OTHER)] });
    expect(rules(input([close]))).toEqual([['close-to-third-party', 'danger']]);
  });

  it('flags durable nonces, unknown programs, failed simulation and relation mismatches', () => {
    const nonce = ix({ programId: address(SYSTEM_PROGRAM), name: 'advanceNonceAccount' });
    const unknown = ix({ index: 1, programId: OTHER });
    expect(
      rules(
        input([nonce, unknown], {
          issues: [{ stage: 'simulate', message: 'Simulation failed: custom error 1' }],
          relations: [{ kind: 'pda', from: OTHER, to: OTHER, label: 'PDA', status: 'mismatch', instructionIndex: 1 }],
        }),
      ),
    ).toEqual([
      ['durable-nonce', 'warn'],
      ['unknown-program', 'warn'],
      ['relation-mismatch', 'danger'],
      ['simulation-failed', 'warn'],
    ]);
  });

  it('flags outflows when part of the transaction is unexplained', () => {
    const unknown = ix({ programId: OTHER });
    const out = input([unknown], { balanceChanges: [{ owner: ME, mint: 'SOL', decimals: 9, delta: -1n }] });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/risk.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/risk.ts`:
```ts
import type { Address } from '@solana/kit';
import { PLUMBING_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAMS, U64_MAX } from './registry';
import type { ExplainedTransaction, Warning } from './types';

export type RiskInput = Pick<ExplainedTransaction, 'instructions' | 'relations' | 'balanceChanges' | 'issues' | 'me'>;

const isToken = (p: string) => TOKEN_PROGRAMS.has(p);
const account = (ix: RiskInput['instructions'][number], name: string) => ix.accounts.find((a) => a.name === name);

export function evaluateRisks(input: RiskInput): Warning[] {
  const me = new Set<string>(input.me);
  const warnings: Warning[] = [];
  const warn = (rule: string, severity: Warning['severity'], message: string, instructionIndex?: number) =>
    warnings.push({ rule, severity, message, ...(instructionIndex !== undefined && { instructionIndex }) });

  for (const ix of input.instructions) {
    const i = ix.index;
    if (!ix.name) {
      if (!PLUMBING_PROGRAMS.has(ix.programId)) {
        warn('unknown-program', 'warn', `Clef can't decode instruction #${i + 1} (program ${ix.programId}).`, i);
      }
      continue;
    }
    if (isToken(ix.programId) && (ix.name === 'approve' || ix.name === 'approveChecked')) {
      const unlimited = ix.args?.amount === U64_MAX;
      warn('delegation', unlimited ? 'danger' : 'warn', unlimited ? 'Grants UNLIMITED spending of a token account to a delegate.' : 'Lets a delegate spend tokens from your account.', i);
    }
    if (isToken(ix.programId) && ix.name === 'setAuthority') {
      warn('authority-change', 'danger', 'Changes the authority of a token account or mint.', i);
    }
    if (ix.programId === SYSTEM_PROGRAM && (ix.name === 'assign' || ix.name === 'assignWithSeed') && account(ix, 'account')?.mine) {
      warn('authority-change', 'danger', 'Reassigns ownership of your account to another program.', i);
    }
    if (isToken(ix.programId) && ix.name === 'closeAccount') {
      const destination = account(ix, 'destination');
      if (destination && !destination.mine && !me.has(destination.address)) {
        warn('close-to-third-party', 'danger', 'Closes an account and sends its rent to an address you do not own.', i);
      }
    }
    if (ix.programId === SYSTEM_PROGRAM && ix.name === 'advanceNonceAccount' && i === 0) {
      warn('durable-nonce', 'warn', 'Uses a durable nonce: this signature never expires and can be submitted later.', i);
    }
  }

  for (const r of input.relations) {
    if (r.status === 'mismatch') {
      warn('relation-mismatch', 'danger', `Account ${r.from} does not match its expected ${r.label}${r.detail ? ` (${r.detail})` : ''}.`, r.instructionIndex);
    }
  }

  if (input.issues.some((i) => i.stage === 'simulate')) {
    warn('simulation-failed', 'warn', 'Simulation failed: balance changes are unknown.');
  }

  const unexplained = input.instructions.some((ix) => !ix.name && !PLUMBING_PROGRAMS.has(ix.programId));
  const outflow = (input.balanceChanges ?? []).some((c) => me.has(c.owner as Address) && c.delta < 0n);
  if (unexplained && outflow) {
    warn('unexplained-outflow', 'danger', 'Funds leave your wallet in a transaction Clef cannot fully explain.');
  }
  return warnings;
}
```

Append to `packages/explain/src/index.ts`: `export * from './risk';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/risk.test.ts` → Expected: 5 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): risk rules"
```

---

### Task 22: `@clef/explain` — formatting and summary

**Files:**
- Create: `packages/explain/src/format.ts`, `packages/explain/src/summary.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/summary.test.ts`

**Step 1: Write the failing test**

```ts
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { formatUnits, summarize, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, type ExplainedInstruction } from '../src';
import { ME, OTHER, USDC } from './helpers';

const base = { accounts: [], data: new Uint8Array() };

describe('formatUnits', () => {
  it('formats with decimals and trims zeros', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatUnits(-60n, 6)).toBe('-0.00006');
    expect(formatUnits(42n, 0)).toBe('42');
  });
});

describe('summarize', () => {
  it('uses a template for a lone known instruction, ignoring compute budget', () => {
    const instructions: ExplainedInstruction[] = [
      { ...base, index: 0, programId: address(COMPUTE_BUDGET_PROGRAM), name: 'setComputeUnitPrice' },
      {
        ...base, index: 1, programId: address(SYSTEM_PROGRAM), name: 'transferSol', args: { amount: 1_500_000_000n },
        accounts: [
          { name: 'source', address: ME, signer: true, writable: true, mine: true },
          { name: 'destination', address: OTHER, signer: false, writable: true, mine: false, label: 'Alice' },
        ],
      },
    ];
    expect(summarize({ instructions, balanceChanges: null, me: [ME] })).toBe('Send 1.5 SOL to Alice');
  });

  it('falls back to balance changes and program names', () => {
    const instructions: ExplainedInstruction[] = [
      { ...base, index: 0, programId: OTHER, programName: 'jupiter', name: 'route' },
    ];
    const balanceChanges = [
      { owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta: -1_500_000_000n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: 212_400_000n },
    ];
    expect(summarize({ instructions, balanceChanges, me: [ME] })).toBe('Send 1.5 SOL, receive 212.4 USDC via jupiter');
  });

  it('describes interactions when nothing moves', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    expect(summarize({ instructions, balanceChanges: [], me: [ME] })).toBe(`Interact with ${OTHER.slice(0, 4)}…${OTHER.slice(-4)}`);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/summary.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/format.ts`:
```ts
export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = decimals ? (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
```

`packages/explain/src/summary.ts`:
```ts
import { formatUnits } from './format';
import { shortAddress } from './labels';
import { KNOWN_PROGRAMS, PLUMBING_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import type { ExplainedInstruction, ExplainedTransaction } from './types';

export type SummaryInput = Pick<ExplainedTransaction, 'instructions' | 'balanceChanges' | 'me'>;

const who = (ix: ExplainedInstruction, name: string) => {
  const a = ix.accounts.find((acc) => acc.name === name);
  return a ? (a.label ?? shortAddress(a.address)) : 'unknown';
};

type Template = (ix: ExplainedInstruction) => string | null;

const TEMPLATES: Record<string, Template> = {
  [`${SYSTEM_PROGRAM}:transferSol`]: (ix) => `Send ${formatUnits(ix.args?.amount as bigint, 9)} SOL to ${who(ix, 'destination')}`,
};
const tokenTransfer: Template = (ix) =>
  ix.amountUnit
    ? `Send ${formatUnits(ix.args?.amount as bigint, ix.amountUnit.decimals)} ${ix.amountUnit.symbol} to ${who(ix, 'destination')}`
    : null;
for (const program of TOKEN_PROGRAMS) {
  TEMPLATES[`${program}:transfer`] = tokenTransfer;
  TEMPLATES[`${program}:transferChecked`] = tokenTransfer;
}

const programLabel = (ix: ExplainedInstruction) => KNOWN_PROGRAMS[ix.programId] ?? ix.programName ?? shortAddress(ix.programId);

export function summarize(input: SummaryInput): string {
  const meaningful = input.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId));
  if (meaningful.length === 1) {
    const ix = meaningful[0]!;
    const text = ix.name ? TEMPLATES[`${ix.programId}:${ix.name}`]?.(ix) : null;
    if (text) return text;
  }

  const me = new Set<string>(input.me);
  const mine = (input.balanceChanges ?? []).filter((c) => me.has(c.owner));
  const fmt = (c: (typeof mine)[number]) => `${formatUnits(c.delta < 0n ? -c.delta : c.delta, c.decimals)} ${c.symbol ?? shortAddress(c.mint)}`;
  const sent = mine.filter((c) => c.delta < 0n).map(fmt);
  const received = mine.filter((c) => c.delta > 0n).map(fmt);

  const programs = [...new Set(meaningful.filter((ix) => !TOKEN_PROGRAMS.has(ix.programId) && ix.programId !== SYSTEM_PROGRAM).map(programLabel))];
  const via = programs.length ? ` via ${programs.join(', ')}` : '';

  const text = [sent.length && `send ${sent.join(', ')}`, received.length && `receive ${received.join(', ')}`]
    .filter(Boolean)
    .join(', ');
  if (text) return `${text[0]!.toUpperCase()}${text.slice(1)}${via}`;
  return `Interact with ${[...new Set(meaningful.map(programLabel))].join(', ') || 'no programs'}`;
}
```

Append to `packages/explain/src/index.ts`:
```ts
export * from './format';
export * from './summary';
```

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/summary.test.ts` → Expected: 4 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): amount formatting and transaction summary"
```

---

### Task 23: `@clef/explain` — `explain()` orchestrator

**Files:**
- Create: `packages/explain/src/explain.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/explain.test.ts`

**Step 1: Write the failing test**

```ts
import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { AccountRole, createNoopSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain } from '../src';
import { buildWire, ME, OTHER } from './helpers';
import { AUTHORITY, VAULT, depositInstruction, setPool, vaultAddresses } from './vault';
import vaultJson from './fixtures/vault-anchor.json' with { type: 'json' };

describe('explain', () => {
  it('explains a SOL transfer end to end with simulated balance changes', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: OTHER, lamports: 10_000_000_000n, data: new Uint8Array() });
    reader.simulateImpl = async (_wire, addresses) => ({
      err: null, logs: [], unitsConsumed: 150n,
      postAccounts: addresses.map((a) => ({
        address: a, owner: OTHER, executable: false, data: new Uint8Array(),
        lamports: a === ME ? 8_500_000_000n : 1_500_000_000n,
      })),
    });
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1_500_000_000n })]);
    const ex = await explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });

    expect(ex.summary).toBe(`Send 1.5 SOL to ${OTHER.slice(0, 4)}…${OTHER.slice(-4)}`);
    expect(ex.instructions[0]).toMatchObject({ name: 'transferSol', programName: 'system' });
    expect(ex.instructions[0]!.accounts[0]).toMatchObject({ name: 'source', mine: true, label: 'Your wallet' });
    expect(ex.balanceChanges).toContainEqual({ owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -1_500_000_000n });
    expect(ex.warnings).toEqual([]);
    expect(ex.issues).toEqual([]);
  });

  it('records a failed simulation as an issue and a warning, without throwing', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async () => ({ err: { InstructionError: [0, { Custom: 1 }] }, logs: [], unitsConsumed: null, postAccounts: [] });
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n })]);
    const ex = await explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });
    expect(ex.balanceChanges).toBeNull();
    expect(ex.issues[0]).toMatchObject({ stage: 'simulate' });
    expect(ex.warnings.map((w) => w.rule)).toContain('simulation-failed');
  });

  it('collects verified relations for an Anchor program', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vaultJson));
    const ix = await depositInstruction(accounts);
    const wire = buildWire([{ programAddress: ix.programId, data: ix.data, accounts: ix.accounts.map((a) => ({ address: a.address, role: ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole })) }]);

    const ex = await explain({ wire }, { reader, idls: new IdlResolver([user]), me: [ME] });
    expect(ex.relations.filter((r) => r.instructionIndex === 0).map((r) => r.status)).toEqual(
      ['verified', 'verified', 'verified', 'verified', 'verified'],
    );
    expect(ex.warnings.filter((w) => w.severity === 'danger')).toEqual([]);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/explain.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/explain.ts`:
```ts
import type { TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AccountCache, decodeTokenAccount } from './accounts';
import { verifyAnchorExtras } from './anchor-relations';
import { balanceChangesFromMeta, balanceChangesFromSimulation } from './balances';
import { decodeTransaction } from './decode';
import { identifyInstruction, type IdentifiedInstruction } from './identify';
import { Labeler, tokenRelations } from './labels';
import { verifyCodamaPdas } from './pda';
import { SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import { evaluateRisks } from './risk';
import { summarize } from './summary';
import type { ExplainContext, ExplainedInstruction, ExplainedTransaction, Issue, RelationEdge } from './types';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The mint an instruction's `amount` refers to: an explicit `mint` account, or the source token account's mint. */
function amountMint(ix: ExplainedInstruction, cache: AccountCache): Address | null {
  if (!TOKEN_PROGRAMS.has(ix.programId)) return null;
  const mint = ix.accounts.find((a) => a.name === 'mint');
  if (mint) return mint.address;
  const source = ix.accounts.find((a) => a.name === 'source');
  return source ? (decodeTokenAccount(cache.get(source.address))?.mint ?? null) : null;
}

/**
 * Explains a transaction. Never throws for partial failures — those land in `issues`.
 * Throws only if the wire bytes cannot be decoded at all.
 */
export async function explain(
  input: { wire: Uint8Array; meta?: TxMeta | null },
  ctx: ExplainContext,
): Promise<ExplainedTransaction> {
  const issues: Issue[] = [];
  const tx = await decodeTransaction(input.wire, ctx.reader, input.meta?.loadedAddresses);
  const addresses = tx.accounts.map((a) => a.address);
  const cache = new AccountCache(ctx.reader);
  await cache.load(addresses);

  const relations: RelationEdge[] = await tokenRelations(addresses, cache);
  // Mints referenced by token accounts are needed for symbols/decimals.
  await cache.load(relations.filter((r) => r.kind === 'token-mint').map((r) => r.to));

  const identified: IdentifiedInstruction[] = [];
  for (const ix of tx.instructions) {
    const out = await identifyInstruction(ix, ctx.idls, issues);
    identified.push(out);
    try {
      relations.push(...(await verifyCodamaPdas(out)), ...(await verifyAnchorExtras(out, cache)));
    } catch (e) {
      issues.push({ stage: 'relations', instructionIndex: ix.index, message: message(e) });
    }
  }

  const labeler = new Labeler(ctx.me, cache, ctx.addressBook);
  const instructions: ExplainedInstruction[] = identified.map(({ resolvedIdl: _, ...ix }) => {
    const explained: ExplainedInstruction = {
      ...ix,
      accounts: ix.accounts.map((a) => {
        const label = labeler.label(a.address);
        return { ...a, mine: labeler.isMine(a.address), ...(label && { label }) };
      }),
    };
    const mint = amountMint(explained, cache);
    const unit = ix.programId === SYSTEM_PROGRAM ? { symbol: 'SOL', decimals: 9 } : mint && labeler.mintInfo(mint);
    return unit ? { ...explained, amountUnit: unit } : explained;
  });

  let balanceChanges: ExplainedTransaction['balanceChanges'] = null;
  const mintInfo = (mint: Address) => labeler.mintInfo(mint);
  if (input.meta) {
    balanceChanges = balanceChangesFromMeta(addresses, input.meta, mintInfo);
  } else {
    const writable = tx.accounts.filter((a) => a.writable).map((a) => a.address);
    try {
      const sim = await ctx.reader.simulate(input.wire, writable);
      if (sim.err) {
        issues.push({ stage: 'simulate', message: `Simulation failed: ${JSON.stringify(sim.err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}` });
      } else {
        balanceChanges = balanceChangesFromSimulation(writable.map((a) => cache.get(a)), sim.postAccounts, mintInfo);
      }
    } catch (e) {
      issues.push({ stage: 'simulate', message: `Simulation unavailable: ${message(e)}` });
    }
  }

  const me = [...ctx.me];
  const partial = { tx, instructions, relations, balanceChanges, issues, me };
  return { ...partial, summary: summarize(partial), warnings: evaluateRisks(partial) };
}
```

Append to `packages/explain/src/index.ts`: `export * from './explain';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/explain.test.ts` → Expected: 3 passed. Then `pnpm test && pnpm typecheck` → all green.

The Anchor test expects 5 verified relations: `pool` PDA, `poolVault` PDA, `pool.mint`, `pool.authority`, `userPosition` nested PDA. If the order differs, compare as a sorted list.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): explain() orchestrator"
```

---

### Task 24: `@clef/explain` — detail-level views

Views are the contract the extension UI (M3) will render. One function, three shapes.

**Files:**
- Create: `packages/explain/src/views.ts`
- Modify: `packages/explain/src/index.ts`
- Test: `packages/explain/test/views.test.ts`

**Step 1: Write the failing test**

```ts
import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { createNoopSigner } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { explain, viewFor, type ExplainedTransaction } from '../src';
import { buildWire, ME, OTHER } from './helpers';

let ex: ExplainedTransaction;
beforeAll(async () => {
  const wire = buildWire([
    getSetComputeUnitLimitInstruction({ units: 200_000 }),
    getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1_500_000_000n }),
  ]);
  ex = await explain({ wire }, { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME] });
});

describe('viewFor', () => {
  it('basic shows only summary, your balance changes and warnings', () => {
    const v = viewFor(ex, 'basic');
    expect(Object.keys(v).sort()).toEqual(['balanceChanges', 'level', 'summary', 'warnings']);
  });

  it('intermediate adds named instructions with formatted args and hides compute budget', () => {
    const v = viewFor(ex, 'intermediate');
    expect(v.instructions).toHaveLength(1);
    expect(v.instructions[0]).toMatchObject({ program: 'System Program', name: 'transferSol', args: { amount: '1.5 SOL' } });
    expect(v.instructions[0]!.accounts[0]).toMatchObject({ name: 'source', label: 'Your wallet' });
  });

  it('expert shows everything including raw data and compute budget', () => {
    const v = viewFor(ex, 'expert');
    expect(v.instructions).toHaveLength(2);
    expect(v.computeUnitLimit).toBe(200_000);
    expect(v.instructions[1]!.dataHex).toMatch(/^[0-9a-f]+$/);
    expect(v.instructions[1]!.accounts[0]).toMatchObject({ signer: true, writable: true });
    expect(v.feePayer).toBe(ME);
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run packages/explain/test/views.test.ts` → Expected: FAIL.

**Step 3: Implement**

`packages/explain/src/views.ts`:
```ts
import { formatUnits } from './format';
import { shortAddress } from './labels';
import { COMPUTE_BUDGET_PROGRAM, KNOWN_PROGRAMS, PLUMBING_PROGRAMS } from './registry';
import type { BalanceChange, DetailLevel, ExplainedInstruction, ExplainedTransaction, Issue, RelationEdge, Warning } from './types';

export type ChangeView = { owner: string; asset: string; amount: string };
export type AccountView = { name: string; address: string; label?: string; badges: string[] };
export type InstructionView = { index: number; program: string; name: string; trust?: string; args: Record<string, string>; accounts: AccountView[] };
export type ExpertAccountView = AccountView & { signer: boolean; writable: boolean; lookupTable?: string };
export type ExpertInstructionView = Omit<InstructionView, 'accounts'> & {
  programId: string;
  idl?: { source: string; trust: string; hash: string };
  dataHex: string;
  accounts: ExpertAccountView[];
};

export type BasicView = { level: 'basic'; summary: string; balanceChanges: ChangeView[]; warnings: Warning[] };
export type IntermediateView = Omit<BasicView, 'level'> & { level: 'intermediate'; instructions: InstructionView[] };
export type ExpertView = Omit<BasicView, 'level'> & {
  level: 'expert';
  instructions: ExpertInstructionView[];
  version: string;
  feePayer: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
  relations: RelationEdge[];
  issues: Issue[];
};

const SYMBOLS: Record<RelationEdge['status'], string> = { verified: '✓', mismatch: '✗', unverified: '?' };

function formatValue(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (typeof v === 'string') return v;
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x));
}

function formatArgs(ix: ExplainedInstruction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(ix.args ?? {})) {
    if (key === 'discriminator') continue;
    out[key] =
      key === 'amount' && typeof value === 'bigint' && ix.amountUnit
        ? `${formatUnits(value, ix.amountUnit.decimals)} ${ix.amountUnit.symbol}`
        : formatValue(value);
  }
  return out;
}

function badges(ex: ExplainedTransaction, ix: ExplainedInstruction, address: string): string[] {
  return ex.relations
    .filter((r) => r.from === address && (r.instructionIndex === undefined || r.instructionIndex === ix.index))
    .filter((r) => r.kind !== 'token-mint')
    .map((r) => `${r.kind === 'token-owner' ? 'owner' : r.kind === 'ata' ? 'ATA' : r.label} ${SYMBOLS[r.status]}`);
}

function instructionView(ex: ExplainedTransaction, ix: ExplainedInstruction): InstructionView {
  return {
    index: ix.index,
    program: KNOWN_PROGRAMS[ix.programId] ?? ix.programName ?? shortAddress(ix.programId),
    name: ix.name ?? 'Unknown instruction',
    ...(ix.idl && { trust: ix.idl.trust }),
    args: formatArgs(ix),
    accounts: ix.accounts.map((a, i) => ({
      name: a.name ?? `#${i}`,
      address: a.address,
      ...(a.label && { label: a.label }),
      badges: badges(ex, ix, a.address),
    })),
  };
}

function changeView(c: BalanceChange): ChangeView {
  const amount = formatUnits(c.delta, c.decimals);
  return { owner: c.owner, asset: c.symbol ?? shortAddress(c.mint), amount: c.delta > 0n ? `+${amount}` : amount };
}

export function viewFor(ex: ExplainedTransaction, level: 'basic'): BasicView;
export function viewFor(ex: ExplainedTransaction, level: 'intermediate'): IntermediateView;
export function viewFor(ex: ExplainedTransaction, level: 'expert'): ExpertView;
export function viewFor(ex: ExplainedTransaction, level: DetailLevel): BasicView | IntermediateView | ExpertView;
export function viewFor(ex: ExplainedTransaction, level: DetailLevel): BasicView | IntermediateView | ExpertView {
  const me = new Set<string>(ex.me);
  const changes = ex.balanceChanges ?? [];
  const common = {
    summary: ex.summary,
    warnings: ex.warnings,
    balanceChanges: (level === 'expert' ? changes : changes.filter((c) => me.has(c.owner))).map(changeView),
  };
  if (level === 'basic') return { level, ...common };
  if (level === 'intermediate') {
    return { level, ...common, instructions: ex.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId)).map((ix) => instructionView(ex, ix)) };
  }

  const budget = ex.instructions.filter((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM);
  const limit = budget.find((ix) => ix.name === 'setComputeUnitLimit')?.args?.units;
  const price = budget.find((ix) => ix.name === 'setComputeUnitPrice')?.args?.microLamports;
  return {
    level,
    ...common,
    version: String(ex.tx.version),
    feePayer: ex.tx.feePayer,
    recentBlockhash: ex.tx.recentBlockhash,
    ...(limit !== undefined && { computeUnitLimit: Number(limit) }),
    ...(price !== undefined && { computeUnitPrice: BigInt(price as bigint) }),
    relations: ex.relations,
    issues: ex.issues,
    instructions: ex.instructions.map((ix) => ({
      ...instructionView(ex, ix),
      programId: ix.programId,
      ...(ix.idl && { idl: ix.idl }),
      dataHex: Buffer.from(ix.data).toString('hex'),
      accounts: instructionView(ex, ix).accounts.map((a, i) => ({
        ...a,
        signer: ix.accounts[i]!.signer,
        writable: ix.accounts[i]!.writable,
        ...(ix.accounts[i]!.lookupTable && { lookupTable: ix.accounts[i]!.lookupTable }),
      })),
    })),
  };
}
```

Append to `packages/explain/src/index.ts`: `export * from './views';`

**Step 4: Run to verify it passes**
Run: `pnpm vitest run packages/explain/test/views.test.ts` → Expected: 3 passed.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(explain): basic/intermediate/expert views"
```

---

### Task 25: `@clef/cli` — text renderer and `clef explain` command

**Files:**
- Create: `apps/cli/src/render.ts`, `apps/cli/src/main.ts`
- Test: `apps/cli/test/render.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ExpertView, IntermediateView } from '@clef/explain';
import { renderView } from '../src/render';

const intermediate: IntermediateView = {
  level: 'intermediate',
  summary: 'Send 1.5 SOL to Alice',
  warnings: [{ rule: 'durable-nonce', severity: 'warn', message: 'Uses a durable nonce.' }],
  balanceChanges: [{ owner: 'me', asset: 'SOL', amount: '-1.5' }],
  instructions: [{
    index: 1, program: 'System Program', name: 'transferSol', trust: 'curated', args: { amount: '1.5 SOL' },
    accounts: [{ name: 'source', address: 'AAAA', label: 'Your wallet', badges: [] }, { name: 'destination', address: 'BBBB', badges: ['PDA("x") ✓'] }],
  }],
};

describe('renderView', () => {
  it('renders summary, warnings, changes and instructions', () => {
    expect(renderView(intermediate)).toMatchInlineSnapshot();
  });

  it('renders expert-only sections', () => {
    const expert = { ...intermediate, level: 'expert', version: '0', feePayer: 'AAAA', recentBlockhash: 'H', computeUnitLimit: 200000, relations: [], issues: [{ stage: 'idl', message: 'boom' }], instructions: [] } as unknown as ExpertView;
    const out = renderView(expert);
    expect(out).toContain('Fee payer: AAAA');
    expect(out).toContain('Compute unit limit: 200000');
    expect(out).toContain('[idl] boom');
  });
});
```

**Step 2: Run to verify it fails**
Run: `pnpm vitest run apps/cli/test/render.test.ts` → Expected: FAIL.

**Step 3: Implement**

`apps/cli/src/render.ts`:
```ts
import type { BasicView, ExpertView, IntermediateView } from '@clef/explain';

const ICON = { info: 'ℹ', warn: '⚠', danger: '⛔' } as const;

export function renderView(view: BasicView | IntermediateView | ExpertView): string {
  const lines: string[] = [view.summary, ''];
  for (const w of view.warnings) lines.push(`${ICON[w.severity]} ${w.message}`);
  if (view.warnings.length) lines.push('');

  if (view.balanceChanges.length) {
    lines.push('Balance changes:');
    for (const c of view.balanceChanges) lines.push(`  ${c.amount} ${c.asset}${view.level === 'expert' ? `  (${c.owner})` : ''}`);
    lines.push('');
  }

  if (view.level === 'basic') return lines.join('\n').trimEnd();

  if (view.level === 'expert') {
    lines.push(`Version: ${view.version}`, `Fee payer: ${view.feePayer}`, `Blockhash: ${view.recentBlockhash}`);
    if (view.computeUnitLimit !== undefined) lines.push(`Compute unit limit: ${view.computeUnitLimit}`);
    if (view.computeUnitPrice !== undefined) lines.push(`Compute unit price: ${view.computeUnitPrice} µlamports`);
    lines.push('');
  }

  for (const ix of view.instructions) {
    lines.push(`#${ix.index + 1} ${ix.program} · ${ix.name}${ix.trust ? ` [${ix.trust}]` : ''}`);
    for (const [k, v] of Object.entries(ix.args)) lines.push(`    ${k}: ${v}`);
    for (const a of ix.accounts) {
      const flags = 'signer' in a ? ` ${a.signer ? 's' : '-'}${a.writable ? 'w' : '-'}${a.lookupTable ? ' (ALT)' : ''}` : '';
      const badges = a.badges.length ? `  ${a.badges.join('  ')}` : '';
      lines.push(`    ${a.name}: ${a.label ? `${a.label} ` : ''}${a.address}${flags}${badges}`);
    }
    if ('dataHex' in ix) lines.push(`    data: ${ix.dataHex}`, ...(ix.idl ? [`    idl: ${ix.idl.source} (${ix.idl.trust}) ${ix.idl.hash.slice(0, 12)}`] : []));
    lines.push('');
  }

  if (view.level === 'expert' && view.issues.length) {
    lines.push('Issues:');
    for (const i of view.issues) lines.push(`  [${i.stage}] ${i.message}`);
  }
  return lines.join('\n').trimEnd();
}
```

Run the test once; Vitest fills the inline snapshot. **Read the snapshot** and confirm it matches the intended layout before committing.

`apps/cli/src/main.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { explain, viewFor, type DetailLevel } from '@clef/explain';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { KitChainReader, RecordingChainReader, type ChainReader } from '@clef/rpc';
import { address, getBase64Encoder } from '@solana/kit';
import { renderView } from './render';

const USAGE = `Usage:
  clef explain <signature> [--level basic|intermediate|expert] [--me <address>]... [--rpc <url>] [--record <file>]
  clef explain --tx <base64-wire-tx> [same options]   (unsigned/new tx: simulated)`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      level: { type: 'string', default: 'intermediate' },
      me: { type: 'string', multiple: true, default: [] },
      rpc: { type: 'string', default: process.env.CLEF_RPC ?? 'https://api.mainnet-beta.solana.com' },
      tx: { type: 'string' },
      record: { type: 'string' },
    },
  });
  const [command, signature] = positionals;
  if (command !== 'explain' || (!signature && !values.tx)) {
    console.error(USAGE);
    process.exit(2);
  }
  const level = values.level as DetailLevel;
  if (!['basic', 'intermediate', 'expert'].includes(level)) throw new Error(`Unknown level ${level}`);

  const live = new KitChainReader(values.rpc!);
  const recorder = values.record ? new RecordingChainReader(live) : null;
  const reader: ChainReader = recorder ?? live;
  const me = values.me!.map((m) => address(m));

  let wire: Uint8Array;
  let meta = null;
  if (signature) {
    const fetched = await reader.getTransaction(signature);
    if (!fetched) throw new Error(`Transaction ${signature} not found`);
    wire = fetched.wire;
    meta = fetched.meta;
  } else {
    wire = new Uint8Array(getBase64Encoder().encode(values.tx!));
  }

  const ex = await explain({ wire, meta }, { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me });
  console.log(renderView(viewFor(ex, level)));

  if (recorder && values.record) {
    writeFileSync(values.record, recorder.toFixture({ signature, tx: values.tx, me }));
    console.error(`\nRecorded fixture → ${values.record}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

**Step 4: Verify**
Run: `pnpm vitest run apps/cli/test/render.test.ts` → Expected: 2 passed.
Run: `pnpm clef` → Expected: usage text, exit code 2.
Manual smoke (network): pick any recent signature from https://explorer.solana.com and run
`pnpm clef explain <sig> --level expert`
Expected: a summary line, instructions with names, no crash. Note anything surprising for Task 26.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(cli): clef explain command with text renderer"
```

---

### Task 26: Recorded mainnet fixtures + snapshot tests

Real transactions catch what synthetic tests can't (Token-2022 extensions, ALTs, Anchor IDLs on-chain, Jupiter routes).

**Files:**
- Create (generated): `packages/explain/test/fixtures/mainnet/*.json`
- Test: `packages/explain/test/mainnet.test.ts`

**Step 1: Record fixtures**

Pick one recent, successful mainnet signature for each case (Solana Explorer / Solscan; filter by program). For each, use the transaction's first signer as `--me`:

| Fixture name | What to pick |
|---|---|
| `sol-transfer` | plain System transfer |
| `usdc-transfer` | Token `transferChecked` of USDC |
| `jupiter-swap` | Jupiter v6 (`JUP6Lkb…`) swap, v0 tx with lookup tables |
| `token-approve` | Token `approve` |
| `token-2022-transfer` | any Token-2022 `transferChecked` |
| `anchor-pda` | any Anchor program with an on-chain IDL and PDA accounts (e.g. a Squads v4 `proposalApprove`) |

```bash
mkdir -p packages/explain/test/fixtures/mainnet
pnpm clef explain <SIG> --me <SIGNER> --level expert --record packages/explain/test/fixtures/mainnet/<name>.json
```
Use a reliable RPC (`--rpc` or `CLEF_RPC`); public mainnet may rate-limit. Re-run until each records cleanly. Check each file is < 2 MB (`ls -lh`); if one is larger, pick a different transaction.

**Step 2: Write the snapshot test**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { FixtureChainReader } from '@clef/rpc';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain, viewFor } from '../src';

const dir = join(import.meta.dirname, 'fixtures/mainnet');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe.each(files)('mainnet fixture %s', (file) => {
  it('explains deterministically from recorded chain data', async () => {
    const reader = FixtureChainReader.fromJson(readFileSync(join(dir, file), 'utf8'));
    const input = reader.input as { signature: string; me: string[] };
    const fetched = await reader.getTransaction(input.signature);
    const ex = await explain(
      { wire: fetched!.wire, meta: fetched!.meta },
      { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me: input.me.map((m) => address(m)) },
    );

    expect(ex.issues.filter((i) => i.stage !== 'idl')).toEqual([]);
    expect(ex.relations.filter((r) => r.status === 'mismatch')).toEqual([]);
    expect(ex.instructions.some((ix) => ix.name)).toBe(true);
    expect(viewFor(ex, 'expert')).toMatchSnapshot();
  });
});
```

**Step 3: Run and review**
Run: `pnpm vitest run packages/explain/test/mainnet.test.ts` → Expected: 6 passed, snapshots written.
**Open `packages/explain/test/__snapshots__/mainnet.test.ts.snap` and read every snapshot.** For each fixture, check by hand: summary is sensible, instruction names are correct, balance changes match the explorer, PDAs show `verified`. Fix bugs found here with a focused unit test in the relevant earlier test file first (TDD), then re-run.

Known acceptable outcome: Jupiter's route instruction may show `unverified` relations for nested seeds that are not public keys — that's by design.

**Step 4: Verify the whole suite runs offline**
Run (with networking off, or just as-is — fixture readers never touch the network): `pnpm test && pnpm typecheck` → all green.

**Step 5: Commit**
```bash
git add -A && git commit -m "test(explain): recorded mainnet fixtures with snapshot views"
```

---

### Task 27: Final verification

**Step 1:** `pnpm test` → all pass, live tests skipped.
**Step 2:** `CLEF_LIVE_RPC=<your rpc> pnpm vitest run packages/rpc/test/kit.live.test.ts` → pass.
**Step 3:** `pnpm typecheck` → exit 0.
**Step 4:** Run `pnpm clef explain <jupiter-swap-signature> --level basic`, then `intermediate`, then `expert`, and confirm each level shows strictly more information than the previous one.
**Step 5:** Use superpowers:requesting-code-review against this plan, then superpowers:finishing-a-development-branch.

---

## Out of scope for M1 (tracked for later milestones)

- IndexedDB IDL cache (M2 — the resolver's in-memory cache is the seam).
- Program Metadata `external` data source.
- Nested-path seeds with non-public-key values.
- Curated summary templates beyond System/Token transfers (Jupiter, Squads — M7/M9).
- `Buffer` usage in `pda.ts`/`views.ts` must be replaced with a hex helper before the code runs in the extension (M2).

## Extensions beyond the original plan

Landed in M1 although the plan above did not call for them:

- **v1 transactions** (SIMD-0385): decoding with size, count and config-mask checks; the fee and compute limits from the transaction config; v1 envelopes; `maxSupportedTransactionVersion: 1` in `@clef/rpc`.
- **Risk-engine hardening**: rules on simulated state changes (token owner, close authority, program owner); the sweep rule; fee and `high-fee` handling with a bounded allowance; stake authority, lockup, withdraw and initialize rules; netting of flows across all of your wallets (wrapped SOL as SOL); co-signer closes and approvals that are not yours.
- **Race-safe simulation**: simulation against the cached pre-state of every writable account, a re-read and one retry, then a conservative pre-state (`highestSeen`) instead of discarding the result.
- **IDL source hardening**: load timeouts and transient-error retries in the resolver, capped inflation, curated-only decoding for bundled programs, sanitized names, args and error text.
- **CLI exit codes**: 0 explained, 1 error, 2 usage, 3 explained with a DANGER warning.
