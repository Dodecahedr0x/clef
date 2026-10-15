import { formatUnits, programDisplay } from './format';
import { shortAddress } from './labels';
import { feeAllowance } from './risk';
import { PLUMBING_PROGRAMS, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAMS } from './registry';
import type { BalanceChange, ExplainedInstruction, ExplainedTransaction } from './types';

export type SummaryInput = Pick<ExplainedTransaction, 'instructions' | 'balanceChanges' | 'me'> &
  Partial<Pick<ExplainedTransaction, 'warnings'>> & {
    /** The network fee and who pays it: it is not a "send", so it is taken out of the payer's SOL change. */
    fee?: bigint;
    /** The signature part of `fee`. Only `feeAllowance(fee, baseFee)` is taken out: an absurd fee stays visible. */
    baseFee?: bigint;
    feePayer?: string;
  };

/** Warnings under which a one-instruction template could read as benign: the summary states the outflows. */
const NO_TEMPLATE_RULES: ReadonlySet<string> = new Set(['sweep', 'unexplained-outflow', 'high-fee']);

type Template = (ix: ExplainedInstruction) => string | null;

const who = (a: ExplainedInstruction['accounts'][number]) => a.label ?? shortAddress(a.address);

/** "Send X to D" from your account, "Transfer X from S to D" otherwise. Null if either end is unknown. */
function move(ix: ExplainedInstruction, amount: string, source: string, destination: string): string | null {
  const from = ix.accounts.find((a) => a.name === source);
  const to = ix.accounts.find((a) => a.name === destination);
  if (!from || !to) return null;
  return from.mine ? `Send ${amount} to ${who(to)}` : `Transfer ${amount} from ${who(from)} to ${who(to)}`;
}

const sendSol: Template = (ix) =>
  typeof ix.args?.amount === 'bigint' ? move(ix, `${formatUnits(ix.args.amount, 9)} SOL`, 'source', 'destination') : null;

/** Needs the amount's unit: with unknown decimals the summary falls back to the balance changes. */
const sendToken: Template = (ix) =>
  typeof ix.args?.amount === 'bigint' && ix.amountUnit
    ? move(ix, `${formatUnits(ix.args.amount, ix.amountUnit.decimals)} ${ix.amountUnit.symbol}`, 'source', 'destination')
    : null;

/** Keyed by program id and instruction name; only applied to names decoded with a curated IDL. */
const TEMPLATES: Readonly<Record<string, Template>> = {
  [`${SYSTEM_PROGRAM}:transferSol`]: sendSol,
  [`${TOKEN_PROGRAM}:transfer`]: sendToken,
  [`${TOKEN_PROGRAM}:transferChecked`]: sendToken,
  [`${TOKEN_2022_PROGRAM}:transfer`]: sendToken,
  [`${TOKEN_2022_PROGRAM}:transferChecked`]: sendToken,
};

function template(ix: ExplainedInstruction): string | null {
  if (!ix.name || ix.idl?.trust !== 'curated') return null;
  const t = Object.hasOwn(TEMPLATES, `${ix.programId}:${ix.name}`) ? TEMPLATES[`${ix.programId}:${ix.name}`] : undefined;
  return t?.(ix) ?? null;
}

/** The payer's SOL change without the fee; a loss smaller than the fee never turns into a gain. */
function withoutFee(c: BalanceChange, fee: bigint): BalanceChange {
  const delta = c.delta + fee;
  return { ...c, delta: c.delta < 0n && delta > 0n ? 0n : delta };
}

const asset = (c: BalanceChange) => `${formatUnits(c.delta < 0n ? -c.delta : c.delta, c.decimals)} ${c.symbol ?? shortAddress(c.mint)}`;

/** One line describing the transaction. Never contradicts the warnings: see `NO_TEMPLATE_RULES`. */
export function summarize(input: SummaryInput): string {
  const meaningful = input.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId));
  const flagged = (input.warnings ?? []).some((w) => NO_TEMPLATE_RULES.has(w.rule));
  if (meaningful.length === 1 && !flagged) {
    const text = template(meaningful[0]!);
    if (text) return text;
  }

  const me = new Set<string>(input.me);
  const mine = (input.balanceChanges ?? [])
    .map((c) => (c.mint === 'SOL' && c.owner === input.feePayer && input.fee ? withoutFee(c, feeAllowance(input.fee, input.baseFee)) : c))
    .filter((c) => me.has(c.owner) && c.delta !== 0n);
  const sent = mine.filter((c) => c.delta < 0n).map(asset);
  const received = mine.filter((c) => c.delta > 0n).map(asset);

  const programs = [
    ...new Set(meaningful.filter((ix) => !TOKEN_PROGRAMS.has(ix.programId) && ix.programId !== SYSTEM_PROGRAM).map(programDisplay)),
  ];
  const via = programs.length ? ` via ${programs.join(', ')}` : '';

  const text = [sent.length && `send ${sent.join(', ')}`, received.length && `receive ${received.join(', ')}`]
    .filter(Boolean)
    .join(', ');
  if (text) return `${text[0]!.toUpperCase()}${text.slice(1)}${via}`;
  const unknown = input.balanceChanges === null ? ' (balance changes unknown)' : '';
  return `Interact with ${[...new Set(meaningful.map(programDisplay))].join(', ') || 'no programs'}${unknown}`;
}
