import { address, getProgramDerivedAddress, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  estimateFee,
  evaluateRisks,
  shortAddress,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  U64_MAX,
  type ExplainedInstruction,
  type BalanceChange,
  type RiskInput,
  type StateChange,
} from '../src';
import { ME, OTHER, USDC } from './helpers';

const ix = (over: Partial<ExplainedInstruction>): ExplainedInstruction => ({
  index: 0, programId: address(TOKEN_PROGRAM), accounts: [], data: new Uint8Array(), ...over,
});
const input = (instructions: ExplainedInstruction[], over: Partial<RiskInput> = {}): RiskInput => ({
  instructions, relations: [], balanceChanges: [], issues: [], me: [ME], ...over,
});
const named = (name: string | undefined, address: Address, mine = false) => ({ name, address, signer: false, writable: true, mine });
const rules = (i: RiskInput) => evaluateRisks(i).map((w) => [w.rule, w.severity]);

describe('evaluateRisks', () => {
  it('flags unlimited token delegation as danger, limited as warn', () => {
    expect(rules(input([ix({ name: 'approve', args: { amount: U64_MAX } })]))).toEqual([['delegation', 'danger']]);
    expect(rules(input([ix({ name: 'approve', args: { amount: 5n } })]))).toEqual([['delegation', 'warn']]);
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
  });

  it('flags durable nonces, unknown programs, failed simulation and relation mismatches', () => {
    const nonce = ix({ programId: address(SYSTEM_PROGRAM), name: 'advanceNonceAccount' });
    const unknown = ix({ index: 1, programId: OTHER });
    expect(
      rules(
        input([nonce, unknown], {
          issues: [{ stage: 'simulate', message: 'Simulation failed: custom error 1' }],
          relations: [{ kind: 'pda', from: OTHER, to: OTHER, label: 'PDA', status: 'mismatch', instructionIndex: 1 }],
        }),
      ),
    ).toEqual([
      ['durable-nonce', 'warn'],
      ['unknown-program', 'warn'],
      ['relation-mismatch', 'danger'],
      ['simulation-failed', 'warn'],
    ]);
  });

  it('flags outflows when part of the transaction is unexplained', () => {
    const unknown = ix({ programId: OTHER });
    const out = input([unknown], { balanceChanges: [{ owner: ME, mint: 'SOL', decimals: 9, delta: -500_000_000n }] });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
    const tokens = input([unknown], { balanceChanges: [{ owner: ME, mint: OTHER, decimals: 6, delta: -1n }] });
    expect(rules(tokens)).toContainEqual(['unexplained-outflow', 'danger']);
  });

  it('treats unknown balance changes as a possible outflow', () => {
    const out = input([ix({ programId: OTHER })], {
      balanceChanges: null,
      issues: [{ stage: 'simulate', message: 'Simulation failed: custom error 1' }],
    });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
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
    const unverified = { kind: 'pda' as const, from: OTHER, to: OTHER, label: 'PDA', status: 'unverified' as const };
    expect(rules(input([toMe, toMyAta, assignOther], { relations: [unverified] }))).toEqual([]);
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
      expect(rules(input([core], { balanceChanges }))).toEqual([]);
    });

    it('flags an all-curated sweep of SOL and USDC to a wallet', () => {
      const transferSol = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const transfer = ix({ index: 1, name: 'transfer', idl: curated });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(OTHER, 'SOL', 2n * SOL), change(ME, USDC, -100n), change(OTHER, USDC, 100n)];
      expect(rules(input([transferSol, transfer], { balanceChanges }))).toEqual([['sweep', 'danger']]);
    });

    it('does not flag a swap (you receive something back)', () => {
      const swap = ix({ programId: JUP, name: 'route', idl: authority });
      const balanceChanges = [change(ME, 'SOL', -2n * SOL), change(ME, USDC, 300n), change(OTHER, 'SOL', 2n * SOL)];
      expect(rules(input([swap], { balanceChanges }))).toEqual([['self-described-outflow', 'warn']]);
    });

    it('does not flag a single-asset deposit into a program vault, unless it empties the holding', async () => {
      const [vault] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const deposit = ix({ programId: DRAINER, name: 'deposit', idl: curated });
      const deposited = (delta: bigint) => [change(ME, USDC, -delta), change(vault, USDC, delta)];
      const tokenBalances = { [OTHER]: { owner: ME, mint: USDC, amount: 100n } };
      expect(rules(input([deposit], { balanceChanges: deposited(50n), tokenBalances }))).toEqual([]);
      expect(rules(input([deposit], { balanceChanges: deposited(96n), tokenBalances }))).toEqual([['sweep', 'danger']]);
      expect(rules(input([deposit], { balanceChanges: deposited(96n) }))).toEqual([]);
      const solDeposit = [change(ME, 'SOL', -SOL), change(vault, 'SOL', SOL)];
      expect(rules(input([deposit], { balanceChanges: solDeposit, solBalances: { [ME]: 2n * SOL } }))).toEqual([]);
      expect(rules(input([deposit], { balanceChanges: solDeposit, solBalances: { [ME]: SOL + 1n } }))).toEqual([['sweep', 'danger']]);
    });

    it('does not flag sending one asset to an address-book contact, or a small tip alongside a deposit', async () => {
      const send = ix({ programId: address(SYSTEM_PROGRAM), name: 'transferSol', idl: curated });
      const sent = [change(ME, 'SOL', -SOL), change(OTHER, 'SOL', SOL)];
      expect(rules(input([send], { balanceChanges: sent }))).toEqual([['sweep', 'danger']]);
      expect(rules(input([send], { balanceChanges: sent, addressBook: new Set([OTHER]) }))).toEqual([]);
      const [vault] = await getProgramDerivedAddress({ programAddress: DRAINER, seeds: ['vault'] });
      const deposit = ix({ programId: DRAINER, name: 'deposit', idl: curated });
      const tipped = [change(ME, USDC, -10n), change(vault, USDC, 10n), change(ME, 'SOL', -100_000n), change(OTHER, 'SOL', 100_000n)];
      expect(rules(input([deposit], { balanceChanges: tipped }))).toEqual([]);
    });
  });
});
