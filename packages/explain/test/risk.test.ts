import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  evaluateRisks,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  U64_MAX,
  type ExplainedInstruction,
  type RiskInput,
  type StateChange,
} from '../src';
import { ME, OTHER } from './helpers';

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
    const out = input([unknown], { balanceChanges: [{ owner: ME, mint: 'SOL', decimals: 9, delta: -1n }] });
    expect(rules(out)).toContainEqual(['unexplained-outflow', 'danger']);
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
});
