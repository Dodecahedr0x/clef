import type { RawAccount } from '@clef/rpc';
import { address, getProgramDerivedAddress, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  balanceChangesFromSimulation,
  computeStateChanges,
  estimateFee,
  evaluateRisks,
  BPF_UPGRADEABLE_LOADER,
  RENT_SLACK,
  shortAddress,
  STAKE_PROGRAM,
  VOTE_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  U64_MAX,
  type ExplainedInstruction,
  type BalanceChange,
  type RiskInput,
  type StateChange,
} from '../src';
import { ME, OTHER, tokenAccountData, USDC } from './helpers';

/** Decoded with the curated IDL unless `over.idl` says otherwise (core rules only trust curated names). */
const ix = (over: Partial<ExplainedInstruction>): ExplainedInstruction => ({
  index: 0, programId: address(TOKEN_PROGRAM), accounts: [], data: new Uint8Array(),
  idl: { source: 'bundled', trust: 'curated', hash: 'h' }, ...over,
});
const input = (instructions: ExplainedInstruction[], over: Partial<RiskInput> = {}): RiskInput => ({
  instructions, relations: [], balanceChanges: [], issues: [], me: [ME], ...over,
});
const named = (name: string | undefined, address: Address, mine = false) => ({ name, address, signer: false, writable: true, mine });
const rules = (i: RiskInput) => evaluateRisks(i).map((w) => [w.rule, w.severity]);

describe('evaluateRisks', () => {
  it('flags unlimited token delegation as danger, limited as warn', () => {
    expect(rules(input([ix({ name: 'approve', args: { amount: U64_MAX } })]))).toEqual([['delegation', 'danger']]);
    // Without the source's balance, a limited approval may still cover all of it.
    expect(rules(input([ix({ name: 'approve', args: { amount: 5n } })]))).toEqual([['delegation', 'danger']]);
    const SRC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const limited = ix({ name: 'approve', args: { amount: 5n }, accounts: [named('source', SRC), named('delegate', OTHER)] });
    expect(rules(input([limited], { tokenBalances: { [SRC]: { owner: ME, mint: USDC, amount: 100n } } }))).toEqual([['delegation', 'warn']]);
  });

  it('ignores core instruction names that did not come from a curated IDL', () => {
    const userIdl = { source: 'user' as const, trust: 'user' as const, hash: 'h' };
    // A non-curated name for a core program counts as undecoded: never as a known-safe instruction.
    expect(rules(input([ix({ name: 'approve', args: { amount: U64_MAX }, idl: userIdl })]))).toEqual([['unknown-program', 'warn']]);
    expect(rules(input([ix({ name: 'approve', args: { amount: U64_MAX }, idl: undefined })]))).toEqual([['unknown-program', 'warn']]);
    const stake = ix({ programId: address(STAKE_PROGRAM), name: 'deactivate', idl: userIdl });
    expect(rules(input([stake]))).toEqual([['sensitive-program', 'danger']]);
  });

  it('treats near-unlimited or whole-balance delegation to someone else as danger', () => {
    const SRC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const approve = (amount: bigint, delegate: Address = OTHER) =>
      ix({ name: 'approve', args: { amount }, accounts: [named('source', SRC, true), named('delegate', delegate), named('owner', ME)] });
    const tokenBalances = { [SRC]: { owner: ME, mint: OTHER, amount: 100n } };
    expect(rules(input([approve(U64_MAX - 1n)]))).toEqual([['delegation', 'danger']]);
    expect(rules(input([approve(100n)], { tokenBalances }))).toEqual([['delegation', 'danger']]);
    expect(rules(input([approve(99n)], { tokenBalances }))).toEqual([['delegation', 'warn']]);
    expect(rules(input([approve(U64_MAX, ME)]))).toEqual([['delegation', 'warn']]);
    expect(evaluateRisks(input([approve(5n)]))[0]!.message).toContain('your token account');
    expect(evaluateRisks(input([approve(U64_MAX)]))[0]!.message).toBe('Lets a delegate spend an UNLIMITED amount of the tokens in your token account.');
    const notMine = ix({ name: 'approve', args: { amount: 5n }, accounts: [named('source', SRC), named('delegate', OTHER)] });
    expect(evaluateRisks(input([notMine]))[0]!.message).not.toContain('your');
  });

  it('flags authority changes and system reassignment of your accounts', () => {
    expect(rules(input([ix({ name: 'setAuthority' })]))).toEqual([['authority-change', 'danger']]);
    const assign = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named('account', ME, true)] });
    expect(rules(input([assign]))).toEqual([['authority-change', 'danger']]);
  });

  it('flags closing an account to someone else', () => {
    const close = ix({ name: 'closeAccount', accounts: [named('account', ME, true), named('destination', OTHER)] });
    expect(rules(input([close]))).toEqual([['close-to-third-party', 'danger']]);
    // Closing wrapped SOL hands over everything it holds: the message says how much.
    const WSOL_ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const closeWsol = ix({ name: 'closeAccount', accounts: [named('account', WSOL_ACC, true), named('destination', OTHER)] });
    const wsol = {
      tokenBalances: { [WSOL_ACC]: { owner: ME, mint: address('So11111111111111111111111111111111111111112'), amount: 50_000_000_000n } },
      accountLamports: { [WSOL_ACC]: 50_002_039_280n },
    };
    expect(evaluateRisks(input([closeWsol], wsol))[0]!.message).toBe(
      'Closes a wrapped SOL account and sends its 50.00203928 SOL to an address you do not own.',
    );
  });

  it('flags durable nonces, unknown programs, failed simulation and relation mismatches', () => {
    const nonce = ix({ programId: address(SYSTEM_PROGRAM), name: 'advanceNonceAccount' });
    const unknown = ix({ index: 1, programId: OTHER });
    expect(
      rules(
        input([nonce, unknown], {
          balanceChanges: null,
          issues: [{ stage: 'simulate', message: 'Simulation failed: custom error 1' }],
          relations: [{ kind: 'pda', from: OTHER, to: OTHER, label: 'PDA', status: 'mismatch', instructionIndex: 1, external: false }],
        }),
      ),
    ).toEqual([
      ['durable-nonce', 'danger'],
      ['unknown-program', 'warn'],
      ['relation-mismatch', 'danger'],
      ['simulation-failed', 'warn'],
      ['unexplained-outflow', 'danger'],
    ]);
    // A simulate issue that still produced balance changes is not a failed simulation.
    const conservative = [{ stage: 'simulate' as const, message: 'state changed during simulation; balances computed conservatively' }];
    expect(rules(input([], { issues: conservative }))).toEqual([]);
  });

  it('makes a durable nonce danger when anything else is flagged or someone else controls the nonce', () => {
    const nonce = (authority: Address) =>
      ix({ programId: address(SYSTEM_PROGRAM), name: 'advanceNonceAccount', accounts: [named('nonceAuthority', authority)] });
    const warnings = evaluateRisks(input([nonce(ME)]));
    expect(warnings.map((w) => [w.rule, w.severity])).toEqual([['durable-nonce', 'warn']]);
    expect(warnings[0]!.message).toMatch(/ Balance changes reflect current state only\.$/);
    expect(rules(input([nonce(OTHER)]))).toEqual([['durable-nonce', 'danger']]);
    const unknown = ix({ index: 1, programId: OTHER });
    expect(rules(input([nonce(ME), unknown]))).toEqual([
      ['durable-nonce', 'danger'],
      ['unknown-program', 'warn'],
    ]);
  });

  it('reports each undecodable program once', () => {
    const unknown = (index: number, programId: Address) => ix({ index, programId });
    expect(rules(input([unknown(0, OTHER), unknown(1, OTHER), unknown(2, ME)]))).toEqual([
      ['unknown-program', 'warn'],
      ['unknown-program', 'warn'],
    ]);
    expect(evaluateRisks(input([], { balanceChanges: null, issues: [{ stage: 'simulate', message: 'x' }] }))[0]!.message).toBe(
      'Simulation failed or unavailable: balance changes are unknown.',
    );
  });

  it('treats revoking or keeping an authority as warn, handing it to someone else as danger', () => {
    const set = (newAuthority: unknown) => ix({ name: 'setAuthority', args: { newAuthority } });
    expect(rules(input([set({ __option: 'Some', value: OTHER })]))).toEqual([['authority-change', 'danger']]);
    expect(rules(input([set({ __option: 'Some', value: ME })]))).toEqual([['authority-change', 'warn']]);
    expect(rules(input([set({ __option: 'None' })]))).toEqual([['authority-change', 'warn']]);
    expect(rules(input([set(null)]))).toEqual([['authority-change', 'warn']]);
    expect(rules(input([set('garbage')]))).toEqual([['authority-change', 'danger']]);
  });

  it('flags outflows when part of the transaction is unexplained', () => {
    const unknown = ix({ programId: OTHER });
    const out = input([unknown], { balanceChanges: [{ owner: ME, mint: 'SOL', decimals: 9, delta: -500_000_000n }] });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
    const tokens = input([unknown], { balanceChanges: [{ owner: ME, mint: OTHER, decimals: 6, delta: -1n }] });
    expect(rules(tokens)).toContainEqual(['unexplained-outflow', 'danger']);
  });

  describe('unexplained outflows with prices', () => {
    const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    const WSOL = address('So11111111111111111111111111111111111111112');
    const ME2 = address('8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR');
    const SCAM = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
    const router = ix({ programId: OTHER, idl: undefined });
    const tok = (mint: Address, delta: bigint, owner: Address = ME, decimals = 6): BalanceChange => ({ owner, mint, decimals, delta });
    const usdc = (delta: bigint) => tok(USDC, delta);
    const usdt = (delta: bigint) => tok(USDT, delta);
    const sol = (delta: bigint, owner: Address = ME): BalanceChange => ({ owner, mint: 'SOL', decimals: 9, delta });
    const prices = { SOL: 150, [USDC]: 1, [USDT]: 1, [WSOL]: 150, [SCAM]: 1 };
    const outflowRule = (i: RiskInput) => evaluateRisks(i).find((w) => w.rule === 'unexplained-outflow');
    const DOWNGRADED = "Funds leave your wallet through a program Clef can't decode; you receive about the same value back in SOL/major stablecoins.";

    it('downgrades to warn when about the same value comes back in SOL or a major stablecoin', () => {
      // $100 of USDC out through an undecodable router, $95 of USDT back.
      const w = outflowRule(input([router], { balanceChanges: [usdc(-100_000_000n), usdt(95_000_000n)], prices }));
      expect(w).toMatchObject({ severity: 'warn', message: DOWNGRADED });
      // 1 SOL ($150) out, $140 of USDC back.
      expect(outflowRule(input([router], { balanceChanges: [sol(-1_000_000_000n), usdc(140_000_000n)], prices }))?.severity).toBe('warn');
    });

    it('stays danger when much less comes back', () => {
      const w = outflowRule(input([router], { balanceChanges: [usdc(-100_000_000n), usdt(1_000_000n)], prices }));
      expect(w).toMatchObject({ severity: 'danger', message: 'Funds leave your wallet in a transaction Clef cannot fully explain.' });
      // A 60% payback in SOL.
      expect(outflowRule(input([router], { balanceChanges: [usdc(-250_000_000n), sol(1_000_000_000n)], prices }))?.severity).toBe('danger');
      expect(outflowRule(input([router], { balanceChanges: [usdc(-100_000_000n), usdt(89_000_000n)], prices }))?.severity).toBe('danger');
    });

    it('never counts a payback in other tokens, even priced or valued ones', () => {
      const scam = [usdc(-100_000_000n), tok(SCAM, 1_000_000_000n)];
      expect(outflowRule(input([router], { balanceChanges: scam, prices }))?.severity).toBe('danger');
      expect(outflowRule(input([router], { balanceChanges: scam, prices, valuedMints: new Set([SCAM]) }))?.severity).toBe('danger');
    });

    it('nets the user\'s own churn: unwrapping your own wSOL is not a payback', () => {
      const unwrap = [usdc(-100_000_000n), tok(WSOL, -1_000_000_000n, ME, 9), sol(1_000_000_000n)];
      expect(outflowRule(input([router], { balanceChanges: unwrap, prices }))?.severity).toBe('danger');
    });

    it('nets the user\'s own churn: moving SOL between your wallets is not a payback', () => {
      const move = [usdc(-100_000_000n), sol(-1_000_000_000n), sol(1_000_000_000n, ME2)];
      expect(outflowRule(input([router], { balanceChanges: move, prices, me: [ME, ME2] }))?.severity).toBe('danger');
    });

    it('never downgrades when the SOL coming back may be your own: another account loses lamports', () => {
      const STAKE_ACCOUNT = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
      // A stake withdrawal (or a lending position, a nonce account...) funds the "payback".
      const withdraw = [usdc(-100_000_000n), sol(-1_000_000_000n, STAKE_ACCOUNT), sol(1_000_000_000n)];
      expect(outflowRule(input([router], { balanceChanges: withdraw, prices }))?.severity).toBe('danger');
      // A decrease within the rent slack (e.g. a closed account's rent) is ignored.
      const rent = [usdc(-100_000_000n), sol(-2_000_000n, STAKE_ACCOUNT), usdt(95_000_000n)];
      expect(outflowRule(input([router], { balanceChanges: rent, prices }))?.severity).toBe('warn');
      // So is the fee paid by a fee payer who isn't you (sponsored), up to the allowed fee.
      const sponsored = [usdc(-100_000_000n), sol(-20_000_000n, STAKE_ACCOUNT), usdt(95_000_000n)];
      const fee = { feePayer: STAKE_ACCOUNT, fee: 10_005_000n, baseFee: 5000n };
      expect(outflowRule(input([router], { balanceChanges: sponsored, prices, ...fee }))?.severity).toBe('warn');
      expect(outflowRule(input([router], { balanceChanges: sponsored, prices }))?.severity).toBe('danger');
    });

    describe('with account info, only SOL from sources you plausibly control blocks the downgrade', () => {
      const SOURCE = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
      const CURVE_PROGRAM = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
      const payback = [usdc(-100_000_000n), sol(-700_000_000n, SOURCE), sol(700_000_000n)];
      const severity = (info: { owner: Address; dataLength: number; signer: boolean }) =>
        outflowRule(input([router], { balanceChanges: payback, prices, accountInfo: { [SOURCE]: info } }))?.severity;

      it('stake and vote withdrawals stay danger', () => {
        expect(severity({ owner: address(STAKE_PROGRAM), dataLength: 200, signer: false })).toBe('danger');
        expect(severity({ owner: address(VOTE_PROGRAM), dataLength: 3762, signer: false })).toBe('danger');
      });

      it('a nonce account withdrawal stays danger', () => {
        expect(severity({ owner: address(SYSTEM_PROGRAM), dataLength: 80, signer: false })).toBe('danger');
      });

      it('SOL from another signing keypair stays danger', () => {
        expect(severity({ owner: address(SYSTEM_PROGRAM), dataLength: 0, signer: true })).toBe('danger');
      });

      it('a curve or pool PDA paying SOL downgrades to warn', () => {
        expect(severity({ owner: CURVE_PROGRAM, dataLength: 150, signer: false })).toBe('warn');
        // A non-signing system account (e.g. a wallet that is not part of this signing) is not yours either.
        expect(severity({ owner: address(SYSTEM_PROGRAM), dataLength: 0, signer: false })).toBe('warn');
      });

      it('a source missing from the account info counts as possibly yours', () => {
        const other = address('FXZYmk8C97rhzTn7nE8YZCw1V9EGofcJ8jJ5XidoddLz');
        expect(outflowRule(input([router], { balanceChanges: payback, prices, accountInfo: { [other]: { owner: address(SYSTEM_PROGRAM), dataLength: 0, signer: false } } }))?.severity).toBe('danger');
      });

      it('without account info, any account losing SOL blocks it (fail safe)', () => {
        expect(outflowRule(input([router], { balanceChanges: payback, prices }))?.severity).toBe('danger');
      });
    });

    for (const bad of [0, -1, Infinity, NaN]) {
      it(`treats a price of ${bad} as missing`, () => {
        const SCAM_OUT = tok(SCAM, -5_000_000_000n);
        // A worthless-priced outflow can't make a small payback look comparable.
        expect(outflowRule(input([router], { balanceChanges: [SCAM_OUT, sol(20_000_000n)], prices: { SOL: 150, [SCAM]: bad } }))?.severity).toBe('danger');
        // Nor can an absurdly priced inflow.
        expect(outflowRule(input([router], { balanceChanges: [usdc(-100_000_000n), sol(20_000_000n)], prices: { SOL: bad, [USDC]: 1 } }))?.severity).toBe('danger');
      });
    }

    it('stays danger without a price for every outflow and inflow', () => {
      const swap = [usdc(-100_000_000n), usdt(99_000_000n)];
      expect(outflowRule(input([router], { balanceChanges: swap }))?.severity).toBe('danger');
      expect(outflowRule(input([router], { balanceChanges: swap, prices: { [USDC]: 1 } }))?.severity).toBe('danger');
      expect(outflowRule(input([router], { balanceChanges: swap, prices: { [USDT]: 1 } }))?.severity).toBe('danger');
      // An unknown-decimals outflow can't be priced either.
      expect(outflowRule(input([router], { balanceChanges: [{ ...usdc(-100_000_000n), decimals: null }, usdt(99_000_000n)], prices }))?.severity).toBe('danger');
    });

    it('stays danger when nothing comes back or the balance changes are unknown', () => {
      expect(outflowRule(input([router], { balanceChanges: [usdc(-100_000_000n)], prices }))?.severity).toBe('danger');
      const unknown = input([router], { balanceChanges: null, prices, issues: [{ stage: 'simulate', message: 'Simulation failed' }] });
      expect(outflowRule(unknown)?.severity).toBe('danger');
    });
  });

  it('treats unknown balance changes as a possible outflow', () => {
    const out = input([ix({ programId: OTHER })], {
      balanceChanges: null,
      issues: [{ stage: 'simulate', message: 'Simulation failed: custom error 1' }],
    });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
  });

  describe('high fees', () => {
    const SOL = 1_000_000_000n;
    const sol = (delta: bigint) => [{ owner: ME, mint: 'SOL' as const, decimals: 9, delta }];
    const unknown = [ix({ programId: OTHER })];
    const curatedOnly = [ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol' })];

    it('warns when the priority fee exceeds 0.01 SOL, danger beyond 5% of the payer balance', () => {
      const base = { feePayer: ME, baseFee: 5000n, balanceChanges: [] };
      const fee = (priority: bigint) => 5000n + priority;
      expect(rules(input(curatedOnly, { ...base, fee: fee(10_000_000n) }))).toEqual([]);
      expect(rules(input(curatedOnly, { ...base, fee: fee(10_000_001n) }))).toEqual([['high-fee', 'warn']]);
      expect(rules(input(curatedOnly, { ...base, fee: fee(10_000_001n), solBalances: { [ME]: 10n * SOL } }))).toEqual([['high-fee', 'warn']]);
      expect(rules(input(curatedOnly, { ...base, fee: fee(500_000_001n), solBalances: { [ME]: 10n * SOL } }))).toEqual([['high-fee', 'danger']]);
      // Over 5% of a small balance, but not over 0.05 SOL: warn.
      expect(rules(input(curatedOnly, { ...base, fee: fee(20_000_000n), solBalances: { [ME]: 3n * SOL / 10n } }))).toEqual([['high-fee', 'warn']]);
      expect(rules(input(curatedOnly, { ...base, fee: fee(50_000_001n), solBalances: { [ME]: 3n * SOL / 10n } }))).toEqual([['high-fee', 'danger']]);
      expect(evaluateRisks(input(curatedOnly, { ...base, fee: fee(500_000_001n) }))[0]!.message).toBe('Pays a priority fee of 0.500000001 SOL.');
      // Someone else pays: not your loss.
      expect(rules(input(curatedOnly, { ...base, feePayer: OTHER, fee: fee(SOL) }))).toEqual([]);
    });

    it('flags the 1.4M CU x 6e12 microLamport case', () => {
      // 1.4M CU x 6e12 microLamports = 8400 SOL; 6e9 microLamports = 8.4 SOL.
      for (const [price, expected] of [[6_000_000_000_000n, 8_400_000_005_000n], [6_000_000_000n, 8_400_005_000n]] as const) {
        const fee = estimateFee(1, 1_400_000, price);
        expect(fee).toBe(expected);
        const out = input(curatedOnly, { fee, baseFee: 5000n, feePayer: ME, solBalances: { [ME]: 10n * SOL }, balanceChanges: sol(-fee - SOL / 1000n) });
        expect(rules(out)).toContainEqual(['high-fee', 'danger']);
      }
    });

    it('caps the fee that counts toward the outflow allowance at 0.01 SOL plus the base fee', () => {
      const fee = 5000n + SOL;
      // A 1 SOL priority fee no longer hides a 0.9 SOL outflow from an unexplained program.
      const out = input(unknown, { fee, baseFee: 5000n, feePayer: ME, balanceChanges: sol(-fee - 900_000_000n) });
      expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
      // Within the cap the fee is still allowed for.
      const small = 5000n + 10_000_000n;
      expect(rules(input(unknown, { fee: small, baseFee: 5000n, feePayer: ME, balanceChanges: sol(-small) }))).toEqual([['unknown-program', 'warn']]);
    });
  });

  it('does not count the fee or a little rent as an outflow', () => {
    const fee = estimateFee(1, 200_000, 50_000n);
    const sol = (delta: bigint) => [{ owner: ME, mint: 'SOL' as const, decimals: 9, delta }];
    const unknown = [ix({ programId: OTHER })];
    expect(rules(input(unknown, { balanceChanges: sol(-fee), fee, feePayer: ME }))).toEqual([['unknown-program', 'warn']]);
    expect(rules(input(unknown, { balanceChanges: sol(-fee - 2_039_280n), fee, feePayer: ME }))).toEqual([['unknown-program', 'warn']]);
    expect(rules(input(unknown, { balanceChanges: sol(-fee - 500_000_000n), fee, feePayer: ME }))).toContainEqual([
      'unexplained-outflow',
      'danger',
    ]);
  });

  it('estimates fees from signatures and priority price', () => {
    expect(estimateFee(1)).toBe(5000n);
    expect(estimateFee(2, 200_000, 1n)).toBe(10_001n);
    expect(estimateFee(1, 1_400_000, 1000n)).toBe(6400n);
    // No explicit limit: 200k CU per non-compute-budget instruction, capped at 1.4M.
    expect(estimateFee(1, undefined, 1000n, 3)).toBe(5600n);
    expect(estimateFee(1, undefined, 1_000_000n, 10)).toBe(1_405_000n);
    // The runtime clamps an explicit limit to 1.4M: a larger one must not inflate the fee allowance.
    expect(estimateFee(1, 4_000_000_000, 1_000_000n)).toBe(1_405_000n);
  });

  it('applies token rules to Token-2022 too', () => {
    const t22 = address(TOKEN_2022_PROGRAM);
    expect(rules(input([ix({ programId: t22, name: 'approveChecked', args: { amount: U64_MAX } })]))).toEqual([['delegation', 'danger']]);
    expect(rules(input([ix({ programId: t22, name: 'setAuthority' })]))).toEqual([['authority-change', 'danger']]);
    const close = ix({ programId: t22, name: 'closeAccount', accounts: [named('account', ME, true), named('destination', OTHER)] });
    expect(rules(input([close]))).toEqual([['close-to-third-party', 'danger']]);
  });

  it('keys on the program id, not the instruction name', () => {
    expect(rules(input([ix({ programId: OTHER, name: 'setAuthority' })]))).toEqual([]);
  });

  it('does not flag closing to yourself, reassigning others, or unverified relations', () => {
    const toMe = ix({ name: 'closeAccount', accounts: [named('account', ME, true), named('destination', ME)] });
    const toMyAta = ix({ name: 'closeAccount', accounts: [named('account', ME, true), named('destination', OTHER, true)] });
    const assignOther = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named('account', OTHER)] });
    const unverified = { kind: 'pda' as const, from: OTHER, to: OTHER, label: 'PDA', status: 'unverified' as const, external: false };
    expect(rules(input([toMe, toMyAta, assignOther], { relations: [unverified] }))).toEqual([]);
  });

  it('does not flag a co-signer closing their own account to themselves', () => {
    // Bundles where several wallets sign: someone else's key closes someone else's account. Your signature
    // authorizes nothing here, and none of it is yours.
    const ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const cosigner = (a: Address) => ({ ...named('owner', a), signer: true });
    const theirs = ix({ name: 'closeAccount', accounts: [named('account', ACC), named('destination', OTHER), cosigner(OTHER)] });
    const known = { accountLamports: { [ACC]: 2_039_280n } };
    expect(rules(input([theirs], known))).toEqual([]);
    // Without the closed account's pre-state, it could be yours: fail closed.
    expect(rules(input([theirs]))).toEqual([['close-to-third-party', 'danger']]);
    expect(rules(input([theirs], { accountLamports: {} }))).toEqual([['close-to-third-party', 'danger']]);

    // Still flagged: the closed account is yours (by flag, or by its pre-state holder)...
    const yours = ix({ name: 'closeAccount', accounts: [named('account', ACC, true), named('destination', OTHER), cosigner(OTHER)] });
    expect(rules(input([yours], known))).toEqual([['close-to-third-party', 'danger']]);
    const held = { ...known, tokenBalances: { [ACC]: { owner: ME, mint: USDC, amount: 0n } } };
    expect(rules(input([theirs], held))).toEqual([['close-to-third-party', 'danger']]);
    // ...you are the closing authority...
    const byYou = ix({ name: 'closeAccount', accounts: [named('account', ACC), named('destination', OTHER), cosigner(ME)] });
    expect(rules(input([byYou], known))).toEqual([['close-to-third-party', 'danger']]);
    // ...the authority is not a single signing key (a token multisig, whose signers follow)...
    const multisig = ix({
      name: 'closeAccount',
      accounts: [named('account', ACC), named('destination', OTHER), named('owner', OTHER), { ...named(undefined, ME), signer: true }],
    });
    expect(rules(input([multisig], known))).toEqual([['close-to-third-party', 'danger']]);
    const unsigned = ix({ name: 'closeAccount', accounts: [named('account', ACC), named('destination', OTHER), named('owner', OTHER)] });
    expect(rules(input([unsigned], known))).toEqual([['close-to-third-party', 'danger']]);
    // ...or the names are unknown.
    const ambiguous = ix({
      name: 'closeAccount', accounts: [named(undefined, ACC), named(undefined, OTHER), { ...named(undefined, OTHER), signer: true }],
    });
    expect(rules(input([ambiguous], known))).toEqual([['close-to-third-party', 'danger']]);
  });

  it('does not flag a co-signer delegating their own tokens', () => {
    const ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const known = { accountLamports: { [ACC]: 2_039_280n } };
    const cosigner = (a: Address) => ({ ...named('owner', a), signer: true });
    for (const name of ['approve', 'approveChecked']) {
      const approve = (accounts: ReturnType<typeof named>[]) => ix({ name, args: { amount: U64_MAX }, accounts });
      const theirs = approve([named('source', ACC), named('delegate', OTHER), cosigner(OTHER)]);
      expect(rules(input([theirs], known))).toEqual([]);
      // Without the source's pre-state, it could be yours: fail closed.
      expect(rules(input([theirs]))).toEqual([['delegation', 'danger']]);

      // Still flagged: the source is yours (by flag, or by its pre-state holder)...
      expect(rules(input([approve([named('source', ACC, true), named('delegate', OTHER), cosigner(OTHER)])], known))).toEqual([['delegation', 'danger']]);
      const held = { ...known, tokenBalances: { [ACC]: { owner: ME, mint: USDC, amount: 5n } } };
      expect(rules(input([theirs], held))).toEqual([['delegation', 'danger']]);
      // ...you are the owner...
      expect(rules(input([approve([named('source', ACC), named('delegate', OTHER), cosigner(ME)])], known))).toEqual([['delegation', 'danger']]);
      // ...the owner is a multisig or does not sign...
      const multisig = approve([named('source', ACC), named('delegate', OTHER), named('owner', OTHER), { ...named(undefined, ME), signer: true }]);
      expect(rules(input([multisig], known))).toEqual([['delegation', 'danger']]);
      expect(rules(input([approve([named('source', ACC), named('delegate', OTHER), named('owner', OTHER)])], known))).toEqual([['delegation', 'danger']]);
      // ...or the names are unknown.
      const ambiguous = approve([named(undefined, ACC), named(undefined, OTHER), { ...named(undefined, OTHER), signer: true }]);
      expect(rules(input([ambiguous], known))).toEqual([['delegation', 'danger']]);
    }
  });

  it('treats your wallet as yours even when the mine flag is unset', () => {
    const assign = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named('account', ME)] });
    expect(rules(input([assign]))).toEqual([['authority-change', 'danger']]);
    const withSeed = ix({
      programId: address(SYSTEM_PROGRAM), name: 'assignWithSeed', accounts: [named('account', OTHER), named('baseAccount', ME)],
    });
    expect(rules(input([withSeed]))).toEqual([['authority-change', 'danger']]);
  });

  it('warns conservatively when ambiguous names hide the account a rule needs', () => {
    const close = ix({ name: 'closeAccount', accounts: [named(undefined, ME, true), named(undefined, OTHER), named(undefined, ME)] });
    expect(rules(input([close]))).toEqual([['close-to-third-party', 'danger']]);
    const closeShort = ix({ name: 'closeAccount', accounts: [named('account', ME, true)] });
    expect(rules(input([closeShort]))).toEqual([['close-to-third-party', 'danger']]);
    const assign = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named(undefined, OTHER)] });
    expect(rules(input([assign]))).toEqual([['authority-change', 'danger']]);
    const withSeed = ix({
      programId: address(SYSTEM_PROGRAM), name: 'assignWithSeed', accounts: [named('account', OTHER), named(undefined, OTHER)],
    });
    expect(rules(input([withSeed]))).toEqual([['authority-change', 'danger']]);
  });

  describe('state changes (catch CPI-made changes)', () => {
    const ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const tokenChange = (over: Partial<StateChange>): StateChange =>
      ({ address: ACC, kind: 'token-owner', before: ME, after: OTHER, holder: ME, balance: 100n, ...over });
    const withState = (stateChanges: StateChange[], instructions: ExplainedInstruction[] = []) =>
      rules(input(instructions, { stateChanges }));

    it('flags your account being reassigned to another program', () => {
      expect(withState([{ address: ME, kind: 'program-owner', before: address(SYSTEM_PROGRAM), after: OTHER }])).toEqual([
        ['authority-change', 'danger'],
      ]);
      expect(withState([{ address: OTHER, kind: 'program-owner', before: address(SYSTEM_PROGRAM), after: OTHER }])).toEqual([]);
    });

    it('flags your token accounts changing owner or close authority to someone else', () => {
      expect(withState([tokenChange({})])).toEqual([['authority-change', 'danger']]);
      expect(withState([tokenChange({ kind: 'token-close-authority', before: null })])).toEqual([['authority-change', 'danger']]);
      expect(withState([tokenChange({ kind: 'token-close-authority', before: null, after: ME })])).toEqual([]);
      expect(withState([tokenChange({ holder: OTHER, before: OTHER, after: ME })])).toEqual([]);
    });

    it('flags delegation of your tokens: danger for the whole balance or 2^63+', () => {
      const delegate = (amount: bigint, after: Address = OTHER) =>
        tokenChange({ kind: 'token-delegate', before: null, after, amount });
      expect(withState([delegate(50n)])).toEqual([['delegation', 'warn']]);
      expect(withState([delegate(100n)])).toEqual([['delegation', 'danger']]);
      expect(withState([{ ...delegate(1n << 63n), balance: undefined }])).toEqual([['delegation', 'danger']]);
      expect(withState([delegate(100n, ME)])).toEqual([]);
    });

    it('catches a drainer that approves through CPI', () => {
      const swap = ix({ programId: OTHER, name: 'swap', idl: { source: 'program-metadata', trust: 'authority', hash: 'h' } });
      const delegateAll = tokenChange({ kind: 'token-delegate', before: null, after: OTHER, amount: 100n });
      expect(withState([delegateAll], [swap])).toContainEqual(['delegation', 'danger']);
    });

    it('does not repeat what an instruction rule already said, but raises its severity', () => {
      const approve = (amount: bigint) =>
        ix({ name: 'approve', args: { amount }, accounts: [named('source', ACC, true), named('delegate', OTHER), named('owner', ME)] });
      const delegateAll = tokenChange({ kind: 'token-delegate', before: null, after: OTHER, amount: 100n });
      expect(withState([delegateAll], [approve(U64_MAX)])).toEqual([['delegation', 'danger']]);
      expect(withState([delegateAll], [approve(100n)])).toEqual([['delegation', 'danger']]);
      const setAuth = ix({ name: 'setAuthority', accounts: [named('owned', ACC, true), named('owner', ME)] });
      expect(withState([tokenChange({})], [setAuth])).toEqual([['authority-change', 'danger']]);
      const assign = ix({ programId: address(SYSTEM_PROGRAM), name: 'assign', accounts: [named('account', ME, true)] });
      expect(withState([{ address: ME, kind: 'program-owner', before: address(SYSTEM_PROGRAM), after: OTHER }], [assign])).toEqual([
        ['authority-change', 'danger'],
      ]);
    });
  });

  describe('outflows to programs that describe themselves, and sweeps', () => {
    const JUP = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
    const DRAINER = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    const authority = { source: 'program-metadata' as const, trust: 'authority' as const, hash: 'h' };
    const curated = { source: 'bundled' as const, trust: 'curated' as const, hash: 'h' };
    const change = (owner: Address, mint: Address | 'SOL', delta: bigint): BalanceChange =>
      ({ owner, mint, decimals: mint === 'SOL' ? 9 : 6, delta });
    const SOL = 1_000_000_000n;

    it('warns once per non-core program decoded only by its own IDL when funds leave', () => {
      const claim = (index: number) => ix({ index, programId: DRAINER, name: 'claimAirdrop', idl: authority });
      const balanceChanges = [change(ME, USDC, -5n)];
      const warnings = evaluateRisks(input([claim(0), claim(1)], { balanceChanges }));
      expect(warnings.map((w) => [w.rule, w.severity])).toEqual([['self-described-outflow', 'warn']]);
      expect(warnings[0]!.message).toBe(
        `${shortAddress(DRAINER)} describes itself with its own IDL; Clef can't independently verify what it does with your funds.`,
      );
      expect(rules(input([claim(0)], { balanceChanges: [change(ME, USDC, 5n)] }))).toEqual([]);
      const core = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: authority });
      // A core program never counts as self-described; a non-curated name for it counts as undecoded.
      expect(rules(input([core], { balanceChanges }))).toEqual([['unknown-program', 'warn'], ['unexplained-outflow', 'danger']]);
    });

    it('flags an all-curated sweep of SOL and USDC to a wallet', () => {
      const transferSol = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const transfer = ix({ index: 1, name: 'transfer', idl: curated });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      expect(rules(input([transferSol, transfer], { balanceChanges }))).toEqual([['sweep', 'danger']]);
    });

    it('does not flag a Jupiter swap (reviewed program; you receive something back)', () => {
      const swap = ix({ programId: JUP, name: 'route', idl: authority });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(ME, USDC, 300n), change(OTHER, 'SOL', 2n * SOL)];
      expect(rules(input([swap], { balanceChanges }))).toEqual([]);
      const sweptThroughJupiter = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      expect(rules(input([swap], { balanceChanges: sweptThroughJupiter }))).toEqual([['sweep', 'danger']]);
    });

    it('does not flag a single-asset deposit into a program vault, even of the whole balance', async () => {
      const [vault] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const deposit = ix({ programId: DRAINER, name: 'deposit', idl: curated });
      const deposited = (delta: bigint) => [change(ME, USDC, -delta), change(vault, USDC, delta)];
      const tokenBalances = { [OTHER]: { owner: ME, mint: USDC, amount: 100n } };
      expect(rules(input([deposit], { balanceChanges: deposited(50n), tokenBalances }))).toEqual([]);
      expect(rules(input([deposit], { balanceChanges: deposited(100n), tokenBalances }))).toEqual([]);
      const solDeposit = [change(ME, 'SOL', -SOL), change(vault, 'SOL', SOL)];
      expect(rules(input([deposit], { balanceChanges: solDeposit, solBalances: { [ME]: SOL + 1n } }))).toEqual([]);
    });

    it('does not flag a partial send to a wallet, or a small tip alongside a deposit', async () => {
      const send = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const sent = [change(ME, 'SOL', -SOL), change(OTHER, 'SOL', SOL)];
      expect(rules(input([send], { balanceChanges: sent }))).toEqual([]);
      expect(rules(input([send], { balanceChanges: sent, solBalances: { [ME]: 10n * SOL } }))).toEqual([]);
      const [vault] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const deposit = ix({ programId: DRAINER, name: 'deposit', idl: curated });
      const tipped = [change(ME, USDC, -10n), change(vault, USDC, 10n), change(ME, 'SOL', -100_000n), change(OTHER, 'SOL', 100_000n)];
      expect(rules(input([deposit], { balanceChanges: tipped }))).toEqual([]);
    });

    it('warns when (almost) a whole balance goes to a wallet outside your address book', () => {
      const send = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const max = [change(ME, 'SOL', -SOL + 5000n), change(OTHER, 'SOL', SOL - 10_000n)];
      const warnings = evaluateRisks(input([send], { balanceChanges: max, solBalances: { [ME]: SOL } }));
      expect(warnings.map((w) => [w.rule, w.severity, w.message])).toEqual([
        ['send-entire-balance', 'warn', `Sends (almost) your entire SOL balance to ${shortAddress(OTHER)}.`],
      ]);
      expect(rules(input([send], { balanceChanges: max, solBalances: { [ME]: SOL }, addressBook: new Set([OTHER]) }))).toEqual([]);
      const usdc = [{ ...change(ME, USDC, -100n), symbol: 'USDC' }, change(OTHER, USDC, 100n)];
      const tokenBalances = { [DRAINER]: { owner: ME, mint: USDC, amount: 100n } };
      expect(evaluateRisks(input([send], { balanceChanges: usdc, tokenBalances }))[0]!.message).toBe(
        `Sends (almost) your entire USDC balance to ${shortAddress(OTHER)}.`,
      );
      // A label is preferred over the short address.
      expect(evaluateRisks(input([send], { balanceChanges: usdc, tokenBalances, labels: { [OTHER]: 'Bob' } }))[0]!.message).toBe(
        'Sends (almost) your entire USDC balance to Bob.',
      );
    });

    it('counts SOL received as the wrapped SOL you lose', () => {
      const WSOL = address('So11111111111111111111111111111111111111112');
      const WSOL_ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
      const close = ix({ name: 'closeAccount', idl: curated });
      const closed = [{ ...change(ME, WSOL, -50n * SOL), symbol: 'wSOL', decimals: 9 }, change(ME, 'SOL', -2_039_280n), change(OTHER, 'SOL', 50n * SOL + 2_039_280n)];
      const tokenBalances = { [WSOL_ACC]: { owner: ME, mint: WSOL, amount: 50n * SOL } };
      expect(evaluateRisks(input([close], { balanceChanges: closed, tokenBalances })).map((w) => [w.rule, w.message])).toContainEqual([
        'send-entire-balance', `Sends (almost) your entire wSOL balance to ${shortAddress(OTHER)}.`,
      ]);
    });

    it('names the recipients of a sweep', () => {
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      const drain = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const one = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      expect(evaluateRisks(input([drain], { balanceChanges: one }))[0]!.message).toBe(
        `Moves several of your assets to ${shortAddress(OTHER)} without giving you comparable value back.`,
      );
      const two = [...one, change(ME, USDT, -5n), change(DRAINER, USDT, 5n)];
      expect(evaluateRisks(input([drain], { balanceChanges: two, labels: { [DRAINER]: 'Eve' } }))[0]!.message).toBe(
        `Moves several of your assets to ${shortAddress(OTHER)}, Eve without giving you comparable value back.`,
      );
    });

    it('without prices, an inflow of one asset only offsets an outflow of that asset', () => {
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      const otc = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      // SOL out to a wallet, USDT back: a trade, not a sweep.
      const trade = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDT, 300_000_000n)];
      expect(rules(input([otc], { balanceChanges: trade }))).toEqual([]);
      // Two assets out, a little of one of them back (netted per asset): still two assets leaving.
      const twoOut = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      expect(rules(input([otc], { balanceChanges: [...twoOut, change(ME, USDT, 5_000_000n)] }))).toEqual([['sweep', 'danger']]);
    });

    it('with prices, an inflow defuses a sweep only if it is worth at least half the outflow', () => {
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      const otc = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const prices = { SOL: 150, [USDC]: 1, [USDT]: 1 };
      // $300 of SOL and $100 of USDC leave.
      const twoOut = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100_000_000n), change(OTHER, USDC, 100_000_000n)];
      const back = (usd: bigint) => [...twoOut, change(ME, USDT, usd * 1_000_000n)];
      expect(rules(input([otc], { balanceChanges: back(1n), prices }))).toEqual([['sweep', 'danger']]);
      expect(rules(input([otc], { balanceChanges: back(199n), prices }))).toEqual([['sweep', 'danger']]);
      expect(rules(input([otc], { balanceChanges: back(200n), prices }))).toEqual([]);
      // A missing price falls back to the price-less rule.
      expect(rules(input([otc], { balanceChanges: back(200n), prices: { SOL: 150, [USDT]: 1 } }))).toEqual([['sweep', 'danger']]);
    });

    it('nets the user\'s own churn before weighing what comes back', () => {
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      const WSOL = address('So11111111111111111111111111111111111111112');
      const ME2 = address('8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR');
      const otc = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const prices = { SOL: 150, [USDC]: 1, [USDT]: 1, [WSOL]: 150 };
      // $100 of USDC and $100 of USDT leave to OTHER.
      const twoOut = [change(ME, USDC, -100_000_000n), change(OTHER, USDC, 100_000_000n), change(ME, USDT, -100_000_000n), change(OTHER, USDT, 100_000_000n)];
      // Unwrapping your own 2 wSOL ($300) into SOL is not value coming back.
      const unwrap = [...twoOut, { owner: ME, mint: WSOL, decimals: 9, delta: -2n * SOL }, { owner: ME, mint: 'SOL', decimals: 9, delta: 2n * SOL }];
      expect(rules(input([otc], { balanceChanges: unwrap as BalanceChange[], prices }))).toEqual([['sweep', 'danger']]);
      // Nor is moving 2 SOL from one of your wallets to another.
      const move = [...twoOut, { owner: ME, mint: 'SOL', decimals: 9, delta: -2n * SOL }, { owner: ME2, mint: 'SOL', decimals: 9, delta: 2n * SOL }];
      expect(rules(input([otc], { balanceChanges: move as BalanceChange[], prices, me: [ME, ME2] }))).toEqual([['sweep', 'danger']]);
    });

    it('never lets SOL from another account (e.g. your stake) count as value coming back', () => {
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      const STAKE_ACCOUNT = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
      const otc = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const prices = { SOL: 150, [USDC]: 1, [USDT]: 1 };
      const twoOut = [change(ME, USDC, -100_000_000n), change(OTHER, USDC, 100_000_000n), change(ME, USDT, -100_000_000n), change(OTHER, USDT, 100_000_000n)];
      const back = [change(STAKE_ACCOUNT, 'SOL', -2n * SOL), change(ME, 'SOL', 2n * SOL)];
      expect(rules(input([otc], { balanceChanges: [...twoOut, ...back], prices }))).toEqual([['sweep', 'danger']]);
      // The same payback from nowhere else defuses it.
      expect(rules(input([otc], { balanceChanges: [...twoOut, change(ME, 'SOL', 2n * SOL)], prices }))).toEqual([]);
    });

    for (const bad of [0, -1, Infinity, NaN]) {
      it(`sweep treats a price of ${bad} as missing`, () => {
        const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
        const otc = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
        const twoOut = [change(ME, USDC, -100_000_000n), change(OTHER, USDC, 100_000_000n), change(ME, USDT, -100_000_000n), change(OTHER, USDT, 100_000_000n)];
        // A bad price on an outflow (worth "nothing") or on the inflow (worth "everything") must not defuse it.
        const cheapOut = { SOL: 150, [USDC]: bad, [USDT]: bad };
        expect(rules(input([otc], { balanceChanges: [...twoOut, change(ME, 'SOL', SOL / 10n)], prices: cheapOut }))).toEqual([['sweep', 'danger']]);
        const richIn = { SOL: bad, [USDC]: 1, [USDT]: 1 };
        expect(rules(input([otc], { balanceChanges: [...twoOut, change(ME, 'SOL', SOL / 10n)], prices: richIn }))).toEqual([['sweep', 'danger']]);
      });
    }

    it('never exempts the recipients of top-level transfers, whatever else runs', async () => {
      const [pda] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const PDA_USDC = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');
      const decoy = ix({ programId: JUP, name: 'route', idl: authority });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(pda, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(pda, USDC, 100n)];
      const sendSol = (name: string | undefined) =>
        ix({ index: 1, programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated, accounts: [named('source', ME, true), named(name, pda)] });
      const sendUsdc = ix({
        index: 2, name: 'transferChecked', idl: curated,
        accounts: [named('source', OTHER, true), named('mint', USDC), named('destination', PDA_USDC), named('authority', ME)],
      });
      const tokenBalances = { [PDA_USDC]: { owner: pda, mint: USDC, amount: 0n } };
      expect(rules(input([decoy, sendSol('destination'), sendUsdc], { balanceChanges, tokenBalances }))).toEqual([['sweep', 'danger']]);
      // Ambiguous names: transferSol's destination is read by position.
      expect(rules(input([decoy, sendSol(undefined), sendUsdc], { balanceChanges, tokenBalances }))).toEqual([['sweep', 'danger']]);
      // A token destination's owner can come from post state.
      const postTokenOwners = { [PDA_USDC]: pda };
      expect(rules(input([decoy, sendSol('destination'), sendUsdc], { balanceChanges, postTokenOwners }))).toEqual([['sweep', 'danger']]);
      // Unknown token destination owner: no off-curve exemption at all.
      const sendUsdcOnly = [decoy, sendUsdc];
      expect(rules(input(sendUsdcOnly, { balanceChanges }))).toEqual([['sweep', 'danger']]);
      // A deposit made by the vault program itself (CPI, no top-level transfer) stays exempt.
      const deposit = ix({ programId: DRAINER, name: 'deposit', idl: curated });
      expect(rules(input([deposit], { balanceChanges }))).toEqual([]);
    });

    it('counts Token-2022 transferCheckedWithFee as a top-level transfer', async () => {
      const [pda] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const PDA_USDC = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');
      const decoy = ix({ programId: JUP, name: 'route', idl: authority });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(pda, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(pda, USDC, 100n)];
      // [source, mint, destination, authority]; destination by name, else at index 2.
      const withFee = (name: string | undefined) =>
        ix({
          index: 1, programId: address(TOKEN_2022_PROGRAM), name: 'transferCheckedWithFee', idl: curated,
          accounts: [named('source', OTHER, true), named('mint', USDC), named(name, PDA_USDC), named('authority', ME)],
        });
      // Unknown destination owner: no off-curve exemption at all.
      expect(rules(input([decoy, withFee('destination')], { balanceChanges }))).toEqual([['sweep', 'danger']]);
      const tokenBalances = { [PDA_USDC]: { owner: pda, mint: USDC, amount: 0n } };
      expect(rules(input([decoy, withFee(undefined)], { balanceChanges, tokenBalances }))).toEqual([['sweep', 'danger']]);
    });

    it('treats program-owned recipients as wallets when only core programs run', async () => {
      const [pda] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const transferSol = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const transferChecked = ix({ index: 1, name: 'transferChecked', idl: curated });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(pda, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(pda, USDC, 100n)];
      expect(rules(input([transferSol, transferChecked], { balanceChanges }))).toEqual([['sweep', 'danger']]);
      // Adding a program instruction doesn't help: these top-level transfers' recipients are never exempt.
      const deposit = ix({ index: 2, programId: DRAINER, name: 'deposit', idl: curated });
      expect(rules(input([transferSol, transferChecked, deposit], { balanceChanges }))).toEqual([['sweep', 'danger']]);
      expect(rules(input([deposit], { balanceChanges }))).toEqual([]);
    });

    it('does not let an airdrop of an unknown token defuse a sweep', () => {
      const JUNK = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
      const swept = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      const drain = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      expect(rules(input([drain], { balanceChanges: [...swept, change(ME, JUNK, 1_000_000n)] }))).toEqual([['sweep', 'danger']]);
      // Without prices, even a valued inflow of a third asset can't vouch for two assets leaving.
      expect(rules(input([drain], { balanceChanges: [...swept, change(ME, JUNK, 1n)], valuedMints: new Set([JUNK]) }))).toEqual([
        ['sweep', 'danger'],
      ]);
      const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      expect(rules(input([drain], { balanceChanges: [...swept, change(ME, USDT, 1n)] }))).toEqual([['sweep', 'danger']]);
      // A rent-sized SOL refund to another of your wallets isn't something received in exchange either.
      const refund = { balanceChanges: [...swept, change(JUP, 'SOL', RENT_SLACK)], me: [ME, JUP] };
      expect(rules(input([drain], refund))).toEqual([['sweep', 'danger']]);
    });
  });

  it('flags handing a nonce account to someone else', () => {
    const authorize = (newNonceAuthority: Address) =>
      ix({ programId: address(SYSTEM_PROGRAM), name: 'authorizeNonceAccount', args: { newNonceAuthority } });
    expect(rules(input([authorize(OTHER)]))).toEqual([['authority-change', 'danger']]);
    expect(rules(input([authorize(ME)]))).toEqual([]);
  });

  it('flags undecoded stake, vote and upgradeable-loader instructions as danger', () => {
    for (const program of [STAKE_PROGRAM, VOTE_PROGRAM, BPF_UPGRADEABLE_LOADER]) {
      expect(rules(input([ix({ programId: address(program) })]))).toEqual([['sensitive-program', 'danger']]);
    }
  });

  it('catches a drainer that parks your funds in a new account it can close', () => {
    const MY_ATA = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const PARKED = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
    const T = address(TOKEN_PROGRAM);
    const raw = (a: Address, data: Uint8Array): RawAccount => ({ address: a, owner: T, lamports: 2_039_280n, executable: false, data });
    const pre = [raw(MY_ATA, tokenAccountData(ME, USDC, 100n)), null];
    const post = [raw(MY_ATA, tokenAccountData(ME, USDC, 0n)), raw(PARKED, tokenAccountData(ME, USDC, 100n, { closeAuthority: OTHER }))];
    const mintInfo = () => ({ symbol: 'USDC', decimals: 6 });
    const balanceChanges = balanceChangesFromSimulation(pre, post, mintInfo).filter((c) => c.mint !== 'SOL');
    expect(balanceChanges).toEqual([]);
    const drainer = ix({ programId: OTHER, name: 'claim', idl: { source: 'program-metadata', trust: 'authority', hash: 'h' } });
    expect(rules(input([drainer], { balanceChanges, stateChanges: computeStateChanges(pre, post) }))).toContainEqual([
      'authority-change',
      'danger',
    ]);
  });

  it('treats an unreadable stake authorize type as danger', () => {
    const stake = (args: Record<string, unknown>) => ix({ programId: address(STAKE_PROGRAM), name: 'authorize', args });
    expect(rules(input([stake({ arg0: OTHER, arg1: 'staker' })]))).toEqual([['authority-change', 'danger']]);
    expect(rules(input([stake({ arg0: OTHER, arg1: { __discriminator: 0, __kind: 'Withdrawer' } })]))).toEqual([['authority-change', 'danger']]);
    expect(rules(input([stake({ arg0: OTHER, arg1: { __discriminator: 0, __kind: 'Staker' } })]))).toEqual([['stake-delegation-authority', 'warn']]);
  });
});
