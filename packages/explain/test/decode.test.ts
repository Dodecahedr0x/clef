import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { AccountRole, address, createNoopSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, flattenV1 } from '../src';
import { BLOCKHASH, buildV1Wire, buildWire, LOOKUP_TABLE_PROGRAM, ME, OTHER, rewire, rewireV1, setLookupTable, USDC, type V1Message } from './helpers';

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

  describe('v1 transactions', () => {
    const decode = (wire: Uint8Array) => decodeTransaction(wire, new MemoryChainReader());
    const memo = {
      programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      accounts: [{ address: THIRD, role: AccountRole.READONLY_SIGNER }, { address: USDC, role: AccountRole.WRITABLE }],
      data: new Uint8Array([104, 105]),
    };
    const v1 = () => buildV1Wire([transfer(), memo]);
    const v1Message = (wire: Uint8Array) => {
      let out: V1Message | undefined;
      rewireV1(wire, (m) => (out = m));
      return out!;
    };

    it('round-trips a v1 wire built with kit: accounts, flags, instructions', async () => {
      const wire = v1();
      expect(wire[0]).toBe(0x81);
      const tx = await decode(wire);
      expect(tx).toMatchObject({ version: 1, feePayer: ME, recentBlockhash: BLOCKHASH, config: {} });
      expect(tx.instructions.map((ix) => ix.programId)).toEqual([SYSTEM, memo.programAddress]);
      expect(tx.instructions[0]!.accounts).toEqual([
        { address: ME, signer: true, writable: true },
        { address: OTHER, signer: false, writable: true },
      ]);
      expect(tx.instructions[1]!.accounts).toEqual([
        { address: THIRD, signer: true, writable: false },
        { address: USDC, signer: false, writable: true },
      ]);
      expect(tx.instructions[1]!.data).toEqual(new Uint8Array([104, 105]));
      expect(tx.accounts.every((a) => a.lookupTable === undefined)).toBe(true);
    });

    it('decodes every config field', async () => {
      const config = { priorityFeeLamports: 123_456n, computeUnitLimit: 300_000, loadedAccountsDataSizeLimit: 65_536, heapSize: 64 * 1024 };
      const tx = await decode(buildV1Wire([transfer()], { config }));
      expect(tx.config).toEqual(config);
      const some = await decode(buildV1Wire([transfer()], { config: { computeUnitLimit: 5 } }));
      expect(some.config).toEqual({ computeUnitLimit: 5 });
    });

    it('legacy and v0 transactions carry no config', async () => {
      expect((await decode(buildWire([transfer()]))).config).toBeUndefined();
    });

    it('applies the same sanitization rules', async () => {
      await expect(decode(rewireV1(v1(), (m) => ({ ...m, header: { ...m.header, numReadonlySignerAccounts: 2 } })))).rejects.toThrow(
        'malformed transaction: fee payer is not writable',
      );
      await expect(
        decode(rewireV1(v1(), (m) => ({ ...m, staticAccounts: m.staticAccounts.map((a, i) => (i === 1 ? ME : a)) }))),
      ).rejects.toThrow(`malformed transaction: duplicate account ${ME}`);
      await expect(
        decode(rewireV1(v1(), (m) => ({ ...m, instructionHeaders: m.instructionHeaders.map((h) => ({ ...h, programAccountIndex: 0 })) }))),
      ).rejects.toThrow('malformed transaction: invalid program index 0');
      await expect(
        decode(
          rewireV1(v1(), (m) => ({
            ...m,
            instructionPayloads: m.instructionPayloads.map((p) => ({ ...p, instructionAccountIndices: p.instructionAccountIndices.map(() => 40) })),
          })),
        ),
      ).rejects.toThrow('malformed transaction: account index 40 out of range');
    });

    it('rejects unknown config bits', async () => {
      const wire = rewireV1(buildV1Wire([transfer()]), (m) => ({ ...m, configMask: 0b100000 }));
      await expect(decode(wire)).rejects.toThrow('malformed transaction: unknown config bits 0x20');
    });

    it('rejects a priority fee with only one of its two bits', async () => {
      const wire = rewireV1(buildV1Wire([transfer()]), (m) => ({ ...m, configMask: 0b01 }));
      await expect(decode(wire)).rejects.toThrow();
      expect(() => flattenV1({ ...v1Message(buildV1Wire([transfer()])), configMask: 0b10, configValues: [{ kind: 'u32', value: 1 }] })).toThrow(
        'malformed transaction: priority fee needs both config bits',
      );
    });

    it('rejects a heap size the runtime refuses', async () => {
      for (const heapSize of [16 * 1024, 300 * 1024, 33_000]) {
        const wire = rewireV1(buildV1Wire([transfer()]), (m) => ({ ...m, configMask: 0b10000, configValues: [{ kind: 'u32', value: heapSize }] }));
        await expect(decode(wire)).rejects.toThrow(`malformed transaction: invalid heap size ${heapSize}`);
      }
    });

    it('rejects trailing bytes between the message and the signatures', async () => {
      await expect(decode(rewireV1(v1(), (m) => m, [0]))).rejects.toThrow('malformed transaction: trailing bytes after the message');
    });

    describe('declared counts (hand-made messages)', () => {
      const msg = () => v1Message(buildV1Wire([transfer(), memo], { config: { computeUnitLimit: 7 } }));

      it('accepts a consistent message', () => {
        expect(flattenV1(msg()).config).toEqual({ computeUnitLimit: 7 });
      });

      it('rejects a static account count that does not match', () => {
        expect(() => flattenV1({ ...msg(), numStaticAccounts: 9 })).toThrow('malformed transaction: static account count mismatch');
      });

      it('rejects an instruction count that does not match', () => {
        expect(() => flattenV1({ ...msg(), numInstructions: 3 })).toThrow('malformed transaction: instruction count mismatch');
        const m = msg();
        expect(() => flattenV1({ ...m, instructionPayloads: m.instructionPayloads.slice(1) })).toThrow('malformed transaction: instruction count mismatch');
      });

      it('rejects payloads whose lengths do not match their headers', () => {
        const m = msg();
        const headers = (patch: object) => m.instructionHeaders.map((h, i) => (i === 1 ? { ...h, ...patch } : h));
        expect(() => flattenV1({ ...m, instructionHeaders: headers({ numInstructionAccounts: 1 }) })).toThrow(
          'malformed transaction: instruction 1: account count mismatch',
        );
        expect(() => flattenV1({ ...m, instructionHeaders: headers({ numInstructionDataBytes: 9 }) })).toThrow(
          'malformed transaction: instruction 1: data length mismatch',
        );
      });

      it('rejects config values that do not match the mask', () => {
        const m = msg();
        expect(() => flattenV1({ ...m, configValues: [] })).toThrow('malformed transaction: config value count does not match the config mask');
        expect(() => flattenV1({ ...m, configValues: [{ kind: 'u32', value: 1 }, { kind: 'u32', value: 2 }] })).toThrow(
          'malformed transaction: config value count does not match the config mask',
        );
        // Right word count, wrong kinds: a u64 where the limit's u32 belongs.
        expect(() => flattenV1({ ...m, configMask: 0b1100, configValues: [{ kind: 'u64', value: 1n }] })).toThrow(
          'malformed transaction: config computeUnitLimit is not a u32',
        );
        // The priority fee is one u64 over two bits.
        expect(() => flattenV1({ ...m, configMask: 0b11, configValues: [{ kind: 'u32', value: 1 }, { kind: 'u32', value: 2 }] })).toThrow(
          'malformed transaction: config priorityFeeLamports is not a u64',
        );
      });
    });
  });
});
