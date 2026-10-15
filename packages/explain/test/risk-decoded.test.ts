import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getAssignInstruction } from '@solana-program/system';
import { AuthorityType, getApproveInstruction, getSetAuthorityInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, evaluateRisks, identifyInstruction, STAKE_PROGRAM, U64_MAX, type Issue } from '../src';
import { buildWire, ME, OTHER, USDC } from './helpers';

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

  describe('stake', () => {
    const STAKE_ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const VOTE = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
    const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
    const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
    const u64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
    const key = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));
    const seed = (s: string) => new Uint8Array([...u64(s.length), ...new TextEncoder().encode(s)]);
    const W = AccountRole.WRITABLE;
    const R = AccountRole.READONLY;
    const S = AccountRole.READONLY_SIGNER;
    const stakeIx = (parts: Uint8Array[], accounts: [Address, AccountRole][]): Instruction => ({
      programAddress: address(STAKE_PROGRAM),
      accounts: accounts.map(([a, role]) => ({ address: a, role })),
      data: new Uint8Array(parts.flatMap((p) => [...p])),
    });

    it('decodes delegateStake (both account layouts) without warnings', async () => {
      const modern = stakeIx([u32(2)], [[STAKE_ACC, W], [VOTE, R], [ME, S]]);
      const legacy = stakeIx([u32(2)], [[STAKE_ACC, W], [VOTE, R], [CLOCK, R], [OTHER, R], [USDC, R], [ME, S]]);
      for (const ix of [modern, legacy]) {
        const r = await risks([ix]);
        expect(r.names).toEqual(['delegateStake']);
        expect(r.rules).toEqual([]);
      }
    });

    it('flags authorize / authorizeWithSeed to a new authority that is not yours', async () => {
      const authorize = (to: Address, clock: boolean) =>
        stakeIx([u32(1), key(to), u32(1)], [[STAKE_ACC, W], ...(clock ? [[CLOCK, R] as [Address, AccountRole]] : []), [ME, S]]);
      expect((await risks([authorize(OTHER, false)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([authorize(OTHER, true)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([authorize(ME, true)])).rules).toEqual([]);
      const withSeed = (to: Address) => stakeIx([u32(8), key(to), u32(0), seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S]]);
      expect((await risks([withSeed(OTHER)])).names).toEqual(['authorizeWithSeed']);
      expect((await risks([withSeed(OTHER)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([withSeed(ME)])).rules).toEqual([]);
    });

    it('reads the new authority of Checked variants by position, in both layouts', async () => {
      // The IDL names the modern layout only: in the legacy layout its "newAuthority" is the OLD authority.
      const checked = (old: Address, to: Address, clock: boolean) =>
        stakeIx([u32(10), u32(1)], [[STAKE_ACC, W], ...(clock ? [[CLOCK, R] as [Address, AccountRole]] : []), [old, S], [to, S]]);
      expect((await risks([checked(ME, OTHER, false)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([checked(ME, OTHER, true)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([checked(OTHER, ME, true)])).rules).toEqual([]);
      expect((await risks([checked(OTHER, ME, false)])).rules).toEqual([]);
      const withSeed = (to: Address, clock: boolean) =>
        stakeIx([u32(11), u32(1), seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S], ...(clock ? [[CLOCK, R] as [Address, AccountRole]] : []), [to, S]]);
      expect((await risks([withSeed(OTHER, false)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([withSeed(OTHER, true)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([withSeed(ME, true)])).rules).toEqual([]);
    });

    it('warns on lockup changes', async () => {
      const setLockup = stakeIx([u32(6), new Uint8Array([0, 0, 1]), key(OTHER)], [[STAKE_ACC, W], [ME, S]]);
      const setLockupChecked = stakeIx([u32(12), new Uint8Array([0, 0])], [[STAKE_ACC, W], [ME, S], [OTHER, S]]);
      expect((await risks([setLockup])).rules).toEqual([['stake-lockup', 'warn']]);
      expect((await risks([setLockupChecked])).rules).toEqual([['stake-lockup', 'warn']]);
    });
  });
});
