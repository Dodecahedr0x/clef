import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  buildExecuteTransaction,
  buildProposeTransaction,
  buildProposeTransactions,
  buildVoteTransaction,
  encodeTransactionMessage,
  outerInstructionNames,
  SQUADS_PROGRAM_ID,
  ephemeralSignerPda,
  transactionBufferPda,
  transactionPda,
  vaultMessageFromWire,
  vaultPda,
} from '../src';
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


const SYSTEM = '11111111111111111111111111111111' as Address;
const NEW_ACCOUNT = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');

function innerWire(feePayer: Address, instructions: Instruction[]): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

const transfer = (from: Address, to: Address, lamports: bigint): Instruction => ({
  programAddress: SYSTEM,
  accounts: [
    { address: from, role: AccountRole.WRITABLE_SIGNER },
    { address: to, role: AccountRole.WRITABLE },
  ],
  data: new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(lamports)]),
});

const createAccount = (from: Address, to: Address): Instruction => ({
  programAddress: SYSTEM,
  accounts: [
    { address: from, role: AccountRole.WRITABLE_SIGNER },
    { address: to, role: AccountRole.WRITABLE_SIGNER },
  ],
  data: new Uint8Array([0, 0, 0, 0, ...getU64Encoder().encode(1_000_000n), ...getU64Encoder().encode(0n), ...new Uint8Array(32)]),
});

/** Squads' `vault_transaction_create` args after the discriminator: vault index, ephemeral signers, message. */
function createArgs(data: string) {
  const b = Buffer.from(data, 'hex');
  const len = b.readUInt32LE(10);
  return { vaultIndex: b[8], ephemeralSigners: b[9], message: new Uint8Array(b.subarray(14, 14 + len)) };
}

describe('buildProposeTransactions', () => {
  it('returns the single proposal transaction when it fits', async () => {
    const p = { multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: b64(sdk.innerWire), transactionIndex: 390n, blockhash: BLOCKHASH };
    expect(await buildProposeTransactions(mainnetReader(), p)).toEqual([await buildProposeTransaction(p)]);
  });

  it('buffers a message too large for one transaction: create, extend*, create-from-buffer + propose + approve', async () => {
    const vault = await vaultPda(MULTISIG, 0);
    const recipients = await Promise.all(Array.from({ length: 4 }, (_, i) => vaultPda(MULTISIG, i + 10)));
    const inner = innerWire(vault, Array.from({ length: 60 }, (_, i) => transfer(vault, recipients[i % 4]!, BigInt(i + 1))));
    const p = { multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: inner, transactionIndex: 390n, blockhash: BLOCKHASH };
    await expect(buildProposeTransaction(p)).rejects.toThrow(/buffer/i);

    const wires = await buildProposeTransactions(mainnetReader(), p);
    expect(wires.length).toBeGreaterThanOrEqual(2);
    const txs = wires.map(decode);
    for (const [i, w] of wires.entries()) {
      expect(w.length).toBeLessThanOrEqual(1232);
      expect(txs[i]!.feePayer).toBe(MEMBER);
      expect(txs[i]!.signatures).toEqual([[MEMBER, null]]);
    }
    const discs = txs.map((t) => t.instructions.map((ix) => ix.data.slice(0, 16)));
    expect(discs[0]).toEqual(['f5c9716c253f1d59']);
    for (const d of discs.slice(1, -1)) expect(d).toEqual(['e69d433805eef592']);
    expect(discs.at(-1)).toEqual(['de36954457f630e7', 'dc3c49e01e6c4f9f', '9025a488bcd82af8']);

    const buffer = await transactionBufferPda(MULTISIG, MEMBER, 390 % 256);
    const expected = encodeTransactionMessage(vaultMessageFromWire(inner));
    const first = Buffer.from(txs[0]!.instructions[0]!.data, 'hex');
    expect(first[8]).toBe(390 % 256); // buffer index
    expect(first[9]).toBe(0); // vault index
    expect(new Uint8Array(first.subarray(10, 42))).toEqual(new Uint8Array(createHash('sha256').update(expected).digest()));
    expect(first.readUInt16LE(42)).toBe(expected.length);
    const chunks = [first.subarray(48)];
    for (const t of txs.slice(1, -1)) chunks.push(Buffer.from(t.instructions[0]!.data, 'hex').subarray(12));
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected);
    expect(txs[0]!.instructions[0]!.keys.map((k) => k[0])).toEqual([MULTISIG, buffer, MEMBER, MEMBER, SYSTEM]);
    for (const t of txs.slice(1, -1)) expect(t.instructions[0]!.keys.map((k) => k[0])).toEqual([MULTISIG, buffer, MEMBER]);

    const fromBuffer = txs.at(-1)!.instructions[0]!;
    const transaction = await transactionPda(MULTISIG, 390n);
    expect(fromBuffer.keys.map((k) => k[0])).toEqual([MULTISIG, transaction, MEMBER, MEMBER, SYSTEM, buffer, MEMBER]);
    expect(fromBuffer.data.slice(16)).toBe('0000' + '06000000' + '000000000000' + '00');
  });

  it('replaces extra unsigned signers with ephemeral signers', async () => {
    const vault = await vaultPda(MULTISIG, 0);
    const inner = innerWire(vault, [createAccount(vault, NEW_ACCOUNT)]);
    const [wire, ...rest] = await buildProposeTransactions(mainnetReader(), { multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: inner, transactionIndex: 390n, blockhash: BLOCKHASH });
    expect(rest).toEqual([]);
    const create = decode(wire!).instructions[0]!;
    const args = createArgs(create.data);
    expect(args).toMatchObject({ vaultIndex: 0, ephemeralSigners: 1 });
    const ephemeral = await ephemeralSignerPda(await transactionPda(MULTISIG, 390n), 0);
    const expected = vaultMessageFromWire(inner);
    expected.accountKeys = expected.accountKeys.map((k) => (k === NEW_ACCOUNT ? ephemeral : k));
    expect(args.message).toEqual(encodeTransactionMessage(expected));
    expect(args.message.length).toBeGreaterThan(0);
  });

  it('refuses an extra signer the dApp already signed for', async () => {
    const vault = await vaultPda(MULTISIG, 0);
    const inner = innerWire(vault, [createAccount(vault, NEW_ACCOUNT)]);
    const signed = new Uint8Array(inner);
    signed.fill(9, 1 + 64, 1 + 128); // second signature slot
    await expect(
      buildProposeTransactions(mainnetReader(), { multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: signed, transactionIndex: 390n, blockhash: BLOCKHASH }),
    ).rejects.toThrow(NEW_ACCOUNT);
  });

  it('still requires the vault to sign', async () => {
    const vault3 = await vaultPda(MULTISIG, 3);
    await expect(buildProposeTransactions(mainnetReader(), { multisig: MULTISIG, vaultIndex: 3, member: MEMBER, innerWire: b64(sdk.innerWire), transactionIndex: 390n, blockhash: BLOCKHASH })).rejects.toThrow(vault3);
  });

  describe('a buffer left by an interrupted attempt', async () => {
    const vault = await vaultPda(MULTISIG, 0);
    const recipients = await Promise.all(Array.from({ length: 4 }, (_, i) => vaultPda(MULTISIG, i + 10)));
    const inner = innerWire(vault, Array.from({ length: 60 }, (_, i) => transfer(vault, recipients[i % 4]!, BigInt(i + 1))));
    const p = { multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: inner, transactionIndex: 390n, blockhash: BLOCKHASH };
    const bytes = encodeTransactionMessage(vaultMessageFromWire(inner));
    const hash = new Uint8Array(createHash('sha256').update(bytes).digest());
    const pda = await transactionBufferPda(MULTISIG, MEMBER, 390 % 256);
    const fresh = await buildProposeTransactions(mainnetReader(), p);

    function withBuffer(content: Uint8Array, h = hash, size = bytes.length) {
      const data = new Uint8Array([
        ...Buffer.from('5a2423db5de16e60', 'hex'),
        ...getAddressEncoder().encode(MULTISIG),
        ...getAddressEncoder().encode(MEMBER),
        390 % 256,
        0,
        ...h,
        size & 0xff,
        size >> 8,
        ...new Uint8Array(new Uint32Array([content.length]).buffer),
        ...content,
      ]);
      const reader = mainnetReader();
      reader.setAccount({ address: pda, owner: SQUADS_PROGRAM_ID, lamports: 1n, data });
      return reader;
    }
    const discs = (wires: Uint8Array[]) => wires.map((w) => decode(w).instructions.map((ix) => ix.data.slice(0, 16)).join(','));

    it('resumes: extends only the missing bytes, then creates from the buffer', async () => {
      const uploaded = Buffer.from(decode(fresh[0]!).instructions[0]!.data, 'hex').subarray(48);
      const wires = await buildProposeTransactions(withBuffer(new Uint8Array(uploaded)), p);
      expect(discs(wires)).toEqual(discs(fresh.slice(1)));
      const chunks = wires.slice(0, -1).map((w) => Buffer.from(decode(w).instructions[0]!.data, 'hex').subarray(12));
      expect(new Uint8Array(Buffer.concat([uploaded, ...chunks]))).toEqual(bytes);
    });

    it('outerInstructionNames reads what each outer transaction does', async () => {
      const names = (wires: Uint8Array[]) => wires.map(outerInstructionNames);
      const extendCount = fresh.length - 2;
      expect(names(fresh)).toEqual([
        ['transaction_buffer_create'],
        ...Array.from({ length: extendCount }, () => ['transaction_buffer_extend']),
        ['vault_transaction_create_from_buffer', 'proposal_create', 'proposal_approve'],
      ]);
      expect(names(await buildProposeTransactions(withBuffer(bytes), p))).toEqual([['vault_transaction_create_from_buffer', 'proposal_create', 'proposal_approve']]);
      expect(names(await buildProposeTransactions(withBuffer(new Uint8Array(10), new Uint8Array(32).fill(1)), p))[0]).toEqual(['transaction_buffer_close']);
      expect(outerInstructionNames(await buildProposeTransaction({ ...p, innerWire: b64(sdk.innerWire) }))).toEqual(['vault_transaction_create', 'proposal_create', 'proposal_approve']);
    });

    it('a complete buffer goes straight to create-from-buffer', async () => {
      const wires = await buildProposeTransactions(withBuffer(bytes), p);
      expect(discs(wires)).toEqual(['de36954457f630e7,dc3c49e01e6c4f9f,9025a488bcd82af8']);
    });

    it('closes a buffer holding another message, then starts over', async () => {
      const other = new Uint8Array(bytes.length).fill(1);
      const wires = await buildProposeTransactions(withBuffer(other.subarray(0, 500), new Uint8Array(32).fill(1)), p);
      expect(discs(wires)).toEqual(['11b6d0e48818b266', ...discs(fresh)]);
      expect(decode(wires[0]!).instructions[0]!.keys.map((k) => k[0])).toEqual([MULTISIG, pda, MEMBER]);
      const tampered = new Uint8Array(bytes.subarray(0, 500));
      tampered[0]! ^= 1;
      expect(discs(await buildProposeTransactions(withBuffer(tampered), p))[0]).toBe('11b6d0e48818b266');
    });
  });
});
