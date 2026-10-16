import { BUNDLED_PROGRAM_IDS, createBundledSource } from '@clef/idl';
import { describe, expect, it } from 'vitest';
import { SQUADS_PROGRAM_ID } from '../src';

describe('bundled Squads v4 IDL', () => {
  it('resolves the Squads program as curated', async () => {
    expect(BUNDLED_PROGRAM_IDS.has(SQUADS_PROGRAM_ID)).toBe(true);
    const idl = await createBundledSource().load(SQUADS_PROGRAM_ID);
    expect(idl).toMatchObject({ programId: SQUADS_PROGRAM_ID, source: 'bundled', trust: 'curated' });
    const names = (idl!.root.program.instructions ?? []).map((ix) => ix.name);
    expect(names).toEqual(expect.arrayContaining(['vaultTransactionCreate', 'proposalCreate', 'proposalApprove', 'proposalReject', 'vaultTransactionExecute']));
    expect((idl!.root.program.accounts ?? []).map((a) => a.name)).toEqual(expect.arrayContaining(['multisig', 'proposal', 'vaultTransaction']));
  });
});
