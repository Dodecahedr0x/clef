import { isOffCurveAddress, type Address } from '@solana/kit';
import { shortAddress } from './labels';
import { KNOWN_MINTS, KNOWN_PROGRAMS, PLUMBING_PROGRAMS, SENSITIVE_PROGRAMS, SYSTEM_PROGRAM, TOKEN_PROGRAMS, TRUSTED_PROGRAMS } from './registry';
import type { StateChange } from './state-changes';
import type { BalanceChange, ExplainedTransaction, NamedAccount, Warning } from './types';

export type RiskInput = Pick<ExplainedTransaction, 'instructions' | 'relations' | 'balanceChanges' | 'issues' | 'me'> & {
  /** Authority changes seen in pre/post account state (simulation), however they were made. */
  stateChanges?: StateChange[];
  /** Expected network fee in lamports (see `estimateFee`), paid by `feePayer`. */
  fee?: bigint;
  feePayer?: Address;
  /** Pre-transaction state of token accounts the transaction touches, keyed by token account address. */
  tokenBalances?: Readonly<Record<string, TokenHolding>>;
  /** Pre-transaction lamports of the user's wallets, keyed by address. */
  solBalances?: Readonly<Record<string, bigint>>;
  /** Addresses in the user's address book: sending to them is not a sweep. */
  addressBook?: ReadonlySet<string>;
  /** Mints the user values (e.g. priced ones) besides `KNOWN_MINTS`: receiving them counts as an inflow. */
  valuedMints?: ReadonlySet<string>;
};

export type TokenHolding = { owner: Address; mint: Address; amount: bigint };

/**
 * SOL losses up to this much (0.01 SOL) are not treated as an outflow: they cover the rent of a few new
 * accounts (an ATA costs ~0.002 SOL) that ordinary transactions create, and that rent stays recoverable.
 */
export const RENT_SLACK = 10_000_000n;

/** Base fee (5000 lamports per signature) plus priority fee: ceil(cuLimit * microLamportsPerCu / 1e6). */
export function estimateFee(numSignatures: number, cuLimit?: number, microLamportsPerCu?: bigint): bigint {
  const priority = cuLimit === undefined || microLamportsPerCu === undefined ? 0n : BigInt(cuLimit) * microLamportsPerCu;
  return 5000n * BigInt(numSignatures) + (priority + 999_999n) / 1_000_000n;
}

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

  const unknownPrograms = new Set<string>();
  let nonce: { warning: Warning; foreignAuthority: boolean } | undefined;

  for (const ix of input.instructions) {
    const i = ix.index;
    if (!ix.name) {
      if (SENSITIVE_PROGRAMS.has(ix.programId)) {
        warn('sensitive-program', 'danger', `Instruction #${i + 1} changes stake, vote or program accounts; Clef can't decode it.`, i);
      } else if (!PLUMBING_PROGRAMS.has(ix.programId) && !unknownPrograms.has(ix.programId)) {
        unknownPrograms.add(ix.programId);
        warn('unknown-program', 'warn', `Clef can't decode instruction #${i + 1} (program ${ix.programId}).`, i);
      }
      continue;
    }
    if (isToken(ix.programId) && (ix.name === 'approve' || ix.name === 'approveChecked')) {
      const source = account(ix, 'source');
      const held = source && input.tokenBalances?.[source.address];
      const amount = ix.args?.amount;
      const unlimited = typeof amount !== 'bigint' || amount >= HALF_U64;
      const all = unlimited || (held !== undefined && amount >= held.amount);
      const danger = all && notMineOrUnknown(account(ix, 'delegate'));
      const whose = source && (source.mine || me.has(source.address) || (held && me.has(held.owner))) ? 'your' : 'a';
      const what = unlimited ? 'an UNLIMITED amount of' : all ? 'ALL' : 'some';
      warn('delegation', danger ? 'danger' : 'warn', `Lets a delegate spend ${what} of the tokens in ${whose} token account.`, i, source?.address);
    }
    if (isToken(ix.programId) && ix.name === 'setAuthority') {
      const next = authorityArg(ix.args?.newAuthority);
      const owned = account(ix, 'owned')?.address;
      if (next === null) warn('authority-change', 'warn', 'Revokes an authority of a token account or mint.', i, owned);
      else if (next !== undefined && me.has(next)) {
        warn('authority-change', 'warn', 'Changes an authority of a token account or mint to your wallet.', i, owned);
      } else warn('authority-change', 'danger', 'Hands an authority of a token account or mint to someone else.', i, owned);
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
    if (ix.programId === SYSTEM_PROGRAM && ix.name === 'authorizeNonceAccount') {
      const next = ix.args?.newNonceAuthority;
      if (typeof next !== 'string' || !me.has(next)) {
        warn('authority-change', 'danger', 'Hands control of a durable nonce account to someone else.', i);
      }
    }
    if (ix.programId === SYSTEM_PROGRAM && ix.name === 'advanceNonceAccount' && i === 0) {
      warn('durable-nonce', 'warn', 'Uses a durable nonce: this signature never expires and can be submitted later. Balance changes reflect current state only.', i);
      nonce = { warning: warnings[warnings.length - 1]!, foreignAuthority: notMineOrUnknown(account(ix, 'nonceAuthority')) };
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
      const what = amount >= HALF_U64 ? 'an UNLIMITED amount of' : all ? 'ALL' : 'some';
      warn('delegation', all ? 'danger' : 'warn', `Lets a delegate spend ${what} of the tokens in your token account.`, undefined, c.address);
    }
  }

  for (const r of input.relations) {
    if (r.status === 'mismatch') {
      warn('relation-mismatch', 'danger', `Account ${r.from} does not match its expected ${r.label}${r.detail ? ` (${r.detail})` : ''}.`, r.instructionIndex);
    }
  }

  if (input.issues.some((i) => i.stage === 'simulate')) {
    warn('simulation-failed', 'warn', 'Simulation failed or unavailable: balance changes are unknown.');
  }

  const unexplained = input.instructions.some((ix) => !ix.name && !PLUMBING_PROGRAMS.has(ix.programId));
  if (unexplained && possibleOutflow(input, me)) {
    warn('unexplained-outflow', 'danger', 'Funds leave your wallet in a transaction Clef cannot fully explain.');
  }

  if (possibleOutflow(input, me)) {
    const selfDescribed = input.instructions.filter((ix) => ix.idl?.trust === 'authority' && !TRUSTED_PROGRAMS.has(ix.programId));
    for (const programId of new Set(selfDescribed.map((ix) => ix.programId))) {
      const name = KNOWN_PROGRAMS[programId] ?? shortAddress(programId);
      warn('self-described-outflow', 'warn', `${name} describes itself with its own IDL; Clef can't independently verify what it does with your funds.`);
    }
  }

  for (const [rule, severity, message] of sweepWarnings(input, me)) warn(rule, severity, message);

  // A signature that never expires can be replayed once state has changed: anything else wrong becomes worse.
  if (nonce && (nonce.foreignAuthority || warnings.some((w) => w !== nonce!.warning && RANK[w.severity] >= RANK.warn))) {
    nonce.warning.severity = 'danger';
  }
  return warnings;
}

/**
 * A decoded `option<address>` arg: the address, null for None, undefined when the shape is unexpected.
 * Codama decodes options as `{ __option: 'Some', value }` / `{ __option: 'None' }`.
 */
function authorityArg(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'object') return undefined;
  const o = v as { __option?: unknown; value?: unknown };
  if (o.__option === 'None') return null;
  return o.__option === 'Some' && typeof o.value === 'string' ? o.value : undefined;
}

const onCurve = (a: Address) => {
  try {
    return !isOffCurveAddress(a);
  } catch {
    return true;
  }
};

/**
 * Funds go to wallets (on-curve addresses) that are neither yours nor in your address book, and nothing of value
 * comes back: two or more assets (`sweep`, danger), or (almost) a whole holding (`send-entire-balance`, warn).
 * Judged on balance changes alone, so it holds whichever IDLs decoded the transaction. Program-owned
 * destinations (deposits into vaults) and partial single-asset sends are not flagged.
 */
function sweepWarnings(input: RiskInput, me: ReadonlySet<string>): [string, Warning['severity'], string][] {
  const changes = input.balanceChanges;
  if (!changes) return [];
  // Only something of value counts as received: SOL beyond rent refunds, or a known or priced token. An
  // airdrop of an unknown token is free to mint and must not defuse the rule.
  const valued = (mint: string) => mint in KNOWN_MINTS || !!input.valuedMints?.has(mint);
  const received = changes.some(
    (c) => me.has(c.owner) && (c.mint === 'SOL' ? c.delta > RENT_SLACK : c.delta > 0n && valued(c.mint)),
  );
  if (received) return [];

  // Rent-sized SOL amounts (e.g. a validator tip) don't count as landing on a wallet.
  const toWallet = (c: BalanceChange) =>
    (c.mint === 'SOL' ? c.delta > RENT_SLACK : c.delta > 0n) && !me.has(c.owner) && !input.addressBook?.has(c.owner) && onCurve(c.owner);
  const recipient = (mint: string) => changes.find((c) => c.mint === mint && toWallet(c))?.owner;
  const out = outflows(input, me).filter((c) => recipient(c.mint));
  if (new Set(out.map((c) => c.mint)).size >= 2) {
    return [['sweep', 'danger', 'Moves several of your assets to a wallet without giving you anything back.']];
  }

  const emptied = (c: BalanceChange) => {
    let pre: bigint | undefined;
    if (c.mint === 'SOL') pre = input.solBalances?.[c.owner];
    else {
      const held = Object.values(input.tokenBalances ?? {}).filter((h) => h.owner === c.owner && h.mint === c.mint);
      if (held.length) pre = held.reduce((sum, h) => sum + h.amount, 0n);
    }
    return pre !== undefined && (pre + c.delta) * 20n <= pre;
  };
  return out.filter(emptied).map((c) => {
    const asset = c.mint === 'SOL' ? 'SOL' : (c.symbol ?? shortAddress(c.mint));
    return ['send-entire-balance', 'warn', `Sends (almost) your entire ${asset} balance to ${shortAddress(recipient(c.mint)!)}.`];
  });
}

/** Your outflows: any token decrease, or a SOL loss beyond the fee (if you pay it) plus `RENT_SLACK`. */
function outflows(input: RiskInput, me: ReadonlySet<string>): BalanceChange[] {
  const allowance = (owner: string) => (owner === input.feePayer ? (input.fee ?? 0n) : 0n) + RENT_SLACK;
  return (input.balanceChanges ?? []).filter(
    (c) => me.has(c.owner) && (c.mint === 'SOL' ? -c.delta > allowance(c.owner) : c.delta < 0n),
  );
}

/** Unknown balance changes (no meta, no successful simulation) count as a possible outflow. */
const possibleOutflow = (input: RiskInput, me: ReadonlySet<string>) =>
  input.balanceChanges === null || outflows(input, me).length > 0;
