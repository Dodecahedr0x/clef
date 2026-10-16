import { describe, expect, it } from 'vitest';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  AccountRole,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferCheckedInstruction } from '@solana-program/token';
import { MemoryChainReader, type TokenBalance, type TxMeta } from '@clef/rpc';
import { defaultExplainContext } from '@clef/explain';
import { loadHistory } from '../src/history';
import type { PortfolioReader, SignatureInfo } from '../src/deps';

const ME = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const POOL = address('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH');
const MY_USDC = address('3Kz9wEe2Pzz2ExxmdKG7fE4WfNbN3V6WxGW8TMwCtXz3');
const OTHER_USDC = address('8ZUczUAUSLtZDhWJcrYQ5HTSkP1W2EAYhs6Jx3jzS3Ca');
const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const JUPITER = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash;
const SOL = 1_000_000_000n;
const FEE = 5000n;

function buildWire(instructions: Instruction[], feePayer: Address): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

type TokenSide = { account: Address; owner: Address; pre: bigint; post: bigint };

/** Meta from per-address lamport deltas and USDC token balances; 10 SOL before for every account. */
function metaFor(wire: Uint8Array, lamports: Record<string, bigint>, tokens: TokenSide[] = [], err: unknown = null): TxMeta {
  const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
  const keys = msg.staticAccounts as Address[];
  const tb = (side: 'pre' | 'post'): TokenBalance[] =>
    tokens.map((t) => ({ accountIndex: keys.indexOf(t.account), mint: USDC, owner: t.owner, amount: t[side], decimals: 6 }));
  return {
    err, fee: FEE,
    preBalances: keys.map(() => 10n * SOL),
    postBalances: keys.map((k) => 10n * SOL + (lamports[k] ?? 0n)),
    preTokenBalances: tb('pre'), postTokenBalances: tb('post'),
    loadedAddresses: { writable: [], readonly: [] }, logMessages: [],
  };
}

const solTransfer = (from: Address, to: Address, amount: bigint) =>
  getTransferSolInstruction({ source: createNoopSigner(from), destination: to, amount });
const usdcTransfer = (from: Address, authority: Address, to: Address, amount: bigint) =>
  getTransferCheckedInstruction({ source: from, mint: USDC, destination: to, authority: createNoopSigner(authority), amount, decimals: 6 });
const jupiterIx = (): Instruction => ({
  programAddress: JUPITER,
  accounts: [
    { address: ME, role: AccountRole.WRITABLE_SIGNER },
    { address: MY_USDC, role: AccountRole.WRITABLE },
    { address: POOL, role: AccountRole.WRITABLE },
  ],
  data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
});

function setup(txs: Record<string, { wire: Uint8Array; meta: TxMeta | null } | null>, errs: Record<string, unknown> = {}) {
  const chain = new MemoryChainReader();
  const sigs: SignatureInfo[] = Object.keys(txs).map((signature, i) => ({ signature, slot: BigInt(100 - i), blockTime: 1_700_000_000 - i, err: errs[signature] ?? null }));
  for (const [sig, tx] of Object.entries(txs)) if (tx) chain.transactions.set(sig, { ...tx, slot: 1n, blockTime: 1n });
  const calls: { address: Address; opts: { before?: string; limit: number } }[] = [];
  const reader = {
    async getSignatures(addr: Address, opts: { before?: string; limit: number }) {
      calls.push({ address: addr, opts });
      return sigs;
    },
  } as unknown as PortfolioReader;
  return { deps: { reader, chain, explainCtx: defaultExplainContext(chain, [ME]) }, calls };
}

async function one(tx: { wire: Uint8Array; meta: TxMeta | null } | null, err: unknown = null) {
  const { deps } = setup({ s1: tx }, { s1: err });
  const { items } = await loadHistory(deps, ME, { limit: 10 });
  return items[0]!;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

describe('loadHistory', () => {
  it('SOL send: kind send, deltas exclude the fee, fee shown separately', async () => {
    const wire = buildWire([solTransfer(ME, OTHER, SOL)], ME);
    const item = await one({ wire, meta: metaFor(wire, { [ME]: -SOL - FEE, [OTHER]: SOL }) });
    expect(item).toMatchObject({ signature: 's1', slot: 100n, blockTime: 1_700_000_000, status: 'success', kind: 'send', title: `Sent to ${short(OTHER)}`, fee: '0.000005' });
    expect(item.deltas).toEqual([{ symbol: 'SOL', amount: '1', direction: 'out' }]);
    expect(item.subtitle).toBe('System Program');
  });

  it('SOL receive: kind receive from the counterparty', async () => {
    const wire = buildWire([solTransfer(OTHER, ME, 2n * SOL)], OTHER);
    const item = await one({ wire, meta: metaFor(wire, { [OTHER]: -2n * SOL - FEE, [ME]: 2n * SOL }) });
    expect(item).toMatchObject({ kind: 'receive', title: `Received from ${short(OTHER)}` });
    expect(item.deltas).toEqual([{ symbol: 'SOL', amount: '2', direction: 'in' }]);
  });

  it('USDC receive: counterparty is the token owner, address book label used', async () => {
    const wire = buildWire([usdcTransfer(OTHER_USDC, OTHER, MY_USDC, 1_500_000n)], OTHER);
    const meta = metaFor(wire, { [OTHER]: -FEE }, [
      { account: OTHER_USDC, owner: OTHER, pre: 5_000_000n, post: 3_500_000n },
      { account: MY_USDC, owner: ME, pre: 0n, post: 1_500_000n },
    ]);
    const { deps } = setup({ s1: { wire, meta } });
    const { items } = await loadHistory({ ...deps, explainCtx: { ...deps.explainCtx, addressBook: { [OTHER]: 'Alice' } } }, ME, { limit: 10 });
    expect(items[0]).toMatchObject({ kind: 'receive', title: 'Received from Alice' });
    expect(items[0]!.deltas).toEqual([{ symbol: 'USDC', amount: '1.5', direction: 'in' }]);
  });

  it('SOL out + USDC in: swap', async () => {
    const wire = buildWire([jupiterIx()], ME);
    const meta = metaFor(wire, { [ME]: -SOL - FEE, [POOL]: SOL }, [{ account: MY_USDC, owner: ME, pre: 0n, post: 150_000_000n }]);
    const item = await one({ wire, meta });
    expect(item).toMatchObject({ status: 'success', kind: 'swap', title: 'Swap SOL → USDC' });
    expect(item.deltas).toEqual([
      { symbol: 'SOL', amount: '1', direction: 'out' },
      { symbol: 'USDC', amount: '150', direction: 'in' },
    ]);
  });

  it('no owner delta: other, title from the summary truncated to 48 chars', async () => {
    const wire = buildWire([solTransfer(OTHER, POOL, SOL)], OTHER);
    const item = await one({ wire, meta: metaFor(wire, { [OTHER]: -SOL - FEE, [POOL]: SOL }) });
    expect(item.kind).toBe('other');
    expect(item.deltas).toEqual([]);
    expect(item.title.length).toBeGreaterThan(0);
    expect(item.title.length).toBeLessThanOrEqual(49);
  });

  it('only the fee moved for the payer: other', async () => {
    const wire = buildWire([solTransfer(ME, ME, 0n)], ME);
    const item = await one({ wire, meta: metaFor(wire, { [ME]: -FEE }) });
    expect(item).toMatchObject({ kind: 'other', deltas: [], fee: '0.000005' });
  });

  it('failed Jupiter tx: swap failed, nothing moved', async () => {
    const wire = buildWire([jupiterIx()], ME);
    const err = { InstructionError: [0, { Custom: 6001 }] };
    const item = await one({ wire, meta: metaFor(wire, { [ME]: -FEE }, [], err) }, err);
    expect(item).toMatchObject({ status: 'failed', kind: 'swap', title: 'Swap failed', subtitle: 'nothing moved', deltas: [], fee: '0.000005' });
  });

  it('failed System transfer: send failed (status from meta.err alone)', async () => {
    const wire = buildWire([solTransfer(ME, OTHER, SOL)], ME);
    const item = await one({ wire, meta: metaFor(wire, { [ME]: -FEE }, [], { InstructionError: [0, 'Custom'] }) });
    expect(item).toMatchObject({ status: 'failed', kind: 'send', title: 'Send failed', deltas: [] });
  });

  it('failed tx with no transfer or DEX: transaction failed', async () => {
    const wire = buildWire([solTransfer(OTHER, POOL, SOL)], OTHER);
    const item = await one({ wire, meta: metaFor(wire, { [OTHER]: -FEE }, [], 'err') });
    expect(item).toMatchObject({ status: 'failed', kind: 'other', title: 'Transaction failed' });
  });

  it('missing tx: other, details unavailable, status from the signature', async () => {
    const item = await one(null, { InstructionError: [0, 'x'] });
    expect(item).toMatchObject({ status: 'failed', kind: 'other', title: 'Transaction', subtitle: 'details unavailable', deltas: [], fee: '' });
  });

  it('keeps order and pages: next is the last signature iff the page is full', async () => {
    const wire = buildWire([solTransfer(ME, OTHER, SOL)], ME);
    const tx = { wire, meta: metaFor(wire, { [ME]: -SOL - FEE, [OTHER]: SOL }) };
    const { deps, calls } = setup({ a: tx, b: null, c: tx });
    const full = await loadHistory(deps, ME, { limit: 3, before: 'z' });
    expect(full.items.map((i) => i.signature)).toEqual(['a', 'b', 'c']);
    expect(full.next).toBe('c');
    expect(calls[0]).toEqual({ address: ME, opts: { limit: 3, before: 'z' } });
    const partial = await loadHistory(deps, ME, { limit: 4 });
    expect(partial.next).toBeUndefined();
    expect('next' in partial).toBe(false);
  });
});
