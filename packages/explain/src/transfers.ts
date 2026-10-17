import type { InnerInstruction, RawAccount, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTokenAccount, type AccountCache } from './accounts';
import { SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import type { AccountFact, DecodedInstruction, Transfer } from './types';

type MintInfo = (mint: Address) => { symbol: string; decimals: number } | null;

/** One instruction, top-level or inner, by address. */
export type FlowInstruction = InnerInstruction & { instructionIndex: number; inner: boolean };

const u32 = (d: Uint8Array, at: number) => (d.length >= at + 4 ? new DataView(d.buffer, d.byteOffset).getUint32(at, true) : null);
const u64 = (d: Uint8Array, at: number) => (d.length >= at + 8 ? new DataView(d.buffer, d.byteOffset).getBigUint64(at, true) : null);

const big = (v: unknown): bigint | null => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return BigInt(v);
  return null;
};
const addr = (v: unknown): Address | null => (typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? (v as Address) : null);

type Raw = Omit<Transfer, 'symbol' | 'decimals' | 'instructionIndex' | 'inner'>;

function fromSystem(ix: FlowInstruction): Raw | null {
  if (ix.parsed) {
    const { type, info } = ix.parsed;
    const lamports = big(info.lamports);
    const source = addr(info.source);
    if (lamports === null || !source) return null;
    if (type === 'transfer' || type === 'transferWithSeed') {
      const to = addr(info.destination);
      return to ? { kind: 'sol', from: source, to, mint: 'SOL', amount: lamports } : null;
    }
    if (type === 'createAccount' || type === 'createAccountWithSeed') {
      const to = addr(info.newAccount);
      const owner = addr(info.owner);
      const space = big(info.space);
      return to ? { kind: 'create', from: source, to, mint: 'SOL', amount: lamports, ...(owner && { owner }), ...(space !== null && { space: Number(space) }) } : null;
    }
    return null;
  }
  const d = ix.data;
  if (!d) return null;
  const [a0, a1, a2] = ix.accounts;
  switch (u32(d, 0)) {
    case 0: {
      const lamports = u64(d, 4);
      const space = u64(d, 12);
      if (lamports === null || space === null || d.length < 52 || !a0 || !a1) return null;
      return { kind: 'create', from: a0, to: a1, mint: 'SOL', amount: lamports, space: Number(space), owner: base58Of(d.subarray(20, 52)) };
    }
    case 2: {
      const lamports = u64(d, 4);
      return lamports !== null && a0 && a1 ? { kind: 'sol', from: a0, to: a1, mint: 'SOL', amount: lamports } : null;
    }
    case 3: {
      // base (32), seed (u64 length + bytes), lamports, space, owner.
      const len = u64(d, 36);
      if (len === null || len > 32n) return null;
      const at = 44 + Number(len);
      const lamports = u64(d, at);
      const space = u64(d, at + 8);
      if (lamports === null || space === null || d.length < at + 48 || !a0 || !a1) return null;
      return { kind: 'create', from: a0, to: a1, mint: 'SOL', amount: lamports, space: Number(space), owner: base58Of(d.subarray(at + 16, at + 48)) };
    }
    case 11: {
      const lamports = u64(d, 4);
      return lamports !== null && a0 && a2 ? { kind: 'sol', from: a0, to: a2, mint: 'SOL', amount: lamports } : null;
    }
    default:
      return null;
  }
}

function fromToken(ix: FlowInstruction, mintOf: (account: Address) => Address | null): Raw | null {
  if (ix.parsed) {
    const { type, info } = ix.parsed;
    const amount = big(info.amount) ?? big((info.tokenAmount as { amount?: unknown } | undefined)?.amount);
    if (amount === null) return null;
    const mint = addr(info.mint);
    const source = addr(info.source);
    const destination = addr(info.destination);
    const account = addr(info.account);
    if ((type === 'transfer' || type === 'transferChecked') && source && destination) {
      const m = mint ?? mintOf(source) ?? mintOf(destination);
      return m ? { kind: 'token', from: source, to: destination, mint: m, amount } : null;
    }
    if ((type === 'mintTo' || type === 'mintToChecked') && mint && account) return { kind: 'mint', from: mint, to: account, mint, amount };
    if ((type === 'burn' || type === 'burnChecked') && mint && account) return { kind: 'burn', from: account, to: mint, mint, amount };
    return null;
  }
  const d = ix.data;
  if (!d) return null;
  const amount = u64(d, 1);
  const [a0, a1, a2] = ix.accounts;
  if (amount === null || !a0 || !a1) return null;
  switch (d[0]) {
    case 3: {
      const m = mintOf(a0) ?? mintOf(a1);
      return m ? { kind: 'token', from: a0, to: a1, mint: m, amount } : null;
    }
    case 12:
      return a2 ? { kind: 'token', from: a0, to: a2, mint: a1, amount } : null;
    case 7:
    case 14:
      return { kind: 'mint', from: a0, to: a1, mint: a0, amount };
    case 8:
    case 15:
      return { kind: 'burn', from: a0, to: a1, mint: a1, amount };
    default:
      return null;
  }
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Of(bytes: Uint8Array): Address {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out as Address;
}

/** SOL and token movements of `instructions`, in execution order. Zero amounts are dropped. */
export function transfersOf(instructions: readonly FlowInstruction[], mintOf: (account: Address) => Address | null, mintInfo: MintInfo): Transfer[] {
  const out: Transfer[] = [];
  for (const ix of instructions) {
    const raw = ix.programId === SYSTEM_PROGRAM ? fromSystem(ix) : TOKEN_PROGRAMS.has(ix.programId) ? fromToken(ix, mintOf) : null;
    if (!raw || raw.amount === 0n) continue;
    const info = raw.mint === 'SOL' ? { symbol: 'SOL', decimals: 9 } : mintInfo(raw.mint);
    out.push({ ...raw, ...(info && { symbol: info.symbol }), decimals: info?.decimals ?? null, instructionIndex: ix.instructionIndex, inner: ix.inner });
  }
  return out;
}

/** Top-level instructions, each followed by the ones it invoked. Inner instructions by index are resolved with `keys`. */
export function flowInstructions(
  top: readonly DecodedInstruction[],
  inner: { index: number; instructions: InnerInstruction[] }[] | undefined,
): FlowInstruction[] {
  const byIndex = new Map((inner ?? []).map((g) => [g.index, g.instructions]));
  return top.flatMap((ix) => [
    { programId: ix.programId, accounts: ix.accounts.map((a) => a.address), data: ix.data, instructionIndex: ix.index, inner: false },
    ...(byIndex.get(ix.index) ?? []).map((i) => ({ ...i, instructionIndex: ix.index, inner: true })),
  ]);
}

/** `meta.innerInstructions` by address; entries pointing past `keys` are dropped. */
export function metaInner(meta: TxMeta, keys: readonly Address[]): { index: number; instructions: InnerInstruction[] }[] {
  return (meta.innerInstructions ?? []).map((g) => ({
    index: g.index,
    instructions: g.instructions.flatMap((ix) => {
      const programId = keys[ix.programIdIndex];
      const accounts = ix.accounts.map((i) => keys[i]);
      return programId && accounts.every((a) => a) ? [{ programId, accounts: accounts as Address[], data: ix.data }] : [];
    }),
  }));
}

type State = { pre: RawAccount | null | undefined; post: RawAccount | null | undefined };

/** Facts from a pre and post state (simulation). `post === undefined`: after is unknown. */
export function factsFromStates(addresses: readonly Address[], stateOf: (a: Address) => State, mintInfo: MintInfo): AccountFact[] {
  return addresses.map((address) => {
    const { pre, post } = stateOf(address);
    const lifecycle: AccountFact['lifecycle'] =
      pre === null && post ? 'created' : pre && post === null ? 'closed' : pre === null ? 'missing' : 'existing';
    const shown = lifecycle === 'created' ? post : pre ?? post;
    const tokenPre = pre ? decodeTokenAccount(pre) : null;
    const tokenPost = post ? decodeTokenAccount(post) : null;
    const t = tokenPost ?? tokenPre;
    const lamports = (a: RawAccount | null | undefined) => (a === undefined ? null : (a?.lamports ?? 0n));
    const fact: AccountFact = {
      address,
      owner: shown?.owner ?? null,
      executable: shown?.executable ?? false,
      dataLength: shown ? shown.data.length : null,
      lamports: { before: lamports(pre), after: lamports(post) },
      lifecycle,
    };
    if (t) {
      const sameMint = (x: typeof t | null) => (x && x.mint === t.mint ? x.amount : null);
      fact.token = {
        mint: t.mint,
        holder: t.owner,
        ...(mintInfo(t.mint) && { symbol: mintInfo(t.mint)!.symbol }),
        decimals: mintInfo(t.mint)?.decimals ?? null,
        before: pre === null ? 0n : sameMint(tokenPre),
        after: post === null ? 0n : post === undefined ? null : sameMint(tokenPost),
      };
    }
    return fact;
  });
}

/** Facts of a landed transaction: lamports and token amounts from its meta, owners and sizes as of today. */
export function factsFromMeta(addresses: readonly Address[], meta: TxMeta, cache: AccountCache, mintInfo: MintInfo): AccountFact[] {
  const pre = new Map(meta.preTokenBalances.map((t) => [t.accountIndex, t]));
  const post = new Map(meta.postTokenBalances.map((t) => [t.accountIndex, t]));
  return addresses.map((address, i) => {
    const now = cache.get(address);
    const before = meta.preBalances[i] ?? null;
    const after = meta.postBalances[i] ?? null;
    const lifecycle: AccountFact['lifecycle'] =
      before === 0n && after !== null && after > 0n ? 'created' : before !== null && before > 0n && after === 0n ? 'closed' : before === 0n ? 'missing' : 'existing';
    const fact: AccountFact = {
      address,
      owner: now?.owner ?? null,
      ...(now && { ownerNow: true as const }),
      executable: now?.executable ?? false,
      dataLength: now ? now.data.length : null,
      lamports: { before, after },
      lifecycle,
    };
    const t = post.get(i) ?? pre.get(i);
    if (t) {
      const holder = t.owner ?? decodeTokenAccount(now)?.owner ?? null;
      if (holder) {
        const info = mintInfo(t.mint);
        const amount = (x: typeof t | undefined) => (x && x.mint === t.mint ? x.amount : null);
        fact.token = {
          mint: t.mint,
          holder,
          ...(info && { symbol: info.symbol }),
          decimals: info?.decimals ?? t.decimals,
          before: pre.has(i) ? amount(pre.get(i)) : lifecycle === 'created' ? 0n : null,
          after: post.has(i) ? amount(post.get(i)) : lifecycle === 'closed' ? 0n : null,
        };
      }
    }
    return fact;
  });
}
