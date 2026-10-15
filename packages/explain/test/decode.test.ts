import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { AccountRole, address, createNoopSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction } from '../src';
import { BLOCKHASH, buildWire, LOOKUP_TABLE_PROGRAM, ME, OTHER, rewire, setLookupTable, USDC } from './helpers';

const SYSTEM = address('11111111111111111111111111111111');
const TABLE = address('2immgwYNHBbyVQKVGCEkgWpi53bLwWNRMB5G2nbgYV17');
const TABLE2 = address('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
const THIRD = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

const transfer = () =>
  getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1_500_000_000n });
const altWire = () => buildWire([transfer()], { lookupTables: { [TABLE]: [OTHER] } });

describe('decodeTransaction', () => {
  it('decodes accounts with signer/writable flags', async () => {
    const tx = await decodeTransaction(buildWire([transfer()]), new MemoryChainReader());
    expect(tx).toMatchObject({ version: 0, feePayer: ME, recentBlockhash: BLOCKHASH });
    expect(tx.instructions).toHaveLength(1);
    const [ix] = tx.instructions;
    expect(ix!.programId).toBe(SYSTEM);
    expect(ix!.accounts).toEqual([
      { address: ME, signer: true, writable: true },
      { address: OTHER, signer: false, writable: true },
    ]);
    expect(tx.accounts.find((a) => a.address === SYSTEM)).toEqual({ address: SYSTEM, signer: false, writable: false });
  });

  it('decodes readonly signers and readonly non-signers', async () => {
    const ix = {
      programAddress: SYSTEM,
      accounts: [
        { address: OTHER, role: AccountRole.READONLY_SIGNER },
        { address: USDC, role: AccountRole.READONLY },
      ],
      data: new Uint8Array(),
    };
    const tx = await decodeTransaction(buildWire([ix]), new MemoryChainReader());
    expect(tx.instructions[0]!.accounts).toEqual([
      { address: OTHER, signer: true, writable: false },
      { address: USDC, signer: false, writable: false },
    ]);
  });

  it('resolves address lookup tables through the reader', async () => {
    const reader = new MemoryChainReader();
    setLookupTable(reader, TABLE, [OTHER]);
    const tx = await decodeTransaction(altWire(), reader);
    expect(tx.instructions[0]!.accounts[1]).toEqual({ address: OTHER, signer: false, writable: true, lookupTable: TABLE });
  });

  it('orders loaded accounts as all writable (table order), then all readonly', async () => {
    const t1 = [address('So11111111111111111111111111111111111111112'), USDC];
    const t2 = [THIRD, address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')];
    const ix = {
      programAddress: address('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'),
      accounts: [
        { address: t1[0]!, role: AccountRole.READONLY },
        { address: t2[0]!, role: AccountRole.WRITABLE },
        { address: t1[1]!, role: AccountRole.WRITABLE },
        { address: t2[1]!, role: AccountRole.READONLY },
      ],
      data: new Uint8Array(),
    };
    const reader = new MemoryChainReader();
    setLookupTable(reader, TABLE, t1);
    setLookupTable(reader, TABLE2, t2);
    const tx = await decodeTransaction(buildWire([ix], { lookupTables: { [TABLE]: t1, [TABLE2]: t2 } }), reader);
    expect(tx.accounts.slice(-4)).toEqual([
      { address: t1[1], signer: false, writable: true, lookupTable: TABLE },
      { address: t2[0], signer: false, writable: true, lookupTable: TABLE2 },
      { address: t1[0], signer: false, writable: false, lookupTable: TABLE },
      { address: t2[1], signer: false, writable: false, lookupTable: TABLE2 },
    ]);
    expect(tx.instructions[0]!.accounts.map((a) => [a.address, a.writable])).toEqual([
      [t1[0], false],
      [t2[0], true],
      [t1[1], true],
      [t2[1], false],
    ]);
  });

  it('prefers loaded addresses from tx meta over fetching tables', async () => {
    const reader = new MemoryChainReader();
    setLookupTable(reader, TABLE, [OTHER]);
    const tx = await decodeTransaction(altWire(), reader, { writable: [THIRD], readonly: [] });
    expect(tx.instructions[0]!.accounts[1]).toEqual({ address: THIRD, signer: false, writable: true, lookupTable: TABLE });
  });

  it('rejects loaded addresses whose counts do not match the lookups', async () => {
    const reader = new MemoryChainReader();
    const mismatch = 'lookup table address count mismatch';
    await expect(decodeTransaction(altWire(), reader, { writable: [OTHER, THIRD], readonly: [] })).rejects.toThrow(mismatch);
    await expect(decodeTransaction(altWire(), reader, { writable: [], readonly: [] })).rejects.toThrow(mismatch);
    await expect(decodeTransaction(altWire(), reader, { writable: [], readonly: [OTHER] })).rejects.toThrow(mismatch);
  });

  describe('lookup table validation', () => {
    const setTable = (reader: MemoryChainReader, data: Uint8Array, owner: Address = LOOKUP_TABLE_PROGRAM) =>
      reader.setAccount({ address: TABLE, owner, data });

    it('rejects a missing table', async () => {
      await expect(decodeTransaction(altWire(), new MemoryChainReader())).rejects.toThrow(/not found/);
    });

    it('rejects a table owned by another program', async () => {
      const reader = new MemoryChainReader();
      setLookupTable(reader, TABLE, [OTHER]);
      setTable(reader, reader.accounts.get(TABLE)!.data, OTHER);
      await expect(decodeTransaction(altWire(), reader)).rejects.toThrow(/not owned by the address lookup table program/);
    });

    it('rejects short or misaligned table data', async () => {
      const reader = new MemoryChainReader();
      setTable(reader, new Uint8Array(10));
      await expect(decodeTransaction(altWire(), reader)).rejects.toThrow(/invalid size/);
      const misaligned = new Uint8Array(56 + 33);
      misaligned[0] = 1;
      setTable(reader, misaligned);
      await expect(decodeTransaction(altWire(), reader)).rejects.toThrow(/invalid size/);
    });

    it('rejects a table without the lookup table discriminator', async () => {
      const reader = new MemoryChainReader();
      setLookupTable(reader, TABLE, [OTHER]);
      const data = reader.accounts.get(TABLE)!.data;
      data[0] = 0;
      setTable(reader, data);
      await expect(decodeTransaction(altWire(), reader)).rejects.toThrow(/not an initialized address lookup table/);
    });

    it('rejects an index past the end of the table', async () => {
      const reader = new MemoryChainReader();
      setLookupTable(reader, TABLE, []);
      await expect(decodeTransaction(altWire(), reader)).rejects.toThrow(/index 0 out of range/);
    });
  });

  describe('malformed messages', () => {
    const decode = (wire: Uint8Array) => decodeTransaction(wire, new MemoryChainReader());
    const base = () => buildWire([transfer()]);

    it('rejects a message without static accounts', async () => {
      await expect(decode(rewire(base(), (m) => ({ ...m, staticAccounts: [], instructions: [] })))).rejects.toThrow(
        'malformed transaction: no static accounts',
      );
    });

    it('rejects a message without signers', async () => {
      const wire = rewire(base(), (m) => ({ ...m, header: { ...m.header, numSignerAccounts: 0 } }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: no signers');
    });

    it('rejects a message whose signers are all readonly', async () => {
      const wire = rewire(base(), (m) => ({ ...m, header: { ...m.header, numReadonlySignerAccounts: 1 } }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: fee payer is not writable');
    });

    it('rejects a header that claims more accounts than exist', async () => {
      const wire = rewire(base(), (m) => ({ ...m, header: { ...m.header, numReadonlyNonSignerAccounts: 3 } }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: header exceeds static accounts');
    });

    it('rejects duplicate static accounts', async () => {
      const wire = rewire(base(), (m) => ({ ...m, staticAccounts: [ME, ME, SYSTEM] }));
      await expect(decode(wire)).rejects.toThrow(`malformed transaction: duplicate account ${ME}`);
    });

    it('rejects a loaded address that duplicates a static account', async () => {
      await expect(decodeTransaction(altWire(), new MemoryChainReader(), { writable: [ME], readonly: [] })).rejects.toThrow(
        `malformed transaction: duplicate account ${ME}`,
      );
    });

    it('rejects the fee payer as a program', async () => {
      const wire = rewire(base(), (m) => ({
        ...m,
        instructions: m.instructions.map((ix) => ({ ...ix, programAddressIndex: 0 })),
      }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: invalid program index 0');
    });

    it('rejects a program loaded from a lookup table', async () => {
      const wire = rewire(altWire(), (m) => ({
        ...m,
        instructions: m.instructions.map((ix) => ({ ...ix, programAddressIndex: m.staticAccounts.length })),
      }));
      await expect(decodeTransaction(wire, new MemoryChainReader(), { writable: [OTHER], readonly: [] })).rejects.toThrow(
        'malformed transaction: invalid program index 2',
      );
    });

    it('rejects an account index out of range', async () => {
      const wire = rewire(base(), (m) => ({
        ...m,
        instructions: m.instructions.map((ix) => ({ ...ix, accountIndices: [0, 50] })),
      }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: account index 50 out of range');
    });
  });
});
