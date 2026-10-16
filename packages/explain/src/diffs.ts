import { BUNDLED_PROGRAM_IDS, type IdlResolver } from '@clef/idl';
import type { RawAccount } from '@clef/rpc';
import { parseAccountData } from '@codama/dynamic-parsers';
import { getLastNodeFromPath } from '@codama/visitors-core';
import { getBase16Encoder, getBase58Encoder, getBase64Encoder, getUtf8Encoder, type Address, type ReadonlyUint8Array } from '@solana/kit';
import { decodeTokenAccount, type TokenAccountInfo } from './accounts';
import { formatUnits } from './format';
import { shortAddress, type Labeler } from './labels';
import { SYSTEM_PROGRAM } from './registry';
import { sanitizeText } from './text';
import type { AccountDiff, ByteChange, FieldChange } from './types';

export type DiffInput = { address: Address; pre: RawAccount | null; post: RawAccount | null };
export type DiffDeps = { idls: IdlResolver; labeler: Labeler; me: readonly Address[]; addressBook?: Readonly<Record<string, string>> };

const MAX_RUN = 16;
const MAX_BYTE_CHANGES = 64;
const MAX_FIELDS = 64;

export function groupDigits(n: bigint): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_');
  return negative ? `-${digits}` : digits;
}

const hexBytes = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Changed byte positions grouped into contiguous runs of at most 16 bytes. Bytes past the shorter side count as changed. */
export function byteChanges(before: Uint8Array, after: Uint8Array): ByteChange[] {
  const out: ByteChange[] = [];
  const length = Math.max(before.length, after.length);
  let i = 0;
  while (i < length) {
    if (i < before.length && i < after.length && before[i] === after[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < length && i - start < MAX_RUN && !(i < before.length && i < after.length && before[i] === after[i])) i++;
    out.push({ offset: start, before: hexBytes(before.subarray(start, i)), after: hexBytes(after.subarray(start, i)) });
  }
  return out;
}

function changedByteCount(before: Uint8Array, after: Uint8Array): number {
  let n = Math.abs(before.length - after.length);
  for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i] !== after[i]) n++;
  return n;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** No account, or an emptied one (closed accounts can come back as 0 lamports, no data). */
const absent = (a: RawAccount | null): a is null => !a || (a.lamports === 0n && a.data.length === 0);

function sameState(pre: RawAccount | null, post: RawAccount | null): boolean {
  if (absent(pre) || absent(post)) return absent(pre) && absent(post);
  return pre.lamports === post.lamports && pre.owner === post.owner && sameBytes(pre.data, post.data);
}

const arrow = (before: string | undefined, after: string | undefined) =>
  before !== undefined && after !== undefined ? (before === after ? before : `${before} → ${after}`) : (before ?? after);

function field(path: string, before: string | null, after: string | null, note?: string): FieldChange {
  return note ? { path, before, after, note } : { path, before, after };
}

type Decoded = NonNullable<AccountDiff['decoded']>;

function tokenFields(pre: TokenAccountInfo | null, post: TokenAccountInfo | null, deps: DiffDeps): Decoded {
  const me = new Set<string>(deps.me);
  const who = (a: Address | null | undefined) => (a ? (me.has(a) ? 'you' : (deps.labeler.label(a) ?? shortAddress(a))) : undefined);
  const mint = (post ?? pre)!.mint;
  const info = deps.labeler.mintInfo(mint);
  const amount = (t: TokenAccountInfo | null) => (t ? `${formatUnits(t.amount, info?.decimals ?? null)}${info ? ` ${info.symbol}` : ''}` : undefined);
  const both = pre && post;
  const rows: { path: string; b: string | null; a: string | null; note?: string; keep: boolean }[] = [
    { path: 'owner', b: pre?.owner ?? null, a: post?.owner ?? null, note: arrow(who(pre?.owner), who(post?.owner)), keep: true },
    { path: 'mint', b: pre?.mint ?? null, a: post?.mint ?? null, note: info?.symbol, keep: true },
    { path: 'amount', b: pre ? groupDigits(pre.amount) : null, a: post ? groupDigits(post.amount) : null, note: arrow(amount(pre), amount(post)), keep: true },
    { path: 'delegate', b: pre?.delegate ?? null, a: post?.delegate ?? null, note: arrow(who(pre?.delegate), who(post?.delegate)), keep: !!(pre?.delegate ?? post?.delegate) },
    {
      path: 'delegatedAmount', b: pre ? groupDigits(pre.delegatedAmount) : null, a: post ? groupDigits(post.delegatedAmount) : null,
      keep: (pre ?? post)!.delegatedAmount > 0n,
    },
    { path: 'closeAuthority', b: pre?.closeAuthority ?? null, a: post?.closeAuthority ?? null, note: arrow(who(pre?.closeAuthority), who(post?.closeAuthority)), keep: !!(pre?.closeAuthority ?? post?.closeAuthority) },
  ];
  const changed: FieldChange[] = [];
  const context: FieldChange[] = [];
  for (const r of rows) {
    if (both) {
      if (r.b !== r.a) changed.push(field(r.path, r.b, r.a, r.note));
      else if (r.path === 'mint') context.push(field(r.path, r.b, r.a, r.note));
    } else if (r.keep) {
      changed.push(field(r.path, r.b, r.a, r.note));
    }
  }
  return { by: 'token', type: 'Token account', changed, context };
}

/** IDL-decoded values as display strings, flattened to dotted paths. Values and keys come from an IDL: sanitized. */
function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (out.size >= MAX_FIELDS) return;
  if (value === null || value === undefined) out.set(path, 'null');
  else if (typeof value === 'bigint') out.set(path, groupDigits(value));
  else if (typeof value === 'number') out.set(path, Number.isInteger(value) ? groupDigits(BigInt(value)) : String(value));
  else if (typeof value === 'boolean') out.set(path, String(value));
  else if (typeof value === 'string') out.set(path, sanitizeText(value, 128));
  else if (value instanceof Uint8Array) out.set(path, hexBytes(value));
  else if (Array.isArray(value)) {
    const bytes = encodedBytes(value);
    if (bytes) out.set(path, bytes);
    else if (value.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 256)) out.set(path, hexBytes(Uint8Array.from(value)));
    else value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (path || k !== 'discriminator') flatten(v, path ? `${path}.${sanitizeText(k)}` : sanitizeText(k), out);
  } else out.set(path, sanitizeText(String(value), 128));
}

const BYTE_ENCODERS: Record<string, () => { encode(s: string): ReadonlyUint8Array }> = {
  base16: getBase16Encoder, base58: getBase58Encoder, base64: getBase64Encoder, utf8: getUtf8Encoder,
};

/** Codama dynamic codecs decode bytes as an `[encoding, data]` tuple: shown as hex. */
function encodedBytes(value: unknown[]): string | null {
  const [encoding, data] = value;
  if (value.length !== 2 || typeof encoding !== 'string' || typeof data !== 'string' || !Object.hasOwn(BYTE_ENCODERS, encoding)) return null;
  try {
    return hexBytes(new Uint8Array(BYTE_ENCODERS[encoding]!().encode(data)));
  } catch {
    return null;
  }
}

type IdlDecode = { type: string; fields: Map<string, string> } | 'no-idl' | 'failed';

async function decodeWithIdl(owner: Address, sides: readonly RawAccount[], idls: IdlResolver): Promise<IdlDecode> {
  const curatedOnly = BUNDLED_PROGRAM_IDS.has(owner);
  let tried = false;
  for await (const idl of idls.candidates(owner)) {
    if (curatedOnly && idl.trust !== 'curated') continue;
    tried = true;
    try {
      const parsed = sides.map((s) => parseAccountData(idl.root, s.data, { programAddress: owner }));
      if (parsed.some((p) => !p)) continue;
      const names = new Set(parsed.map((p) => getLastNodeFromPath(p!.path).name));
      if (names.size !== 1) continue;
      const name = sanitizeText([...names][0]!);
      const fields = parsed.map((p) => {
        const out = new Map<string, string>();
        flatten(p!.data, '', out);
        return out;
      });
      return { type: name.charAt(0).toUpperCase() + name.slice(1), fields: fields.length === 1 ? fields[0]! : mergeFields(fields[0]!, fields[1]!) };
    } catch {
      // An IDL that fails on this data is just not the right one.
    }
  }
  return tried ? 'failed' : 'no-idl';
}

/** Pairs keyed by path: `before\u0000after`. */
function mergeFields(before: Map<string, string>, after: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const k of new Set([...before.keys(), ...after.keys()])) out.set(k, `${before.get(k) ?? ''}\u0000${after.get(k) ?? ''}`);
  return out;
}

function idlFields(fields: Map<string, string>, pre: boolean, post: boolean): Pick<Decoded, 'changed' | 'context'> {
  const changed: FieldChange[] = [];
  const context: FieldChange[] = [];
  for (const [path, v] of fields) {
    if (pre && post) {
      const [b, a] = v.split('\u0000') as [string, string];
      (b === a ? context : changed).push(field(path, b || null, a || null));
    } else changed.push(field(path, pre ? v : null, post ? v : null));
  }
  return { changed, context };
}

function title(address: Address, token: TokenAccountInfo | null, deps: DiffDeps): string {
  const me = new Set<string>(deps.me);
  if (me.has(address)) {
    const book = deps.addressBook && Object.hasOwn(deps.addressBook, address) ? sanitizeText(deps.addressBook[address]!, 64).trim() : '';
    return book ? `You · ${book}` : 'Your wallet';
  }
  if (token) {
    const symbol = deps.labeler.mintInfo(token.mint)?.symbol ?? shortAddress(token.mint);
    if (me.has(token.owner)) return `Your ${symbol} account`;
    return `${deps.labeler.label(token.owner) ?? shortAddress(token.owner)}'s ${symbol} account`;
  }
  return deps.labeler.label(address)?.replace(/ token account$/, ' account') ?? shortAddress(address);
}

async function diffOne({ address, pre: rawPre, post: rawPost }: DiffInput, deps: DiffDeps): Promise<AccountDiff | null> {
  if (sameState(rawPre, rawPost)) return null;
  const pre = absent(rawPre) ? null : rawPre;
  const post = absent(rawPost) ? null : rawPost;
  const sides = [pre, post].filter((s): s is RawAccount => s !== null);
  const preToken = decodeTokenAccount(pre);
  const postToken = decodeTokenAccount(post);
  const token = postToken ?? preToken;
  const me = new Set<string>(deps.me);

  let decoded: AccountDiff['decoded'] = null;
  let undecodedReason: string | undefined;
  if (sides.every((s) => decodeTokenAccount(s))) {
    decoded = tokenFields(preToken, postToken, deps);
  } else if (sides.every((s) => s.owner === SYSTEM_PROGRAM && s.data.length === 0)) {
    decoded = { by: 'system', type: 'System account', changed: [], context: [] };
  } else {
    const owner = (post ?? pre)!.owner;
    const result = sides.every((s) => s.owner === owner) ? await decodeWithIdl(owner, sides, deps.idls) : 'failed';
    if (typeof result === 'object') decoded = { by: 'idl', type: result.type, ...idlFields(result.fields, !!pre, !!post) };
    else if (result === 'no-idl') undecodedReason = `no IDL for owner program ${shortAddress(owner)}`;
    else undecodedReason = `IDL for ${shortAddress(owner)} did not decode this account`;
  }

  const before = pre?.data ?? new Uint8Array();
  const after = post?.data ?? new Uint8Array();
  const raw = decoded === null && !sameBytes(before, after)
    ? { size: { before: before.length, after: after.length }, changes: byteChanges(before, after).slice(0, MAX_BYTE_CHANGES), changedBytes: changedByteCount(before, after) }
    : null;

  return {
    address,
    title: title(address, token, deps),
    mine: me.has(address) || (!!token && me.has(token.owner)) || (!!preToken && me.has(preToken.owner)),
    lifecycle: !pre ? 'created' : !post ? 'closed' : 'modified',
    owner: { before: pre?.owner ?? null, after: post?.owner ?? null },
    lamports: { before: pre?.lamports ?? 0n, after: post?.lamports ?? 0n },
    decoded,
    raw,
    ...(raw && undecodedReason && { undecodedReason }),
  };
}

/** Per-account state diffs between pre and post states (e.g. a simulation). Unchanged accounts are omitted. */
export async function computeAccountDiffs(inputs: readonly DiffInput[], deps: DiffDeps): Promise<AccountDiff[]> {
  const diffs = await Promise.all(inputs.map((i) => diffOne(i, deps)));
  return diffs.filter((d): d is AccountDiff => d !== null);
}
