import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getAssignInstruction } from '@solana-program/system';
import { AuthorityType, getApproveInstruction, getSetAuthorityInstruction } from '@solana-program/token';
import { createNoopSigner, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, evaluateRisks, identifyInstruction, U64_MAX, type Issue } from '../src';
import { buildWire, ME, OTHER } from './helpers';

const SRC = OTHER;
const me = createNoopSigner(ME);

/** Real wire bytes -> decode -> identify with the bundled IDLs -> risk rules. */
async function risks(instructions: Instruction[]) {
  const tx = await decodeTransaction(buildWire(instructions), new MemoryChainReader());
  const idls = new IdlResolver([createBundledSource()]);
  const issues: Issue[] = [];
  const explained = await Promise.all(tx.instructions.map((ix) => identifyInstruction(ix, idls, issues)));
  return {
    names: explained.map((ix) => ix.name),
    args: explained.map((ix) => ix.args),
    rules: evaluateRisks({ instructions: explained, relations: [], balanceChanges: [], issues, me: [ME] }).map((w) => [w.rule, w.severity]),
  };
}

describe('risk rules on decoded instructions', () => {
  it('flags a real unlimited Token approve and a System assign of your wallet', async () => {
    const r = await risks([
      getApproveInstruction({ source: SRC, delegate: OTHER, owner: me, amount: U64_MAX }),
      getAssignInstruction({ account: me, programAddress: OTHER }),
    ]);
    expect(r.names).toEqual(['approve', 'assign']);
    expect(r.rules).toEqual([
      ['delegation', 'danger'],
      ['authority-change', 'danger'],
    ]);
  });

  it('reads setAuthority newAuthority as decoded from the wire', async () => {
    const set = (newAuthority: Address | null) =>
      getSetAuthorityInstruction({ owned: SRC, owner: me, authorityType: AuthorityType.CloseAccount, newAuthority });
    expect((await risks([set(OTHER)])).rules).toEqual([['authority-change', 'danger']]);
    expect((await risks([set(ME)])).rules).toEqual([['authority-change', 'warn']]);
    expect((await risks([set(null)])).rules).toEqual([['authority-change', 'warn']]);
  });
});
