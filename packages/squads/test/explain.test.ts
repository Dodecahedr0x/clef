import { defaultExplainContext, explain } from '@clef/explain';
import { describe, expect, it } from 'vitest';
import { buildProposeTransaction, buildVoteTransaction } from '../src';
import { b64, mainnetReader, MEMBER, MULTISIG, sdk } from './helpers';

const BLOCKHASH = 'DAf6gxKCXQSwSPN2aXHBU2VkoaAHwm9dz5Fxg6cffhQt';

describe('explain names Squads instructions from the curated IDL', () => {
  it('propose: vaultTransactionCreate, proposalCreate, proposalApprove', async () => {
    const wire = await buildProposeTransaction({ multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire: b64(sdk.innerWire), transactionIndex: 390n, blockhash: BLOCKHASH });
    const ex = await explain({ wire }, defaultExplainContext(mainnetReader(), [MEMBER]));
    expect(ex.instructions.map((ix) => ix.name)).toEqual(['vaultTransactionCreate', 'proposalCreate', 'proposalApprove']);
    for (const ix of ex.instructions) expect(ix.idl).toMatchObject({ source: 'bundled', trust: 'curated' });
  });

  it('vote: proposalReject', async () => {
    const wire = await buildVoteTransaction({ multisig: MULTISIG, member: MEMBER, transactionIndex: 390n, vote: 'reject', blockhash: BLOCKHASH });
    const ex = await explain({ wire }, defaultExplainContext(mainnetReader(), [MEMBER]));
    expect(ex.instructions.map((ix) => ix.name)).toEqual(['proposalReject']);
  });
});
