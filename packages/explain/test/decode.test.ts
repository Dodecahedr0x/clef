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
