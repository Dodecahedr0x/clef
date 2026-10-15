import type { Address } from '@solana/kit';
import { PLUMBING_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAMS, U64_MAX } from './registry';
import type { StateChange } from './state-changes';
import type { ExplainedTransaction, NamedAccount, Warning } from './types';

export type RiskInput = Pick<ExplainedTransaction, 'instructions' | 'relations' | 'balanceChanges' | 'issues' | 'me'> & {
  /** Authority changes seen in pre/post account state (simulation), however they were made. */
  stateChanges?: StateChange[];
};

const isToken = (p: string) => TOKEN_PROGRAMS.has(p);
/** Undefined when the account is absent, or its name is unknown because the IDL's names were ambiguous. */
const account = (ix: RiskInput['instructions'][number], name: string) => ix.accounts.find((a) => a.name === name);
const RANK = { info: 0, warn: 1, danger: 2 } as const;
const HALF_U64 = 1n << 63n;

export function evaluateRisks(input: RiskInput): Warning[] {
  const me = new Set<string>(input.me);
  const warnings: Warning[] = [];
  /** `rule:account` -> the warning already raised about that account, so state rules don't repeat it. */
  const byAccount = new Map<string, Warning>();
  const warn = (rule: string, severity: Warning['severity'], message: string, instructionIndex?: number, about?: Address) => {
    const key = about && `${rule}:${about}`;
    const existing = key ? byAccount.get(key) : undefined;
    if (existing) {
      if (RANK[severity] > RANK[existing.severity]) Object.assign(existing, { severity, message });
      return;
    }
    const w: Warning = { rule, severity, message, ...(instructionIndex !== undefined && { instructionIndex }) };
    warnings.push(w);
    if (key) byAccount.set(key, w);
  };
  // An account the rule needs but can't find is treated as yours (for "your account" rules) or as not yours
  // (for "someone else's" rules): ambiguous names must never silence a danger.
  const mineOrUnknown = (a: NamedAccount | undefined) => !a || a.mine || me.has(a.address);
  const notMineOrUnknown = (a: NamedAccount | undefined) => !a || (!a.mine && !me.has(a.address));

  for (const ix of input.instructions) {
    const i = ix.index;
    if (!ix.name) {
      if (!PLUMBING_PROGRAMS.has(ix.programId)) {
        warn('unknown-program', 'warn', `Clef can't decode instruction #${i + 1} (program ${ix.programId}).`, i);
      }
      continue;
    }
    if (isToken(ix.programId) && (ix.name === 'approve' || ix.name === 'approveChecked')) {
      const unlimited = ix.args?.amount === U64_MAX;
      warn('delegation', unlimited ? 'danger' : 'warn', unlimited ? 'Grants UNLIMITED spending of a token account to a delegate.' : 'Lets a delegate spend tokens from your account.', i, account(ix, 'source')?.address);
    }
    if (isToken(ix.programId) && ix.name === 'setAuthority') {
      warn('authority-change', 'danger', 'Changes the authority of a token account or mint.', i, account(ix, 'owned')?.address);
    }
    if (ix.programId === SYSTEM_PROGRAM && (ix.name === 'assign' || ix.name === 'assignWithSeed')) {
      // assignWithSeed reassigns an account derived from (and controlled by) `baseAccount`.
      const target = account(ix, 'account');
      const yours = mineOrUnknown(target) || (ix.name === 'assignWithSeed' && mineOrUnknown(account(ix, 'baseAccount')));
      if (yours) warn('authority-change', 'danger', 'Reassigns ownership of your account to another program.', i, target?.address);
    }
    if (isToken(ix.programId) && ix.name === 'closeAccount' && notMineOrUnknown(account(ix, 'destination'))) {
      warn('close-to-third-party', 'danger', 'Closes an account and sends its rent to an address you do not own.', i);
    }
    if (ix.programId === SYSTEM_PROGRAM && ix.name === 'advanceNonceAccount' && i === 0) {
      warn('durable-nonce', 'warn', 'Uses a durable nonce: this signature never expires and can be submitted later.', i);
    }
  }

  for (const c of input.stateChanges ?? []) {
    const yours = me.has(c.address) || (c.kind !== 'program-owner' && c.holder !== undefined && me.has(c.holder));
    if (!yours || (c.after !== null && me.has(c.after))) continue;
    if (c.kind === 'program-owner') {
      warn('authority-change', 'danger', 'Reassigns ownership of your account to another program.', undefined, c.address);
    } else if (c.kind === 'token-owner') {
      warn('authority-change', 'danger', 'Hands one of your token accounts to another owner.', undefined, c.address);
    } else if (c.kind === 'token-close-authority') {
      warn('authority-change', 'danger', 'Lets someone else close one of your token accounts.', undefined, c.address);
    } else {
      const amount = c.amount ?? 0n;
      const all = amount >= HALF_U64 || (c.balance !== undefined && amount >= c.balance);
      warn('delegation', all ? 'danger' : 'warn', all ? 'Lets a delegate spend ALL tokens in one of your token accounts.' : 'Lets a delegate spend tokens from your account.', undefined, c.address);
    }
  }

  for (const r of input.relations) {
    if (r.status === 'mismatch') {
      warn('relation-mismatch', 'danger', `Account ${r.from} does not match its expected ${r.label}${r.detail ? ` (${r.detail})` : ''}.`, r.instructionIndex);
    }
  }

  if (input.issues.some((i) => i.stage === 'simulate')) {
    warn('simulation-failed', 'warn', 'Simulation failed: balance changes are unknown.');
  }

  const unexplained = input.instructions.some((ix) => !ix.name && !PLUMBING_PROGRAMS.has(ix.programId));
  const outflow = (input.balanceChanges ?? []).some((c) => me.has(c.owner as Address) && c.delta < 0n);
  if (unexplained && outflow) {
    warn('unexplained-outflow', 'danger', 'Funds leave your wallet in a transaction Clef cannot fully explain.');
  }
  return warnings;
}
