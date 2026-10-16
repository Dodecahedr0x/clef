import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { buildExecuteTransaction, buildProposeTransaction, buildVoteTransaction, vaultPda } from '../src';
import { b64, hex, mainnetReader, MEMBER, MULTISIG, sdk } from './helpers';

const BLOCKHASH = 'DAf6gxKCXQSwSPN2aXHBU2VkoaAHwm9dz5Fxg6cffhQt';

type Meta = [string, boolean, boolean];

/** Decodes an unsigned wire into fee payer, signature slots and instructions with resolved account metas. */
function decode(wire: Uint8Array) {
  const tx = getTransactionDecoder().decode(wire);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (msg.version !== 0) throw new Error('expected v0');
  const keys = msg.staticAccounts;
  const { numSignerAccounts: s, numReadonlySignerAccounts: rs, numReadonlyNonSignerAccounts: rn } = msg.header;
  const writable = (i: number) => (i < s ? i < s - rs : i < keys.length - rn);
  return {
    feePayer: keys[0],
    signatures: Object.entries(tx.signatures),
    lifetime: msg.lifetimeToken,
    version: msg.version,
    instructions: msg.instructions.map((ix) => ({
      programId: keys[ix.programAddressIndex],
      keys: (ix.accountIndices ?? []).map((i): Meta => [keys[i]!, i < s, writable(i)]),
      data: hex(new Uint8Array(ix.data ?? [])),
    })),
  };
}

/** Outer-transaction roles can only be stronger than the instruction's own (a fee payer is always writable). */
function expectCompatible(actual: Meta[], expected: Meta[]) {
  expect(actual.map((k) => k[0])).toEqual(expected.map((k) => k[0]));
  actual.forEach((k, i) => {
    const [, signer, writable] = expected[i]!;
    if (signer) expect(k[1]).toBe(true);
    if (writable) expect(k[2]).toBe(true);
    if (!signer && k[0] !== MEMBER) expect(k[1]).toBe(false);
  });
}

describe('buildProposeTransaction', () => {
  it('wraps the inner transaction: create, propose, approve, member pays', async () => {
    const wire = await buildProposeTransaction({ multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: b64(sdk.innerWire), transactionIndex: 390n, blockhash: BLOCKHASH });
    const tx = decode(wire);
    expect(tx.feePayer).toBe(MEMBER);
    expect(tx.signatures).toEqual([[MEMBER, null]]);
    expect(tx.lifetime).toBe(BLOCKHASH);
    expect(tx.instructions.map((ix) => ix.data.slice(0, 16))).toEqual(['30fa4ea8d0e2dad3', 'dc3c49e01e6c4f9f', '9025a488bcd82af8']);
    const [create, propose, approve] = tx.instructions;
    expect(create!.data).toBe(sdk.vaultTransactionCreate.data);
    expectCompatible(create!.keys, sdk.vaultTransactionCreate.keys);
    expect(propose!.data).toBe(sdk.proposalCreate.data);
    expectCompatible(propose!.keys, sdk.proposalCreate.keys);
    expect(approve!.data).toBe(sdk.proposalApprove.data);
    expectCompatible(approve!.keys, sdk.proposalApprove.keys);
    for (const ix of tx.instructions) expect(ix.programId).toBe('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
  });

  it('rejects an inner transaction signed by anyone but the vault', async () => {
    const vault3 = await vaultPda(MULTISIG, 3);
    await expect(
      buildProposeTransaction({ multisig: MULTISIG, vaultIndex: 3, member: MEMBER, innerWire: b64(sdk.innerWire), transactionIndex: 390n, blockhash: BLOCKHASH }),
    ).rejects.toThrow(vault3);
  });

  it('rejects malformed inner bytes', async () => {
    await expect(
      buildProposeTransaction({ multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: new Uint8Array([1, 2, 3]), transactionIndex: 390n, blockhash: BLOCKHASH }),
    ).rejects.toThrow();
  });
});

describe('buildVoteTransaction', () => {
  it.each([
    ['approve', sdk.proposalApprove],
    ['reject', sdk.proposalReject],
  ] as const)('%s', async (vote, expected) => {
    const tx = decode(await buildVoteTransaction({ multisig: MULTISIG, member: MEMBER, transactionIndex: 390n, vote, blockhash: BLOCKHASH }));
    expect(tx.feePayer).toBe(MEMBER);
    expect(tx.signatures).toEqual([[MEMBER, null]]);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]!.data).toBe(expected.data);
    expectCompatible(tx.instructions[0]!.keys, expected.keys);
  });
});

describe('buildExecuteTransaction', () => {
  it('passes the lookup tables and the inner accounts as remaining accounts (matches the Squads SDK)', async () => {
    const reader = mainnetReader(sdk.alts);
    const tx = decode(await buildExecuteTransaction(reader, { multisig: MULTISIG, member: MEMBER, transactionIndex: 387n, blockhash: BLOCKHASH }));
    expect(tx.feePayer).toBe(MEMBER);
    expect(tx.signatures).toEqual([[MEMBER, null]]);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]!.data).toBe(sdk.execute387.data);
    expectCompatible(tx.instructions[0]!.keys, sdk.execute387.keys);
  });

  it('fails when the transaction account is missing', async () => {
    await expect(buildExecuteTransaction(mainnetReader(), { multisig: MULTISIG, member: MEMBER, transactionIndex: 999n, blockhash: BLOCKHASH })).rejects.toThrow(/not found/);
  });

  it('fails when a lookup table is missing', async () => {
    await expect(buildExecuteTransaction(mainnetReader(), { multisig: MULTISIG, member: MEMBER, transactionIndex: 387n, blockhash: BLOCKHASH })).rejects.toThrow(/lookup table/i);
  });
});

