import type { RawAccount } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { depositsOf, evaluateRisks, rentExempt, sendRecipient, SYSTEM_PROGRAM, TOKEN_PROGRAM, type BalanceChange, type RiskInput } from '../src';
import { ME, OTHER, USDC } from './helpers';

const POOL = address('F9yYvd5TfZ5nmzBVGPM1M2AEWnFBLVKYYEP8kmHWTKDf');
const sol = (owner: Address, delta: bigint): BalanceChange => ({ owner, mint: 'SOL', decimals: 9, delta });
const usdc = (owner: Address, delta: bigint): BalanceChange => ({ owner, mint: USDC, symbol: 'USDC', decimals: 6, delta });
const me = new Set<string>([ME]);

describe('sendRecipient', () => {
  it('is the one wallet a plain send pays', () => {
    expect(sendRecipient([sol(ME, -1_000_005_000n), sol(OTHER, 1_000_000_000n)], me)).toBe(OTHER);
    expect(sendRecipient([usdc(ME, -5_000_000n), sol(ME, -5_000n), usdc(OTHER, 5_000_000n)], me)).toBe(OTHER);
  });

  it('is none for a trade: the other side pays something back', () => {
    // A route account gains the token and pays out wrapped SOL; the user's SOL refund sits below rent slack.
    expect(sendRecipient([usdc(ME, -5_000_000n), sol(ME, 184_800n), usdc(POOL, 5_000_000n), sol(POOL, -194_530n)], me)).toBeNull();
    expect(sendRecipient([usdc(ME, -5_000_000n), sol(ME, 2_000_000_000n), usdc(POOL, 5_000_000n)], me)).toBeNull();
  });

  it('is none when two parties gain, or nothing leaves the wallet', () => {
    expect(sendRecipient([sol(ME, -2_000_000_000n), sol(OTHER, 1_000_000_000n), sol(POOL, 1_000_000_000n)], me)).toBeNull();
    expect(sendRecipient([sol(OTHER, 1n)], me)).toBeNull();
    expect(sendRecipient(null, me)).toBeNull();
  });
});

describe('lookalike recipients', () => {
  // Same first and last four characters as the user's own address, different middle: address poisoning.
  const twin = `${ME.slice(0, 4)}${'1'.repeat(ME.length - 8)}${ME.slice(-4)}` as Address;
  const input = (to: Address, over: Partial<RiskInput> = {}): RiskInput => ({
    instructions: [], relations: [], issues: [], me: [ME], balanceChanges: [sol(ME, -1_000_005_000n), sol(to, 1_000_000_000n)], ...over,
  });
  const rules = (i: RiskInput) => evaluateRisks(i).map((w) => [w.rule, w.severity]);

  it('is danger when the recipient mimics one of the user\'s accounts or a saved address', () => {
    expect(rules(input(twin))).toContainEqual(['lookalike-recipient', 'danger']);
    const saved = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const fake = `${saved.slice(0, 4)}${'2'.repeat(saved.length - 8)}${saved.slice(-4)}` as Address;
    const w = evaluateRisks(input(fake, { addressBook: new Set([saved]), labels: { [saved]: 'Alice' } }));
    expect(w.find((x) => x.rule === 'lookalike-recipient')?.message).toMatch(/looks like Alice/);
  });

  it('is silent for the saved address itself and for an unrelated new one', () => {
    expect(rules(input(OTHER, { addressBook: new Set([OTHER]) }))).not.toContainEqual(['lookalike-recipient', 'danger']);
    expect(rules(input(OTHER))).not.toContainEqual(['lookalike-recipient', 'danger']);
  });
});

describe('depositsOf', () => {
  const acct = (lamports: bigint, owner: string = TOKEN_PROGRAM, size = 165): RawAccount => ({
    address: OTHER, owner: owner as Address, lamports, data: new Uint8Array(size), executable: false,
  });

  it('counts accounts the transaction opens with data or a program owner, at their rent', () => {
    expect(depositsOf({ pre: [null, null], post: [acct(rentExempt(165)), acct(rentExempt(200), 'Stake11111111111111111111111111111111111111', 200)] }))
      .toEqual({ count: 2, lamports: rentExempt(165) + rentExempt(200) });
  });

  it('counts only the rent of a wrapped SOL account, not the SOL inside it', () => {
    expect(depositsOf({ pre: [null], post: [acct(rentExempt(165) + 1_500_000_000n)] })).toEqual({ count: 1, lamports: rentExempt(165) });
  });

  it('ignores a wallet funded for the first time and accounts that already existed', () => {
    expect(depositsOf({ pre: [null], post: [acct(1_000_000_000n, SYSTEM_PROGRAM, 0)] })).toBeNull();
    expect(depositsOf({ pre: [acct(rentExempt(165))], post: [acct(rentExempt(165))] })).toBeNull();
    expect(depositsOf(null)).toBeNull();
  });
});
