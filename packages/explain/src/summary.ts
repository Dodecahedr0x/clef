import { formatUnits, programDisplay } from './format';
import { shortAddress } from './labels';
import { authorityArg, feeAllowance, HALF_U64, stakeRole } from './risk';
import { CLOCK_SYSVAR, NATIVE_MINTS, PLUMBING_PROGRAMS, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAMS } from './registry';
import type { BalanceChange, ExplainedInstruction, ExplainedTransaction } from './types';

export type SummaryInput = Pick<ExplainedTransaction, 'instructions' | 'balanceChanges' | 'me'> &
  Partial<Pick<ExplainedTransaction, 'warnings'>> & {
    /** The network fee and who pays it: it is not a "send", so it is taken out of the payer's SOL change. */
    fee?: bigint;
    /** The signature part of `fee`. Only `feeAllowance(fee, baseFee)` is taken out: an absurd fee stays visible. */
    baseFee?: bigint;
    feePayer?: string;
    /** Trusted display labels by address (see `Labeler`). */
    labels?: Readonly<Record<string, string>>;
    /** Owner wallet of each token account (pre-state, else post-state), keyed by token account. */
    tokenOwners?: Readonly<Record<string, string>>;
    /** Pre-transaction token balances, keyed by token account (see `RiskInput.tokenBalances`). */
    tokenBalances?: Readonly<Record<string, { amount: bigint; mint?: string }>>;
    /** Pre-transaction lamports by account (see `RiskInput.accountLamports`). */
    accountLamports?: Readonly<Record<string, bigint>>;
  };

/** Warnings under which a one-instruction template would mislead: the summary states the balance changes instead. */
const NO_TEMPLATE_RULES: ReadonlySet<string> = new Set(['sweep', 'unexplained-outflow', 'transaction-failed']);

type Context = Pick<SummaryInput, 'labels' | 'tokenOwners' | 'tokenBalances' | 'accountLamports'>;
type Template = (ix: ExplainedInstruction, ctx: Context) => string | null;
type Account = ExplainedInstruction['accounts'][number];

const named = (address: string, ctx: Context) => ctx.labels?.[address] ?? shortAddress(address);
const who = (a: Account) => a.label ?? shortAddress(a.address);
/** A token account is shown as its owner wallet when the owner is known. */
const holder = (a: Account, ctx: Context) => {
  const owner = ctx.tokenOwners?.[a.address];
  return owner ? named(owner, ctx) : who(a);
};

/** "Send X to D" from your account, "Transfer X from S to D" otherwise. Null if either end is unknown. */
function move(ix: ExplainedInstruction, amount: string, to: (a: Account) => string): string | null {
  const from = ix.accounts.find((a) => a.name === 'source');
  const dest = ix.accounts.find((a) => a.name === 'destination');
  if (!from || !dest) return null;
  return from.mine ? `Send ${amount} to ${to(dest)}` : `Transfer ${amount} from ${who(from)} to ${to(dest)}`;
}

const sendSol: Template = (ix) =>
  typeof ix.args?.amount === 'bigint' ? move(ix, `${formatUnits(ix.args.amount, 9)} SOL`, who) : null;

/** Needs the amount's unit: with unknown decimals the summary falls back to the balance changes. */
const sendToken: Template = (ix, ctx) =>
  typeof ix.args?.amount === 'bigint' && ix.amountUnit
    ? move(ix, `${formatUnits(ix.args.amount, ix.amountUnit.decimals)} ${ix.amountUnit.symbol}`, (a) => holder(a, ctx))
    : null;

const amountOf = (ix: ExplainedInstruction, value: bigint, fallbackSymbol: string) =>
  ix.amountUnit ? `${formatUnits(value, ix.amountUnit.decimals)} ${ix.amountUnit.symbol}` : `${formatUnits(value, null)} ${fallbackSymbol}`;

const approve: Template = (ix, ctx) => {
  const amount = ix.args?.amount;
  const source = ix.accounts.find((a) => a.name === 'source');
  const delegate = ix.accounts.find((a) => a.name === 'delegate');
  if (typeof amount !== 'bigint' || !source || !delegate) return null;
  const symbol = ix.amountUnit?.symbol ?? 'tokens';
  const held = ctx.tokenBalances?.[source.address]?.amount;
  const what =
    amount >= HALF_U64
      ? `UNLIMITED ${symbol}`
      : held !== undefined && amount >= held
        ? `${source.mine ? 'your' : 'the'} entire ${symbol}`
        : amountOf(ix, amount, 'tokens');
  return `Let ${who(delegate)} spend ${what} from ${who(source)}`;
};

const revoke: Template = (ix) => {
  const source = ix.accounts.find((a) => a.name === 'source');
  return source ? `Revoke the delegate of ${who(source)}` : null;
};

/** Token-2022's `AuthorityType` variants; legacy Token uses the first four. */
const AUTHORITY_TYPES = [
  'mint tokens', 'freeze account', 'account owner', 'close account', 'transfer fee config', 'withheld withdraw', 'close mint',
  'interest rate', 'permanent delegate', 'confidential transfer mint', 'transfer hook program id',
  'confidential transfer fee config', 'metadata pointer', 'group pointer', 'group member pointer', 'scaled UI amount', 'pause',
  'permissioned burn',
];

const setAuthority: Template = (ix, ctx) => {
  const owned = ix.accounts.find((a) => a.name === 'owned');
  const type = ix.args?.authorityType;
  const next = authorityArg(ix.args?.newAuthority);
  // Decoded as `{ __kind: 'CloseAccount', __discriminator: 3 }`.
  const index = type !== null && typeof type === 'object' ? (type as { __discriminator?: unknown }).__discriminator : type;
  const kind = typeof index === 'number' ? AUTHORITY_TYPES[index] : undefined;
  if (!owned || kind === undefined || next === undefined) return null;
  return next === null
    ? `Revoke the ${kind} authority of ${who(owned)}`
    : `Set the ${kind} authority of ${who(owned)} to ${named(next, ctx)}`;
};

const closeAccount: Template = (ix, ctx) => {
  const account = ix.accounts.find((a) => a.name === 'account');
  const destination = ix.accounts.find((a) => a.name === 'destination');
  if (!account || !destination) return null;
  // Wrapped SOL: all of the account's lamports go, not just rent.
  const held = ctx.tokenBalances?.[account.address];
  const lamports = ctx.accountLamports?.[account.address];
  if (held?.mint !== undefined && NATIVE_MINTS.has(held.mint)) {
    if (lamports === undefined) return null;
    return `Close ${who(account)} and send its ${formatUnits(lamports, 9)} SOL (${formatUnits(held.amount, 9)} wrapped) to ${who(destination)}`;
  }
  return `Close ${who(account)} and send its rent to ${who(destination)}`;
};

/**
 * Stake accounts are read by position (as the stake rules do): in the legacy layout names are omitted.
 * authorizeChecked: legacy [stake, clock, old, new], modern [stake, old, new].
 */
const stakeAuthorize: Template = (ix, ctx) => {
  const at = (n: number) => ix.accounts[n]?.address;
  const stake = at(0);
  const next = ix.name === 'authorize' ? ix.args?.arg0 : at(1) === CLOCK_SYSVAR ? at(3) : at(2);
  const role = stakeRole(ix.name === 'authorize' ? ix.args?.arg1 : ix.args?.stakeAuthorize);
  if (!stake || typeof next !== 'string') return null;
  return `Make ${named(next, ctx)} the ${role ?? 'authority'} of stake account ${named(stake, ctx)}`;
};

const stakeWithdraw: Template = (ix, ctx) => {
  const [stake, recipient] = [ix.accounts[0]?.address, ix.accounts[1]?.address];
  const lamports = ix.args?.args;
  if (!stake || !recipient || typeof lamports !== 'bigint') return null;
  return `Withdraw ${formatUnits(lamports, 9)} SOL from stake account ${named(stake, ctx)} to ${named(recipient, ctx)}`;
};

const delegateStake: Template = (ix, ctx) => {
  const [stake, vote] = [ix.accounts[0]?.address, ix.accounts[1]?.address];
  return stake && vote ? `Delegate stake account ${named(stake, ctx)} to vote account ${named(vote, ctx)}` : null;
};

/**
 * Keyed by program id and instruction name; only applied to names decoded with a curated IDL. `expresses`:
 * the warning rules (about this instruction) that the template's text already states.
 */
const TEMPLATES: Readonly<Record<string, { render: Template; expresses?: readonly string[] }>> = {
  [`${SYSTEM_PROGRAM}:transferSol`]: { render: sendSol },
  [`${STAKE_PROGRAM}:authorize`]: { render: stakeAuthorize, expresses: ['authority-change', 'stake-delegation-authority'] },
  [`${STAKE_PROGRAM}:authorizeChecked`]: { render: stakeAuthorize, expresses: ['authority-change', 'stake-delegation-authority'] },
  [`${STAKE_PROGRAM}:withdraw`]: { render: stakeWithdraw, expresses: ['stake-withdraw'] },
  [`${STAKE_PROGRAM}:delegateStake`]: { render: delegateStake },
};
for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
  Object.assign(TEMPLATES, {
    [`${program}:transfer`]: { render: sendToken },
    [`${program}:transferChecked`]: { render: sendToken },
    [`${program}:approve`]: { render: approve, expresses: ['delegation'] },
    [`${program}:approveChecked`]: { render: approve, expresses: ['delegation'] },
    [`${program}:revoke`]: { render: revoke },
    [`${program}:setAuthority`]: { render: setAuthority, expresses: ['authority-change'] },
    [`${program}:closeAccount`]: { render: closeAccount, expresses: ['close-to-third-party'] },
  });
}

function template(ix: ExplainedInstruction, ctx: Context): { text: string; expresses: readonly string[] } | null {
  if (!ix.name || ix.idl?.trust !== 'curated') return null;
  const key = `${ix.programId}:${ix.name}`;
  const t = Object.hasOwn(TEMPLATES, key) ? TEMPLATES[key] : undefined;
  const text = t?.render(ix, ctx);
  return t && text ? { text, expresses: t.expresses ?? [] } : null;
}

/** A warning message as a summary suffix: lowercase start, no final period, bounded. */
function shorten(message: string): string {
  const trimmed = message.replace(/\.$/, '');
  // Lowercase a sentence start, but not a name ("Clef ...").
  const lowered = /^[A-Z][a-z]/.test(trimmed) && !/^Clef\b/.test(trimmed) ? `${trimmed[0]!.toLowerCase()}${trimmed.slice(1)}` : trimmed;
  const chars = Array.from(lowered);
  return chars.length > 100 ? `${chars.slice(0, 99).join('')}\u2026` : lowered;
}

/** The payer's SOL change without the fee; a loss smaller than the fee never turns into a gain. */
function withoutFee(c: BalanceChange, fee: bigint): BalanceChange {
  const delta = c.delta + fee;
  return { ...c, delta: c.delta < 0n && delta > 0n ? 0n : delta };
}

const asset = (c: BalanceChange) => `${formatUnits(c.delta < 0n ? -c.delta : c.delta, c.decimals)} ${c.symbol ?? shortAddress(c.mint)}`;

/**
 * One line describing the transaction. Never contradicts the warnings: no template under `NO_TEMPLATE_RULES`, and
 * the first danger the text doesn't already state is appended after " -- ".
 */
export function summarize(input: SummaryInput): string {
  const meaningful = input.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId));
  const flagged = (input.warnings ?? []).some((w) => NO_TEMPLATE_RULES.has(w.rule));
  const lone = meaningful.length === 1 ? meaningful[0]! : undefined;
  const t = lone && !flagged ? template(lone, input) : null;
  const text = t?.text ?? describe(input, meaningful);
  const warnings = input.warnings ?? [];
  // The first danger the text doesn't state; else a high fee, which is never part of any text.
  const shown =
    warnings.find((w) => w.severity === 'danger' && !(t?.expresses.includes(w.rule) && w.instructionIndex === lone?.index)) ??
    warnings.find((w) => w.rule === 'high-fee');
  return shown ? `${text} -- ${shorten(shown.message)}` : text;
}

/** From balance changes (yours, without the expected fee) and the programs involved. */
function describe(input: SummaryInput, meaningful: readonly ExplainedInstruction[]): string {

  const me = new Set<string>(input.me);
  // A high fee is stated as a fee (see `summarize`), so all of it comes out; otherwise only the allowed part.
  const highFee = (input.warnings ?? []).some((w) => w.rule === 'high-fee');
  const fee = input.fee === undefined ? 0n : highFee ? input.fee : feeAllowance(input.fee, input.baseFee);
  const mine = (input.balanceChanges ?? [])
    .map((c) => (c.mint === 'SOL' && c.owner === input.feePayer && input.fee ? withoutFee(c, fee) : c))
    .filter((c) => me.has(c.owner) && c.delta !== 0n);
  const outflows = mine.filter((c) => c.delta < 0n);
  const sent = outflows.map(asset);
  // Everyone else who gains what you lose: named when it is a single owner.
  const recipients = new Set(
    (input.balanceChanges ?? [])
      .filter((c) => c.delta > 0n && !me.has(c.owner) && outflows.some((o) => o.mint === c.mint))
      .map((c) => c.owner),
  );
  // ...and only when that owner gets at least half of each asset you send (not, say, a tip next to a huge fee).
  const [only] = recipients;
  const gain = (mint: string) => (input.balanceChanges ?? []).filter((c) => c.owner === only && c.mint === mint).reduce((t, c) => t + c.delta, 0n);
  const to = recipients.size === 1 && outflows.every((o) => gain(o.mint) * 2n >= -o.delta) ? ` to ${named(only!, input)}` : '';
  const received = mine.filter((c) => c.delta > 0n).map(asset);

  const programs = [
    ...new Set(meaningful.filter((ix) => !TOKEN_PROGRAMS.has(ix.programId) && ix.programId !== SYSTEM_PROGRAM).map(programDisplay)),
  ];
  const via = programs.length ? ` via ${programs.join(', ')}` : '';

  const text = [sent.length && `send ${sent.join(', ')}${to}`, received.length && `receive ${received.join(', ')}`]
    .filter(Boolean)
    .join(', ');
  if (text) return `${text[0]!.toUpperCase()}${text.slice(1)}${via}`;
  const unknown = input.balanceChanges === null ? ' (balance changes unknown)' : '';
  return `Interact with ${[...new Set(meaningful.map(programDisplay))].join(', ') || 'no programs'}${unknown}`;
}
