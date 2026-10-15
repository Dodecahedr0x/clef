import { formatUnits, programDisplay } from './format';
import { toHex } from './hex';
import { shortAddress } from './labels';
import type { StateChange } from './state-changes';
import { COMPUTE_BUDGET_PROGRAM, PLUMBING_PROGRAMS, TOKEN_PROGRAMS } from './registry';
import type { BalanceChange, DetailLevel, ExplainedInstruction, ExplainedTransaction, Issue, RelationEdge, Warning } from './types';

export type ChangeView = { owner: string; asset: string; amount: string };
export type AccountView = { name: string; address: string; label?: string; badges: string[] };
export type InstructionView = { index: number; program: string; name: string; trust?: string; args: Record<string, string>; accounts: AccountView[] };
export type ExpertAccountView = AccountView & { signer: boolean; writable: boolean; lookupTable?: string };
export type ExpertInstructionView = Omit<InstructionView, 'accounts'> & {
  programId: string;
  idl?: { source: string; trust: string; hash: string };
  dataHex: string;
  accounts: ExpertAccountView[];
};

/** `balanceChanges` is null when they are unknown (no meta, failed simulation): never shown as "nothing moves". */
export type BasicView = {
  level: 'basic';
  summary: string;
  balanceChanges: ChangeView[] | null;
  warnings: Warning[];
  /** Only when the `high-fee` warning fires. */
  fee?: string;
};
export type IntermediateView = Omit<BasicView, 'level'> & { level: 'intermediate'; instructions: InstructionView[] };
/** A `StateChange` with every value as a string. */
export type StateChangeView = { address: string; kind: string; before: string | null; after: string | null; amount?: string; holder?: string; balance?: string };

export type ExpertView = Omit<BasicView, 'level' | 'fee'> & {
  level: 'expert';
  /** Null when it can't be estimated. */
  fee: string | null;
  instructions: ExpertInstructionView[];
  version: string;
  feePayer: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: string;
  relations: RelationEdge[];
  issues: Issue[];
  /** Null when unknown (no successful simulation). */
  stateChanges: StateChangeView[] | null;
};

const SYMBOLS: Record<RelationEdge['status'], string> = { verified: '\u2713', mismatch: '\u2717', unverified: '?' };

function formatValue(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return toHex(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? toHex(x) : x)) ?? String(v);
}

/** Formats `ix.args` (already sanitized at decode time). Token amounts without a known unit show as raw units. */
function formatArgs(ix: ExplainedInstruction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(ix.args ?? {})) {
    if (key === 'discriminator') continue;
    if (key === 'amount' && typeof value === 'bigint' && ix.amountUnit) {
      out[key] = `${formatUnits(value, ix.amountUnit.decimals)} ${ix.amountUnit.symbol}`;
    } else if (key === 'amount' && typeof value === 'bigint' && TOKEN_PROGRAMS.has(ix.programId)) {
      out[key] = formatUnits(value, null);
    } else {
      out[key] = formatValue(value);
    }
  }
  return out;
}

function badges(ex: ExplainedTransaction, ix: ExplainedInstruction, address: string): string[] {
  return ex.relations
    .filter((r) => r.from === address && (r.instructionIndex === undefined || r.instructionIndex === ix.index))
    .filter((r) => r.kind !== 'token-mint')
    .map((r) => `${r.kind === 'token-owner' ? 'owner' : r.kind === 'ata' ? 'ATA' : r.label} ${SYMBOLS[r.status]}`);
}

function accountViews(ex: ExplainedTransaction, ix: ExplainedInstruction): AccountView[] {
  return ix.accounts.map((a, i) => ({
    name: a.name ?? `#${i}`,
    address: a.address,
    ...(a.label !== undefined && { label: a.label }),
    badges: badges(ex, ix, a.address),
  }));
}

/** Built field by field: nothing else on the instruction (e.g. verification-only data) can reach a view. */
function instructionView(ex: ExplainedTransaction, ix: ExplainedInstruction): InstructionView {
  return {
    index: ix.index,
    program: programDisplay(ix),
    name: ix.name ?? 'Unknown instruction',
    ...(ix.idl && { trust: ix.idl.trust }),
    args: formatArgs(ix),
    accounts: accountViews(ex, ix),
  };
}

function changeView(c: BalanceChange): ChangeView {
  const amount = formatUnits(c.delta, c.decimals);
  return { owner: c.owner, asset: c.symbol ?? shortAddress(c.mint), amount: c.delta > 0n ? `+${amount}` : amount };
}

function stateChangeView(c: StateChange): StateChangeView {
  return {
    address: c.address,
    kind: c.kind,
    before: c.before,
    after: c.after,
    ...(c.amount !== undefined && { amount: c.amount.toString() }),
    ...(c.holder !== undefined && { holder: c.holder }),
    ...(c.balance !== undefined && { balance: c.balance.toString() }),
  };
}

const toNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined);
const toBigint = (v: unknown) => (typeof v === 'bigint' ? v : typeof v === 'number' ? BigInt(v) : undefined);

export function viewFor(ex: ExplainedTransaction, level: 'basic'): BasicView;
export function viewFor(ex: ExplainedTransaction, level: 'intermediate'): IntermediateView;
export function viewFor(ex: ExplainedTransaction, level: 'expert'): ExpertView;
export function viewFor(ex: ExplainedTransaction, level: DetailLevel): BasicView | IntermediateView | ExpertView;
export function viewFor(ex: ExplainedTransaction, level: DetailLevel): BasicView | IntermediateView | ExpertView {
  const me = new Set<string>(ex.me);
  const changes = ex.balanceChanges;
  // Views get their own copies: editing a view never changes the explanation.
  const common = {
    summary: ex.summary,
    warnings: ex.warnings.map((w) => ({ ...w })),
    balanceChanges: changes && (level === 'expert' ? changes : changes.filter((c) => me.has(c.owner))).map(changeView),
  };
  const fee = ex.fee === null ? null : `${formatUnits(ex.fee, 9)} SOL`;
  const highFee = fee !== null && ex.warnings.some((w) => w.rule === 'high-fee') ? { fee } : {};
  if (level === 'basic') return { level, ...common, ...highFee };
  if (level === 'intermediate') {
    return { level, ...common, ...highFee, instructions: ex.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId)).map((ix) => instructionView(ex, ix)) };
  }

  // Compute budget values only from the curated IDL, as the fee estimate does.
  const budget = (name: string) =>
    ex.instructions.find((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM && ix.name === name && ix.idl?.trust === 'curated')?.args;
  const limit = toNumber(budget('setComputeUnitLimit')?.units);
  const price = toBigint(budget('setComputeUnitPrice')?.microLamports);
  return {
    level,
    ...common,
    version: String(ex.tx.version),
    feePayer: ex.tx.feePayer,
    fee,
    recentBlockhash: ex.tx.recentBlockhash,
    ...(limit !== undefined && { computeUnitLimit: limit }),
    ...(price !== undefined && { computeUnitPrice: price.toString() }),
    relations: ex.relations.map((r) => ({ ...r, ...(r.seeds && { seeds: r.seeds.map((seed) => ({ ...seed })) }) })),
    issues: ex.issues.map((i) => ({ ...i })),
    stateChanges: ex.stateChanges && ex.stateChanges.map(stateChangeView),
    instructions: ex.instructions.map((ix) => ({
      ...instructionView(ex, ix),
      programId: ix.programId,
      ...(ix.idl && { idl: { source: ix.idl.source, trust: ix.idl.trust, hash: ix.idl.hash } }),
      dataHex: toHex(ix.data),
      accounts: accountViews(ex, ix).map((a, i) => {
        const ref = ix.accounts[i]!;
        return { ...a, signer: ref.signer, writable: ref.writable, ...(ref.lookupTable && { lookupTable: ref.lookupTable }) };
      }),
    })),
  };
}
