import { isAddress } from '@solana/kit';
import type { BatchStep, ExplainedBatch } from './batch';
import { groupDigits } from './diffs';
import { formatUnits, programDisplay } from './format';
import { toHex } from './hex';
import { shortAddress } from './labels';
import type { StateChange } from './state-changes';
import { COMPUTE_BUDGET_PROGRAM, PLUMBING_PROGRAMS, PROGRAM_NAMES, TOKEN_PROGRAMS } from './registry';
import type { AccountDiff, AccountFact, BalanceChange, DetailLevel, ExplainedInstruction, ExplainedTransaction, Issue, LogKind, LogLine, RelationEdge, Transfer, Warning } from './types';

/** `asset`: a known symbol, else the short mint; `mint` lets the UI add a name and a price it looked up. */
export type ChangeView = { owner: string; mint?: string; asset: string; amount: string };
export type AccountView = { name: string; address: string; label?: string; badges: string[] };
export type InstructionView = {
  index: number;
  program: string;
  name: string;
  trust?: string;
  /** An IDL exists for the program but lists no such instruction: it was published before the program changed. */
  idlOutdated?: true;
  args: Record<string, string>;
  accounts: AccountView[];
};
export type ExpertAccountView = AccountView & { signer: boolean; writable: boolean; lookupTable?: string };
export type ExpertInstructionView = Omit<InstructionView, 'accounts'> & {
  programId: string;
  /** A compute budget instruction in a v1 transaction: the runtime ignores it for configuration (a no-op). */
  noEffect?: true;
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
  /** SOL locked in new accounts, e.g. '0.00203928 SOL'; refundable to whoever closes them. */
  deposits?: { amount: string; count: number };
  /** A plain send: the full address of the one wallet it pays, to show in full under the headline. */
  recipient?: string;
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
  /** Legacy and v0: micro-lamports per compute unit, from a curated compute budget instruction. */
  computeUnitPrice?: string;
  /** v1 only, from the transaction config: the total priority fee in lamports. */
  priorityFeeLamports?: string;
  /** v1 only, from the transaction config (0 when not set). */
  loadedAccountsDataSizeLimit?: number;
  /** v1 only: limits the config leaves unset, which the runtime takes as 0 (shown as 0). */
  notSet?: ('computeUnitLimit' | 'loadedAccountsDataSizeLimit')[];
  /** v1 only, from the transaction config. */
  heapSize?: number;
  relations: RelationEdge[];
  issues: Issue[];
  /** Null when unknown (no successful simulation). */
  stateChanges: StateChangeView[] | null;
  accountDiffs: AccountDiffView[] | null;
  logs: LogLineView[] | null;
  /** e.g. '16,101 CU'. */
  computeUnits: string | null;
  externalRelations: RelationEdge[];
  /** Every account of the transaction. */
  accountFacts: AccountFactView[];
  /** Null when unknown (no meta, no successful simulation, or the transaction failed). */
  transfers: TransferView[] | null;
  /** Only what the instructions move themselves: the RPC didn't say what the programs they called moved. */
  transfersPartial?: true;
};

/** Amounts are formatted with their unit ('0.00203928 SOL'); deltas are signed ('+1.5 USDC'). */
export type AccountFactView = {
  address: string;
  owner: string | null;
  /** Clef's name for the owner program, when it knows it. */
  ownerName?: string;
  /** The owner and size are today's (a landed transaction's meta doesn't record them). */
  ownerNow?: true;
  executable: boolean;
  dataLength: number | null;
  lifecycle: AccountFact['lifecycle'];
  lamports: { before: string | null; after: string | null; delta: string | null };
  token?: { mint: string; holder: string; symbol: string; before: string | null; after: string | null; delta: string | null };
};
export type TransferView = {
  kind: Transfer['kind'];
  from: string;
  to: string;
  /** e.g. '0.5 SOL', '12 USDC'. */
  amount: string;
  instructionIndex: number;
  inner: boolean;
  owner?: string;
  ownerName?: string;
  space?: number;
};

export type DiffLineView = { sign: '+' | '-' | ' '; key: string; value: string; note?: string };
export type AccountDiffView = {
  address: string;
  title: string;
  type: string;
  tag: 'new' | 'closed' | 'temp' | 'modified';
  lines: DiffLineView[];
  undecoded?: { reason: string; lines: { sign: '+' | '-'; offset: string; bytes: string }[]; summary: string };
  lastChangedBy?: number;
};
export type LogLineView = { depth: number; kind: LogKind; text: string; program?: string; computeUnits?: string };
export type CombinedView = {
  summary: string;
  balanceChanges: ChangeView[] | null;
  warnings: Warning[];
  fee: string | null;
  deposits?: { amount: string; count: number } | null;
  recipient?: string;
  computeUnits: string | null;
  accountDiffs: AccountDiffView[] | null;
  incomplete: boolean;
};
type ViewOf<L extends DetailLevel> = L extends 'basic' ? BasicView : L extends 'intermediate' ? IntermediateView : ExpertView;
export type BatchView<L extends DetailLevel = DetailLevel> = {
  level: L;
  mode: 'sequential' | 'independent';
  combined: CombinedView;
  steps: { index: number; status: BatchStep['status']; title: string; view: ViewOf<L> | null }[];
  dependentSteps: number[];
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
    // Badges are checks against what the instruction expects; ownership and stored references are graph facts.
    .filter((r) => r.kind !== 'token-mint' && r.kind !== 'program-owner' && r.kind !== 'data-ref')
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
    ...(!ix.idl && ex.issues.some((i) => i.stage === 'parse' && i.instructionIndex === ix.index && i.message.startsWith('no instruction in')) && { idlOutdated: true as const }),
    args: formatArgs(ix),
    accounts: accountViews(ex, ix),
  };
}

function changeView(c: BalanceChange): ChangeView {
  const amount = formatUnits(c.delta, c.decimals);
  return { owner: c.owner, mint: c.mint, asset: c.symbol ?? shortAddress(c.mint), amount: c.delta > 0n ? `+${amount}` : amount };
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

/** IDL context lines shown per account: enough to orient, not the whole account. */
const MAX_CONTEXT_LINES = 3;
const STEP_TITLE_MAX = 40;

const withCommas = (n: bigint | number) => BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const cu = (n: bigint | number) => `${withCommas(n)} CU`;
const sol = (lamports: bigint) => `${formatUnits(lamports, 9)} SOL`;
const shortValue = (v: string) => (isAddress(v) ? shortAddress(v) : v);

function line(sign: DiffLineView['sign'], key: string, value: string, note?: string): DiffLineView {
  return note ? { sign, key, value: shortValue(value), note } : { sign, key, value: shortValue(value) };
}

/** A created-and-closed account in a batch: no state before, none after. */
const isTemp = (d: AccountDiff) => d.lifecycle === 'closed' && d.owner.before === null;

function accountDiffView(d: AccountDiff): AccountDiffView {
  const temp = isTemp(d);
  const tag = temp ? 'temp' : d.lifecycle === 'created' ? 'new' : d.lifecycle === 'closed' ? 'closed' : 'modified';
  const type = temp
    ? 'Created & closed'
    : tag === 'new' ? 'New account'
    : tag === 'closed' ? 'Closed'
    : !d.decoded ? 'Undecoded'
    : d.decoded.by === 'idl' ? `${d.decoded.type} \u00b7 IDL` : d.decoded.type;
  const lines: DiffLineView[] = [];
  const context = d.decoded?.context ?? [];
  for (const c of d.decoded?.by === 'idl' ? context.slice(0, MAX_CONTEXT_LINES) : context) {
    const value = c.after ?? c.before ?? '';
    lines.push(line(' ', c.path, value, c.note ?? (d.decoded?.by === 'idl' ? 'unchanged' : undefined)));
  }
  for (const c of d.decoded?.changed ?? []) {
    const both = c.before !== null && c.after !== null;
    if (c.before !== null) lines.push(line('-', c.path, c.before, both ? undefined : c.note));
    if (c.after !== null) lines.push(line('+', c.path, c.after, c.note));
  }
  if (!temp && d.lamports.before !== d.lamports.after) {
    if (d.lifecycle !== 'created') lines.push(line('-', 'lamports', groupDigits(d.lamports.before), sol(d.lamports.before)));
    if (d.lifecycle !== 'closed') lines.push(line('+', 'lamports', groupDigits(d.lamports.after), sol(d.lamports.after)));
  }
  const view: AccountDiffView = { address: d.address, title: d.title, type, tag, lines };
  if (d.raw) {
    const offset = (n: number) => `0x${n.toString(16).padStart(4, '0')}`;
    const { size } = d.raw;
    view.undecoded = {
      reason: d.undecodedReason ?? 'not decoded',
      lines: d.raw.changes.flatMap((c) => [
        ...(c.before ? [{ sign: '-' as const, offset: offset(c.offset), bytes: c.before }] : []),
        ...(c.after ? [{ sign: '+' as const, offset: offset(c.offset), bytes: c.after }] : []),
      ]),
      summary: `${d.raw.changedBytes} bytes changed of ${size.before === size.after ? size.after : `${size.before} \u2192 ${size.after}`}`,
    };
  }
  if (d.lastChangedBy !== undefined) view.lastChangedBy = d.lastChangedBy;
  return view;
}

function logLineView(l: LogLine): LogLineView {
  return {
    depth: l.depth,
    kind: l.kind,
    text: l.text,
    ...(l.kind === 'invoke' && l.programName !== undefined && { program: l.programName }),
    ...(l.computeUnits && { computeUnits: cu(l.computeUnits.consumed) }),
  };
}

const copyRelation = (r: RelationEdge): RelationEdge => ({ ...r, ...(r.seeds && { seeds: r.seeds.map((seed) => ({ ...seed })) }) });

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
    ...(ex.deposits && { deposits: { amount: `${formatUnits(ex.deposits.lamports, 9)} SOL`, count: ex.deposits.count } }),
    ...(ex.recipient && { recipient: ex.recipient }),
  };
  const fee = ex.fee === null ? null : `${formatUnits(ex.fee, 9)} SOL`;
  const highFee = fee !== null && ex.warnings.some((w) => w.rule === 'high-fee') ? { fee } : {};
  if (level === 'basic') return { level, ...common, ...highFee };
  if (level === 'intermediate') {
    return { level, ...common, ...highFee, instructions: ex.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId)).map((ix) => instructionView(ex, ix)) };
  }

  // v1: the transaction config (a protocol field); compute budget instructions are no-ops there. Otherwise,
  // compute budget values only from the curated IDL, as the fee estimate does.
  const config = ex.tx.version === 1 ? (ex.tx.config ?? {}) : undefined;
  const budget = (name: string) =>
    ex.instructions.find((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM && ix.name === name && ix.idl?.trust === 'curated')?.args;
  const limit = config ? (config.computeUnitLimit ?? 0) : toNumber(budget('setComputeUnitLimit')?.units);
  const price = config ? undefined : toBigint(budget('setComputeUnitPrice')?.microLamports);
  const notSet = config ? (['computeUnitLimit', 'loadedAccountsDataSizeLimit'] as const).filter((k) => config[k] === undefined) : [];
  return {
    level,
    ...common,
    version: String(ex.tx.version),
    feePayer: ex.tx.feePayer,
    fee,
    recentBlockhash: ex.tx.recentBlockhash,
    ...(limit !== undefined && { computeUnitLimit: limit }),
    ...(price !== undefined && { computeUnitPrice: price.toString() }),
    ...(config?.priorityFeeLamports !== undefined && { priorityFeeLamports: config.priorityFeeLamports.toString() }),
    ...(config && { loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit ?? 0 }),
    ...(notSet.length && { notSet: [...notSet] }),
    ...(config?.heapSize !== undefined && { heapSize: config.heapSize }),
    relations: ex.relations.map(copyRelation),
    accountDiffs: ex.accountDiffs && ex.accountDiffs.map(accountDiffView),
    logs: ex.logs && ex.logs.map(logLineView),
    computeUnits: ex.computeUnits === null ? null : cu(ex.computeUnits),
    externalRelations: ex.externalRelations.map(copyRelation),
    accountFacts: ex.accountFacts.map(accountFactView),
    transfers: ex.transfers && ex.transfers.map(transferView),
    ...(ex.transfersPartial && { transfersPartial: true as const }),
    issues: ex.issues.map((i) => ({ ...i })),
    stateChanges: ex.stateChanges && ex.stateChanges.map(stateChangeView),
    instructions: ex.instructions.map((ix) => ({
      ...instructionView(ex, ix),
      programId: ix.programId,
      ...(config && ix.programId === COMPUTE_BUDGET_PROGRAM && { noEffect: true as const }),
      ...(ix.idl && { idl: { source: ix.idl.source, trust: ix.idl.trust, hash: ix.idl.hash } }),
      dataHex: toHex(ix.data),
      accounts: accountViews(ex, ix).map((a, i) => {
        const ref = ix.accounts[i]!;
        return { ...a, signer: ref.signer, writable: ref.writable, ...(ref.lookupTable && { lookupTable: ref.lookupTable }) };
      }),
    })),
  };
}

const withUnit = (amount: bigint, decimals: number | null, symbol: string) => `${formatUnits(amount, decimals)} ${symbol}`;
const signed = (delta: bigint, decimals: number | null, symbol: string) =>
  `${delta > 0n ? '+' : ''}${withUnit(delta, decimals, symbol)}`;

function accountFactView(f: AccountFact): AccountFactView {
  const sol = (v: bigint | null) => (v === null ? null : withUnit(v, 9, 'SOL'));
  const { before, after } = f.lamports;
  const ownerName = f.owner ? PROGRAM_NAMES[f.owner] : undefined;
  const view: AccountFactView = {
    address: f.address,
    owner: f.owner,
    ...(ownerName && { ownerName }),
    ...(f.ownerNow && { ownerNow: true as const }),
    executable: f.executable,
    dataLength: f.dataLength,
    lifecycle: f.lifecycle,
    lamports: { before: sol(before), after: sol(after), delta: before !== null && after !== null ? signed(after - before, 9, 'SOL') : null },
  };
  if (f.token) {
    const t = f.token;
    const symbol = t.symbol ?? shortAddress(t.mint);
    const amount = (v: bigint | null) => (v === null ? null : withUnit(v, t.decimals, symbol));
    view.token = {
      mint: t.mint,
      holder: t.holder,
      symbol,
      before: amount(t.before),
      after: amount(t.after),
      delta: t.before !== null && t.after !== null ? signed(t.after - t.before, t.decimals, symbol) : null,
    };
  }
  return view;
}

function transferView(t: Transfer): TransferView {
  const ownerName = t.owner ? PROGRAM_NAMES[t.owner] : undefined;
  return {
    kind: t.kind,
    from: t.from,
    to: t.to,
    amount: withUnit(t.amount, t.decimals, t.symbol ?? (t.mint === 'SOL' ? 'SOL' : shortAddress(t.mint))),
    instructionIndex: t.instructionIndex,
    inner: t.inner,
    ...(t.owner && { owner: t.owner }),
    ...(ownerName && { ownerName }),
    ...(t.space !== undefined && { space: t.space }),
  };
}

const truncate = (s: string, max: number) => (Array.from(s).length > max ? `${Array.from(s).slice(0, max - 1).join('')}\u2026` : s);

export function viewForBatch<L extends DetailLevel>(batch: ExplainedBatch, level: L): BatchView<L> {
  const me = new Set<string>(batch.steps.flatMap((s) => s.explained?.me ?? []));
  const c = batch.combined;
  return {
    level,
    mode: batch.mode,
    combined: {
      summary: c.summary,
      balanceChanges: c.balanceChanges && (level === 'expert' ? c.balanceChanges : c.balanceChanges.filter((b) => me.has(b.owner))).map(changeView),
      warnings: c.warnings.map((w) => ({ ...w })),
      fee: c.fee === null ? null : sol(c.fee),
      deposits: c.deposits ? { amount: sol(c.deposits.lamports), count: c.deposits.count } : null,
      ...(batch.steps.length === 1 && batch.steps[0]!.explained?.recipient && { recipient: batch.steps[0]!.explained.recipient }),
      computeUnits: c.computeUnits === null ? null : cu(c.computeUnits),
      accountDiffs: c.accountDiffs && c.accountDiffs.map(accountDiffView),
      incomplete: c.incomplete,
    },
    steps: batch.steps.map((s) => ({
      index: s.index,
      status: s.status,
      title: s.explained ? truncate(s.explained.summary, STEP_TITLE_MAX) : `Transaction ${s.index + 1}`,
      view: s.explained ? (viewFor(s.explained, level) as ViewOf<L>) : null,
    })),
    dependentSteps: [...batch.dependentSteps],
  };
}
