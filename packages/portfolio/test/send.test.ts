import { describe, expect, it } from 'vitest';
import {
  address,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import { getMintEncoder, findAssociatedTokenPda, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { MemoryChainReader } from '@clef/rpc';
import * as programs from '@clef/explain';

const SYSTEM_PROGRAM = address(programs.SYSTEM_PROGRAM);
const TOKEN_PROGRAM = address(programs.TOKEN_PROGRAM);
const TOKEN_2022_PROGRAM = address(programs.TOKEN_2022_PROGRAM);
import { buildSendTransaction } from '../src/send';
import type { PortfolioReader } from '../src/deps';

const FROM = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const TO = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';

const reader = {
  getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1234n }),
} as unknown as PortfolioReader;

function mintData(decimals: number): Uint8Array {
  return new Uint8Array(
    getMintEncoder().encode({
      mintAuthority: null,
      supply: 1_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthority: null,
    }),
  );
}

function chainWithMint(owner: Address | null): MemoryChainReader {
  const chain = new MemoryChainReader();
  if (owner) chain.accounts.set(MINT, { address: MINT, owner, lamports: 1n, data: mintData(6), executable: false });
  return chain;
}

function decode(wire: Uint8Array) {
  const tx = getTransactionDecoder().decode(wire);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const keys = msg.staticAccounts;
  type CompiledIx = { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array };
  const ixs = (msg as unknown as { instructions: CompiledIx[] }).instructions.map((ix) => ({
    program: keys[ix.programAddressIndex]!,
    accounts: (ix.accountIndices ?? []).map((i) => keys[i]!),
    data: ix.data ?? new Uint8Array(),
  }));
  return { tx, msg, ixs };
}

function expectUnsigned(wire: Uint8Array) {
  const { tx, msg } = decode(wire);
  expect(msg.version).toBe(0);
  expect(msg.staticAccounts[0]).toBe(FROM);
  expect(msg.lifetimeToken).toBe(BLOCKHASH);
  const sigs = Object.entries(tx.signatures);
  expect(sigs.map(([k]) => k)).toEqual([FROM]);
  for (const [, s] of sigs) expect(s === null || (s as Uint8Array).every((b) => b === 0)).toBe(true);
  expect(wire[0]).toBe(1);
  expect(wire.slice(1, 65).every((b) => b === 0)).toBe(true);
}

describe('buildSendTransaction', () => {
  it('SOL transfer: system transfer, unsigned, fee payer from, blockhash from reader', async () => {
    const r = await buildSendTransaction({ chain: new MemoryChainReader(), reader }, { from: FROM, to: TO, mint: 'SOL', amount: 5000n });
    expect(r.wire).toBeInstanceOf(Uint8Array);
    expect(r.createsAta).toBe(false);
    expect(r.lastValidBlockHeight).toBe(1234n);
    expectUnsigned(r.wire);
    const { ixs } = decode(r.wire);
    expect(ixs).toHaveLength(1);
    expect(ixs[0]!.program).toBe(SYSTEM_PROGRAM);
    expect(ixs[0]!.accounts).toEqual([FROM, TO]);
    expect(new DataView(ixs[0]!.data.buffer, ixs[0]!.data.byteOffset).getBigUint64(4, true)).toBe(5000n);
  });

  it('SPL transfer to missing ATA: createIdempotent then transferChecked', async () => {
    const chain = chainWithMint(TOKEN_PROGRAM);
    const r = await buildSendTransaction({ chain, reader }, { from: FROM, to: TO, mint: MINT, amount: 42n });
    expect(r.createsAta).toBe(true);
    expectUnsigned(r.wire);
    const [srcAta] = await findAssociatedTokenPda({ owner: FROM, mint: MINT, tokenProgram: TOKEN_PROGRAM });
    const [dstAta] = await findAssociatedTokenPda({ owner: TO, mint: MINT, tokenProgram: TOKEN_PROGRAM });
    const { ixs } = decode(r.wire);
    expect(ixs.map((i) => i.program)).toEqual([ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM]);
    expect(ixs[0]!.data[0]).toBe(1);
    expect(ixs[0]!.accounts.slice(0, 4)).toEqual([FROM, dstAta, TO, MINT]);
    expect(ixs[0]!.accounts[5]).toBe(TOKEN_PROGRAM);
    expect(ixs[1]!.data[0]).toBe(12);
    expect(ixs[1]!.accounts).toEqual([srcAta, MINT, dstAta, FROM]);
    expect(ixs[1]!.data[9]).toBe(6);
  });

  it('SPL transfer to existing ATA: no create', async () => {
    const chain = chainWithMint(TOKEN_PROGRAM);
    const [dstAta] = await findAssociatedTokenPda({ owner: TO, mint: MINT, tokenProgram: TOKEN_PROGRAM });
    chain.accounts.set(dstAta, { address: dstAta, owner: TOKEN_PROGRAM, lamports: 1n, data: new Uint8Array(165), executable: false });
    const r = await buildSendTransaction({ chain, reader }, { from: FROM, to: TO, mint: MINT, amount: 42n });
    expect(r.createsAta).toBe(false);
    const { ixs } = decode(r.wire);
    expect(ixs.map((i) => i.program)).toEqual([TOKEN_PROGRAM]);
    expect(ixs[0]!.accounts[2]).toBe(dstAta);
  });

  it('Token-2022 mint: ATAs derived under Token-2022, transferChecked sent to Token-2022', async () => {
    const chain = chainWithMint(TOKEN_2022_PROGRAM);
    const r = await buildSendTransaction({ chain, reader }, { from: FROM, to: TO, mint: MINT, amount: 7n });
    expect(r.createsAta).toBe(true);
    const [srcAta] = await findAssociatedTokenPda({ owner: FROM, mint: MINT, tokenProgram: TOKEN_2022_PROGRAM });
    const [dstAta] = await findAssociatedTokenPda({ owner: TO, mint: MINT, tokenProgram: TOKEN_2022_PROGRAM });
    const [legacyDst] = await findAssociatedTokenPda({ owner: TO, mint: MINT, tokenProgram: TOKEN_PROGRAM });
    expect(dstAta).not.toBe(legacyDst);
    const { ixs } = decode(r.wire);
    expect(ixs.map((i) => i.program)).toEqual([ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM]);
    expect(ixs[0]!.accounts[1]).toBe(dstAta);
    expect(ixs[0]!.accounts[5]).toBe(TOKEN_2022_PROGRAM);
    expect(ixs[1]!.accounts).toEqual([srcAta, MINT, dstAta, FROM]);
  });

  it('unknown mint throws', async () => {
    await expect(buildSendTransaction({ chain: chainWithMint(null), reader }, { from: FROM, to: TO, mint: MINT, amount: 1n })).rejects.toThrow('Unknown token mint');
    await expect(buildSendTransaction({ chain: chainWithMint(SYSTEM_PROGRAM), reader }, { from: FROM, to: TO, mint: MINT, amount: 1n })).rejects.toThrow('Unknown token mint');
  });
});
