import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getAssignInstruction } from '@solana-program/system';
import { AuthorityType, getApproveInstruction, getSetAuthorityInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeTransaction, evaluateRisks, identifyInstruction, shortAddress, STAKE_PROGRAM, U64_MAX, type Issue } from '../src';
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
      const withSeed = (to: Address) => stakeIx([u32(8), key(to), u32(1), seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S]]);
      expect((await risks([withSeed(OTHER)])).names).toEqual(['authorizeWithSeed']);
      expect((await risks([withSeed(OTHER)])).rules).toEqual([['authority-change', 'danger']]);
      expect((await risks([withSeed(ME)])).rules).toEqual([]);
    });

    it('treats handing over only the staker role as warn', async () => {
      const STAKER = u32(0);
      const authorize = stakeIx([u32(1), key(OTHER), STAKER], [[STAKE_ACC, W], [ME, S]]);
      const r = await risks([authorize]);
      expect(r.rules).toEqual([['stake-delegation-authority', 'warn']]);
      const tx = await decodeTransaction(buildWire([authorize]), new MemoryChainReader());
      const explained = await identifyInstruction(tx.instructions[0]!, new IdlResolver([createBundledSource()]), []);
      expect(evaluateRisks({ instructions: [explained], relations: [], balanceChanges: [], issues: [], me: [ME] })[0]!.message).toBe(
        `Hands staking control (not withdrawal) of a stake account to ${shortAddress(OTHER)}.`,
      );
      const withSeed = stakeIx([u32(8), key(OTHER), STAKER, seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S]]);
      expect((await risks([withSeed])).rules).toEqual([['stake-delegation-authority', 'warn']]);
      for (const clock of [false, true]) {
        const checked = stakeIx([u32(10), STAKER], [[STAKE_ACC, W], ...(clock ? [[CLOCK, R] as [Address, AccountRole]] : []), [ME, S], [OTHER, S]]);
        expect((await risks([checked])).rules).toEqual([['stake-delegation-authority', 'warn']]);
        const checkedSeed = stakeIx([u32(11), STAKER, seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S], ...(clock ? [[CLOCK, R] as [Address, AccountRole]] : []), [OTHER, S]]);
        expect((await risks([checkedSeed])).rules).toEqual([['stake-delegation-authority', 'warn']]);
      }
      // Defense in depth on the modern layout: an extra foreign authority account is only warn for the staker role.
      const extra = stakeIx([u32(10), STAKER], [[STAKE_ACC, W], [ME, S], [ME, S], [OTHER, S]]);
      expect((await risks([extra])).rules).toEqual([['stake-delegation-authority', 'warn']]);
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

    it('warns on lockup changes; danger when the new custodian is not yours', async () => {
      const setLockup = (custodian: Address | null) =>
        stakeIx([u32(6), new Uint8Array([0, 0]), ...(custodian ? [new Uint8Array([1]), key(custodian)] : [new Uint8Array([0])])], [[STAKE_ACC, W], [ME, S]]);
      expect((await risks([setLockup(OTHER)])).rules).toEqual([['stake-lockup', 'danger']]);
      expect((await risks([setLockup(ME)])).rules).toEqual([['stake-lockup', 'warn']]);
      expect((await risks([setLockup(null)])).rules).toEqual([['stake-lockup', 'warn']]);
      const checked = (custodian?: Address) =>
        stakeIx([u32(12), new Uint8Array([0, 0])], [[STAKE_ACC, W], [ME, S], ...(custodian ? [[custodian, S] as [Address, AccountRole]] : [])]);
      expect((await risks([checked(OTHER)])).rules).toEqual([['stake-lockup', 'danger']]);
      expect((await risks([checked(ME)])).rules).toEqual([['stake-lockup', 'warn']]);
      expect((await risks([checked()])).rules).toEqual([['stake-lockup', 'warn']]);
    });

    it('flags withdrawing stake to someone else, in both layouts', async () => {
      const withdraw = (to: Address, clock: boolean) =>
        stakeIx(
          [u32(4), u64(1_000_000_000)],
          [[STAKE_ACC, W], [to, W], ...(clock ? ([[CLOCK, R], [USDC, R]] as [Address, AccountRole][]) : []), [ME, S]],
        );
      expect((await risks([withdraw(OTHER, false)])).rules).toEqual([['stake-withdraw', 'danger']]);
      expect((await risks([withdraw(OTHER, true)])).rules).toEqual([['stake-withdraw', 'danger']]);
      expect((await risks([withdraw(ME, true)])).rules).toEqual([]);
    });

    it('flags creating a stake account someone else controls', async () => {
      const RENT = address('SysvarRent111111111111111111111111111111111');
      const lockup = [u64(0), u64(0), key(ME)];
      const init = (staker: Address, withdrawer: Address) =>
        stakeIx([u32(0), key(staker), key(withdrawer), ...lockup], [[STAKE_ACC, W], [RENT, R]]);
      expect((await risks([init(ME, OTHER)])).rules).toEqual([['stake-foreign-authority', 'danger']]);
      expect((await risks([init(OTHER, ME)])).rules).toEqual([['stake-foreign-authority', 'warn']]);
      expect((await risks([init(ME, ME)])).rules).toEqual([]);
      const checked = (staker: Address, withdrawer: Address, rent: boolean) =>
        stakeIx([u32(9)], [[STAKE_ACC, W], ...(rent ? [[RENT, R] as [Address, AccountRole]] : []), [staker, R], [withdrawer, S]]);
      for (const rent of [false, true]) {
        expect((await risks([checked(OTHER, ME, rent)])).rules).toEqual([['stake-foreign-authority', 'warn']]);
        expect((await risks([checked(ME, OTHER, rent)])).rules).toEqual([['stake-foreign-authority', 'danger']]);
        expect((await risks([checked(ME, ME, rent)])).rules).toEqual([]);
      }
    });

    it('requires every authority account of a modern-layout Checked authorize to be yours', async () => {
      const checked = stakeIx([u32(10), u32(1)], [[STAKE_ACC, W], [ME, S], [ME, S], [OTHER, S]]);
      expect((await risks([checked])).rules).toEqual([['authority-change', 'danger']]);
      const withSeed = stakeIx([u32(11), u32(1), seed('s'), key(OTHER)], [[STAKE_ACC, W], [ME, S], [ME, S], [OTHER, S]]);
      expect((await risks([withSeed])).rules).toEqual([['authority-change', 'danger']]);
    });
  });
});
