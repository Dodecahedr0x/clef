import { defaultExplainContext, explain } from '@clef/explain';
import { describe, expect, it } from 'vitest';
import { AccountRole, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage, getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Address, type Blockhash, type Instruction } from '@solana/kit';
import { buildProposeTransaction, buildProposeTransactions, buildVoteTransaction, vaultPda } from '../src';
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

  it('buffered propose: transactionBufferCreate, transactionBufferExtend, vaultTransactionCreateFromBuffer', async () => {
    const vault = await vaultPda(MULTISIG, 0);
    const to = await vaultPda(MULTISIG, 1);
    const transfer: Instruction = {
      programAddress: '11111111111111111111111111111111' as Address,
      accounts: [{ address: vault, role: AccountRole.WRITABLE_SIGNER }, { address: to, role: AccountRole.WRITABLE }],
      data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
    };
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(vault, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions(Array.from({ length: 60 }, () => transfer), m),
    );
    const innerWire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    const wires = await buildProposeTransactions({ multisig: MULTISIG, vaultIndex: 0, member: MEMBER, innerWire, transactionIndex: 390n, blockhash: BLOCKHASH });
    const names = [];
    for (const wire of wires) names.push(...(await explain({ wire }, defaultExplainContext(mainnetReader(), [MEMBER]))).instructions.map((ix) => ix.name));
    expect(names[0]).toBe('transactionBufferCreate');
    expect(names.slice(1, -3).every((n) => n === 'transactionBufferExtend')).toBe(true);
    expect(names.slice(-3)).toEqual(['vaultTransactionCreateFromBuffer', 'proposalCreate', 'proposalApprove']);
  });
});
