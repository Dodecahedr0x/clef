import { getCompiledTransactionMessageDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { fetchMultisig, listProposals, vaultPda } from '../src';
import { hex, mainnet, mainnetReader, MULTISIG } from './helpers';

const exp = mainnet.expected;

describe('fetchMultisig', () => {
  it('decodes a recorded mainnet multisig', async () => {
    const info = await fetchMultisig(mainnetReader(), MULTISIG);
    expect(info).toEqual({
      address: MULTISIG,
      threshold: exp.multisig.threshold,
      timeLock: exp.multisig.timeLock,
      transactionIndex: BigInt(exp.multisig.transactionIndex),
      staleTransactionIndex: BigInt(exp.multisig.staleTransactionIndex),
      members: exp.multisig.members.map((m) => ({ key: m.key, initiate: (m.mask & 1) !== 0, vote: (m.mask & 2) !== 0, execute: (m.mask & 4) !== 0 })),
    });
  });

  it('returns null for a missing account', async () => {
    expect(await fetchMultisig(mainnetReader(), await vaultPda(MULTISIG, 0))).toBeNull();
  });

  it('returns null for an account not owned by Squads', async () => {
    const reader = mainnetReader();
    reader.setAccount({ ...reader.accounts.get(MULTISIG)!, owner: '11111111111111111111111111111111' as never });
    expect(await fetchMultisig(reader, MULTISIG)).toBeNull();
  });
});

describe('listProposals', () => {
  it('lists newest first with statuses, votes and the inner message', async () => {
    const proposals = await listProposals(mainnetReader(), MULTISIG, { limit: 4 });
    expect(proposals.map((p) => p.index)).toEqual([389n, 388n, 387n, 386n]);
    for (const p of proposals) {
      const e = exp.proposals[String(p.index)]!;
      expect(p.status).toBe(e.status.toLowerCase());
      expect(p.approved).toEqual(e.approved);
      expect(p.rejected).toEqual(e.rejected);
      expect(p.cancelled).toEqual(e.cancelled);

      const t = exp.transactions[String(p.index)]!;
      const msg = getCompiledTransactionMessageDecoder().decode(p.innerMessage!);
      expect(msg.version).toBe(0);
      if (msg.version !== 0) throw new Error('expected v0');
      expect(msg.staticAccounts).toEqual(t.accountKeys);
      expect(msg.header).toEqual({
        numSignerAccounts: t.numSigners,
        numReadonlySignerAccounts: t.numSigners - t.numWritableSigners,
        numReadonlyNonSignerAccounts: t.accountKeys.length - t.numSigners - t.numWritableNonSigners,
      });
      expect(msg.instructions.map((ix) => ({ programIdIndex: ix.programAddressIndex, accountIndexes: ix.accountIndices ?? [], data: hex(new Uint8Array(ix.data ?? [])) }))).toEqual(t.instructions);
      expect('addressTableLookups' in msg ? (msg.addressTableLookups ?? []).length : 0).toBe(t.lookups);
    }
  });

  it('respects the limit and stops at the stale index', async () => {
    expect((await listProposals(mainnetReader(), MULTISIG, { limit: 2 })).map((p) => p.index)).toEqual([389n, 388n]);
  });

  it('returns nothing for an unknown multisig', async () => {
    expect(await listProposals(mainnetReader(), await vaultPda(MULTISIG, 0), { limit: 5 })).toEqual([]);
  });
});
