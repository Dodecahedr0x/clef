import { MemoryChainReader, type InnerInstruction } from '@clef/rpc';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { address, createNoopSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import { explain, SYSTEM_PROGRAM as SYSTEM, TOKEN_PROGRAM as TOKEN, transfersOf, viewFor, type FlowInstruction } from '../src';
import { buildWire, ME, OTHER, simulateWith, tokenAccountData, USDC } from './helpers';

const SYSTEM_PROGRAM = address(SYSTEM);
const TOKEN_PROGRAM = address(TOKEN);
const NEW = address('GdxfTLbLv7wPJmBq3FfS3bUkMSWPdmDbcn3PzVgYGtAs');
const PROGRAM = address('EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy');
const SRC = address('csZXgw2G58hbiWc9ndxaxrQVYVvqdXgQzYLuznEzHJu');
const DST = address('9j8y2g8Cr6hp2SAP7P9prRQ1jSidJeyV6BnCE85VUkpj');

const usdc = (mint: Address) => (mint === USDC ? { symbol: 'USDC', decimals: 6 } : null);
const flow = (ix: Omit<FlowInstruction, 'instructionIndex' | 'inner'>, inner = false): FlowInstruction => ({ ...ix, instructionIndex: 0, inner });
const u64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

describe('transfersOf', () => {
  it('reads System transfers and account creations, with the new account owner and size', () => {
    const create = getCreateAccountInstruction({ payer: createNoopSigner(ME), newAccount: createNoopSigner(NEW), lamports: 2_039_280n, space: 165, programAddress: TOKEN_PROGRAM_ADDRESS });
    const transfer = getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 500_000_000n });
    const list = [create, transfer].map((ix) => flow({ programId: ix.programAddress, accounts: ix.accounts.map((a) => a.address), data: new Uint8Array(ix.data) }));
    expect(transfersOf(list, () => null, usdc)).toEqual([
      { kind: 'create', from: ME, to: NEW, mint: 'SOL', amount: 2_039_280n, symbol: 'SOL', decimals: 9, instructionIndex: 0, inner: false, owner: TOKEN_PROGRAM, space: 165 },
      { kind: 'sol', from: ME, to: OTHER, mint: 'SOL', amount: 500_000_000n, symbol: 'SOL', decimals: 9, instructionIndex: 0, inner: false },
    ]);
  });

  it('reads token transfers (mint from the instruction or the account), mints and burns', () => {
    const checked = getTransferCheckedInstruction({ source: SRC, mint: USDC, destination: DST, authority: createNoopSigner(ME), amount: 15_549_833n, decimals: 6 });
    const plain = new Uint8Array([3, ...u64(7n)]);
    const mintTo = new Uint8Array([7, ...u64(9n)]);
    const burn = new Uint8Array([8, ...u64(4n)]);
    const out = transfersOf(
      [
        flow({ programId: TOKEN_PROGRAM, accounts: checked.accounts.map((a) => a.address), data: new Uint8Array(checked.data) }),
        flow({ programId: TOKEN_PROGRAM, accounts: [SRC, DST, ME], data: plain }, true),
        flow({ programId: TOKEN_PROGRAM, accounts: [USDC, DST, ME], data: mintTo }),
        flow({ programId: TOKEN_PROGRAM, accounts: [SRC, USDC, ME], data: burn }),
      ],
      (a) => (a === SRC ? USDC : null),
      usdc,
    );
    expect(out.map((t) => [t.kind, t.from, t.to, t.amount, t.symbol, t.inner])).toEqual([
      ['token', SRC, DST, 15_549_833n, 'USDC', false],
      ['token', SRC, DST, 7n, 'USDC', true],
      ['mint', USDC, DST, 9n, 'USDC', false],
      ['burn', SRC, USDC, 4n, 'USDC', false],
    ]);
  });

  it('reads instructions the RPC returned parsed, and drops zero amounts and other programs', () => {
    const parsed = (programId: Address, type: string, info: Record<string, unknown>): FlowInstruction =>
      flow({ programId, accounts: [], data: null, parsed: { type, info } }, true);
    const out = transfersOf(
      [
        parsed(SYSTEM_PROGRAM, 'transfer', { source: ME, destination: OTHER, lamports: 5000 }),
        parsed(SYSTEM_PROGRAM, 'createAccount', { source: ME, newAccount: NEW, lamports: 1_000, space: 8, owner: PROGRAM }),
        parsed(TOKEN_PROGRAM, 'transferChecked', { source: SRC, destination: DST, mint: USDC, tokenAmount: { amount: '25', decimals: 6 } }),
        parsed(TOKEN_PROGRAM, 'transfer', { source: SRC, destination: DST, amount: '0' }),
        parsed(PROGRAM, 'transfer', { source: ME, destination: OTHER, lamports: 1 }),
      ],
      () => null,
      usdc,
    );
    expect(out.map((t) => [t.kind, t.amount, t.owner, t.space])).toEqual([
      ['sol', 5000n, undefined, undefined],
      ['create', 1000n, PROGRAM, 8],
      ['token', 25n, undefined, undefined],
    ]);
  });
});

describe('account facts and transfers in an explanation', () => {
  const idls = (reader: MemoryChainReader) => createDefaultResolver(reader, new UserIdlSource());

  it('simulated: marks the account it creates, with its owner after, and lists transfers the programs made', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: SYSTEM_PROGRAM, data: new Uint8Array(), lamports: 5_000_000_000n });
    reader.setAccount({ address: SRC, owner: TOKEN_PROGRAM, data: tokenAccountData(ME, USDC, 100n) });
    const create = getCreateAccountInstruction({ payer: createNoopSigner(ME), newAccount: createNoopSigner(NEW), lamports: 1_000_000n, space: 8, programAddress: PROGRAM });
    const wire = buildWire([create]);
    simulateWith(reader, { [NEW]: { owner: PROGRAM, lamports: 1_000_000n, data: new Uint8Array(8) }, [ME]: { lamports: 4_999_000_000n } });
    const sim = reader.simulateImpl;
    const inner: InnerInstruction[] = [{ programId: SYSTEM_PROGRAM, accounts: [], data: null, parsed: { type: 'transfer', info: { source: ME, destination: NEW, lamports: 1 } } }];
    reader.simulateImpl = async (w, a) => ({ ...(await sim(w, a)), innerInstructions: [{ index: 0, instructions: inner }] });

    const ex = await explain({ wire }, { reader, idls: idls(reader), me: [ME] });
    const fact = ex.accountFacts.find((f) => f.address === NEW)!;
    expect(fact).toMatchObject({ lifecycle: 'created', owner: PROGRAM, dataLength: 8, lamports: { before: 0n, after: 1_000_000n } });
    expect(ex.accountFacts.find((f) => f.address === ME)).toMatchObject({ lifecycle: 'existing', owner: SYSTEM_PROGRAM });
    expect(ex.transfers?.map((t) => [t.kind, t.from, t.to, t.amount, t.inner])).toEqual([
      ['create', ME, NEW, 1_000_000n, false],
      ['sol', ME, NEW, 1n, true],
    ]);
    expect(ex.transfersPartial).toBeUndefined();

    const view = viewFor(ex, 'expert');
    const v = view.accountFacts.find((f) => f.address === NEW)!;
    expect(v.lamports).toEqual({ before: '0 SOL', after: '0.001 SOL', delta: '+0.001 SOL' });
    expect(view.accountFacts.find((f) => f.address === ME)!.ownerName).toBe('System Program');
    expect(view.transfers?.[0]).toMatchObject({ kind: 'create', amount: '0.001 SOL', space: 8 });
  });

  it('simulated without inner instructions: only the top-level transfers, marked partial', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: SYSTEM_PROGRAM, data: new Uint8Array(), lamports: 5_000_000_000n });
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 10n })]);
    simulateWith(reader, { [OTHER]: { owner: SYSTEM_PROGRAM, lamports: 10n } });
    const ex = await explain({ wire }, { reader, idls: idls(reader), me: [ME] });
    expect(ex.transfers?.map((t) => [t.kind, t.amount])).toEqual([['sol', 10n]]);
    expect(ex.transfersPartial).toBe(true);
    expect(ex.accountFacts.find((f) => f.address === OTHER)).toMatchObject({ lifecycle: 'created', lamports: { before: 0n, after: 10n } });
  });

  it('failed simulation: no transfers, and after-state unknown', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: SYSTEM_PROGRAM, data: new Uint8Array(), lamports: 5n });
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 10n })]);
    reader.simulateImpl = async (_w, a) => ({ err: { InstructionError: [0, 'Custom'] }, logs: [], unitsConsumed: null, postAccounts: a.map(() => null) });
    const ex = await explain({ wire }, { reader, idls: idls(reader), me: [ME] });
    expect(ex.transfers).toBeNull();
    expect(ex.accountFacts.find((f) => f.address === ME)).toMatchObject({ lifecycle: 'existing', lamports: { before: 5n, after: null } });
    expect(ex.accountFacts.find((f) => f.address === OTHER)!.lifecycle).toBe('missing');
  });

  it('landed: lamports and token balances from the meta, transfers from its inner instructions, owners as of today', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: SYSTEM_PROGRAM, data: new Uint8Array(), lamports: 1n });
    reader.setAccount({ address: SRC, owner: TOKEN_PROGRAM, data: tokenAccountData(ME, USDC, 0n) });
    reader.setAccount({ address: DST, owner: TOKEN_PROGRAM, data: tokenAccountData(OTHER, USDC, 0n) });
    reader.setAccount({ address: OTHER, owner: SYSTEM_PROGRAM, data: new Uint8Array() });
    const wire = buildWire([getTransferCheckedInstruction({ source: SRC, mint: USDC, destination: DST, authority: createNoopSigner(ME), amount: 5n, decimals: 6 })]);
    const ex0 = await explain({ wire }, { reader, idls: idls(reader), me: [ME] });
    const keys = ex0.tx.accounts.map((a) => a.address);
    const i = (a: Address) => keys.indexOf(a);
    const innerTransfer = { programIdIndex: i(TOKEN_PROGRAM), accounts: [i(SRC), i(DST), i(ME)], data: new Uint8Array([3, ...u64(2n)]) };
    const meta = {
      err: null, fee: 5000n,
      preBalances: keys.map((a) => (a === ME ? 1_000_000n : 2_039_280n)),
      postBalances: keys.map((a) => (a === ME ? 995_000n : 2_039_280n)),
      preTokenBalances: [{ accountIndex: i(SRC), mint: USDC, owner: ME, amount: 10n, decimals: 6 }, { accountIndex: i(DST), mint: USDC, owner: OTHER, amount: 0n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: i(SRC), mint: USDC, owner: ME, amount: 5n, decimals: 6 }, { accountIndex: i(DST), mint: USDC, owner: OTHER, amount: 5n, decimals: 6 }],
      loadedAddresses: { writable: [], readonly: [] }, logMessages: [],
      innerInstructions: [{ index: 0, instructions: [innerTransfer] }],
    };
    const ex = await explain({ wire, meta }, { reader, idls: idls(reader), me: [ME] });
    expect(ex.accountFacts.find((f) => f.address === ME)).toMatchObject({ owner: SYSTEM_PROGRAM, ownerNow: true, lamports: { before: 1_000_000n, after: 995_000n } });
    expect(ex.accountFacts.find((f) => f.address === SRC)!.token).toMatchObject({ holder: ME, before: 10n, after: 5n, decimals: 6 });
    expect(ex.transfers?.map((t) => [t.kind, t.amount, t.inner])).toEqual([['token', 5n, false], ['token', 2n, true]]);
    expect(ex.transfersPartial).toBeUndefined();
    // The destination's holder is not in the transaction, yet hovering it shows its owner (read for display).
    expect(ex.tx.accounts.some((a) => a.address === OTHER)).toBe(false);
    expect(ex.accountFacts.find((f) => f.address === OTHER)).toMatchObject({ owner: SYSTEM_PROGRAM, ownerNow: true });
  });
});
