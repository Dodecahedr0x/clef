import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, identifyInstruction, type Issue } from '../src';
import { buildWire, ME, OTHER } from './helpers';

describe('identifyInstruction', () => {
  it('names the instruction, its args and accounts from the IDL', async () => {
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 5n })]);
    const tx = await decodeTransaction(wire, new MemoryChainReader());
    const issues: Issue[] = [];
    const out = await identifyInstruction(tx.instructions[0]!, new IdlResolver([createBundledSource()]), issues);
    expect(out).toMatchObject({
      name: 'transferSol',
      programName: 'system',
      args: { amount: 5n },
      idl: { source: 'bundled', trust: 'curated' },
    });
    expect(out.accounts.map((a) => a.name)).toEqual(['source', 'destination']);
    expect(issues).toEqual([]);
  });

  it('falls back to a raw instruction when no IDL decodes it', async () => {
    const unknown = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    const ix = { index: 0, programId: unknown, accounts: [], data: new Uint8Array([1, 2, 3]) };
    const out = await identifyInstruction(ix, new IdlResolver([new UserIdlSource()]), []);
    expect(out.name).toBeUndefined();
    expect(out.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});
