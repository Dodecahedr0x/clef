import type { RawAccount, SimulationResult, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AccountCache, decodeTokenAccount } from './accounts';
import { verifyAnchorExtras } from './anchor-relations';
import { balanceChangesFromMeta, balanceChangesFromSimulation } from './balances';
import { decodeTransaction } from './decode';
import { computeAccountDiffs } from './diffs';
import { externalRelations } from './external';
import { parseLogs } from './logs';
import { identifyInstruction, type IdentifiedInstruction } from './identify';
import { Labeler, tokenRelations } from './labels';
import { verifyCodamaPdas } from './pda';
import { CLOCK_SYSVAR, COMPUTE_BUDGET_PROGRAM, PROGRAM_NAMES, RENT_SYSVAR, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import { estimateFee, evaluateRisks, type AccountInfo, type RiskInput, type TokenHolding } from './risk';
import { errorDetail } from './seeds';
import { computeStateChanges, type StateChange } from './state-changes';
import { summarize } from './summary';
import { sanitizeText } from './text';
import { programDisplay } from './format';
import type { AccountDiff, DecodedInstruction, DecodedTransaction, ExplainContext, ExplainedInstruction, ExplainedTransaction, Issue, LogLine, RelationEdge, Warning } from './types';

type Unit = NonNullable<ExplainedInstruction['amountUnit']>;

/**
 * The unit of an instruction's `amount` argument, from Clef's own knowledge: lamports for the System Program,
 * else the mint of a Token instruction (its `mint` account, or its `source` token account's mint). Only for
 * names decoded with a curated IDL. Undefined when the mint's decimals are unknown: views then show raw units.
 */
function amountUnit(ix: ExplainedInstruction, cache: AccountCache, labeler: Labeler): Unit | undefined {
  if (ix.idl?.trust !== 'curated' || typeof ix.args?.amount !== 'bigint') return undefined;
  if (ix.programId === SYSTEM_PROGRAM) return { symbol: 'SOL', decimals: 9 };
  if (!TOKEN_PROGRAMS.has(ix.programId)) return undefined;
  const source = ix.accounts.find((a) => a.name === 'source');
  const mint = ix.accounts.find((a) => a.name === 'mint')?.address ?? (source && decodeTokenAccount(cache.get(source.address))?.mint);
  return (mint && labeler.mintInfo(mint)) || undefined;
}

/**
 * The Stake program's legacy account layout (still accepted) puts sysvars before the authorities, shifting every
 * name the vendored IDL gives after the stake account. Names after index 0 can't be trusted there.
 */
function omitLegacyStakeNames(ix: IdentifiedInstruction, issues: Issue[]): IdentifiedInstruction {
  if (ix.programId !== STAKE_PROGRAM || !ix.name) return ix;
  if (!ix.accounts.some((a) => a.address === CLOCK_SYSVAR || a.address === RENT_SYSVAR)) return ix;
  issues.push({ stage: 'parse', instructionIndex: ix.index, message: 'legacy stake account layout; names omitted' });
  return { ...ix, accounts: ix.accounts.map((a, i) => (i === 0 ? a : { ...a, name: undefined })) };
}

/** A decoded compute budget argument, only from the curated IDL. */
function budgetArg(instructions: readonly ExplainedInstruction[], name: string, arg: string): unknown {
  const ix = instructions.find((i) => i.programId === COMPUTE_BUDGET_PROGRAM && i.name === name && i.idl?.trust === 'curated');
  return ix?.args?.[arg];
}

const toNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined);
const toBigint = (v: unknown) => (typeof v === 'bigint' ? v : typeof v === 'number' ? BigInt(v) : undefined);

/** The simulation error, bigint-safe, sanitized and bounded. */
const simError = (err: unknown) =>
  sanitizeText(JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(err), 200);

type Simulated = {
  balanceChanges: ExplainedTransaction['balanceChanges'];
  /** The run's pre and post state, for account diffs. */
  states?: { pre: (RawAccount | null)[]; post: (RawAccount | null)[] };
  stateChanges?: StateChange[];
  postTokenOwners?: Record<string, Address>;
  /** The pre-state was built conservatively (see `highestSeen`). */
  conservative?: true;
};
/**
 * A simulation's raw outcome: pre and post state, index-aligned with the writable accounts. `conservative`: the
 * chain kept changing, so `pre` was built by `highestSeen`.
 */
type SimOutput = { logs?: string[]; unitsConsumed?: bigint | null };
type SimRun = ({ pre: (RawAccount | null)[]; post: (RawAccount | null)[]; conservative?: true } | { failed: string }) & SimOutput;

/**
 * A simulation already run by the caller (e.g. one step of a sequential batch simulation): `pre` is the state the
 * step started from, index-aligned with the transaction's writable accounts, as is `result.postAccounts`.
 */
export type PresetSimulation = { pre: (RawAccount | null)[]; result: SimulationResult } | { failed: string; logs?: string[] };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameAccount = (a: RawAccount | null, b: RawAccount | null) =>
  a === b || (!!a && !!b && a.lamports === b.lamports && a.owner === b.owner && sameBytes(a.data, b.data));

/** SPL token account `amount`: u64 LE at offset 64. */
const TOKEN_AMOUNT_OFFSET = 64;

/**
 * One account's pre-state from several reads that disagree. Owner, delegate and close authority come from the
 * read the final simulation started from (the one before the last re-read); lamports and the token amount (same
 * mint) are the highest seen in any read. Concurrent gifts only add, so pre-minus-post can then overstate an
 * outflow but never understate one.
 */
function highestSeen(reads: readonly (RawAccount | null)[]): RawAccount | null {
  const simulatedFrom = reads.length > 1 ? reads[reads.length - 2] : reads[0];
  const base = simulatedFrom ?? [...reads].reverse().find((a) => a !== null) ?? null;
  if (!base) return null;
  const present = reads.filter((a): a is RawAccount => a !== null);
  const lamports = present.reduce((max, a) => (a.lamports > max ? a.lamports : max), base.lamports);
  let data = base.data;
  const token = decodeTokenAccount(base);
  if (token) {
    const amount = present
      .map((a) => decodeTokenAccount(a))
      .reduce((max, t) => (t && t.mint === token.mint && t.amount > max ? t.amount : max), token.amount);
    if (amount > token.amount) {
      data = new Uint8Array(base.data);
      new DataView(data.buffer).setBigUint64(TOKEN_AMOUNT_OFFSET, amount, true);
    }
  }
  return { ...base, lamports, data };
}

/**
 * Simulates against the cached pre-state of every writable account (only those can change, by top-level or CPI
 * instructions alike), then re-reads them: if the chain moved meanwhile, pre and post would describe different
 * states (a concurrent gift could offset a drain). It retries once from the fresh read. If the state moved again,
 * it keeps the last simulation and compares it with `highestSeen` of all reads: never discarded (an attacker
 * could otherwise turn any danger into "simulation failed" by gifting lamports before every simulation).
 */
async function runSimulation(wire: Uint8Array, writable: readonly Address[], ctx: ExplainContext, cache: AccountCache): Promise<SimRun> {
  const loaded = writable.map((a) => cache.get(a));
  if (loaded.some((a) => a === undefined)) return { failed: 'Simulation skipped: pre-transaction state unavailable' };
  let pre = loaded as (RawAccount | null)[];
  const reads: (RawAccount | null)[][] = [pre];
  let post: (RawAccount | null)[] = [];
  let output: SimOutput = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    let now: (RawAccount | null)[];
    let simSlot: bigint | undefined;
    try {
      const minContextSlot = cache.slot;
      const sim = await ctx.reader.simulate(wire, writable, minContextSlot === undefined ? undefined : { minContextSlot });
      output = { logs: sim.logs, unitsConsumed: sim.unitsConsumed };
      if (sim.err) return { failed: `Simulation failed: ${simError(sim.err)}`, ...output };
      post = sim.postAccounts;
      simSlot = sim.slot;
    } catch (e) {
      return { failed: `Simulation unavailable: ${errorDetail(e)}` };
    }
    if (post.length !== writable.length || post.some((a, i) => a !== null && a.address !== writable[i])) {
      return { failed: 'Simulation returned accounts that do not match the request' };
    }
    try {
      // Tied to the simulation's slot, so the re-read sees at least the state that was simulated.
      now = await cache.fetch(writable, simSlot ?? cache.slot);
    } catch (e) {
      return { failed: `Could not confirm the pre-transaction state: ${errorDetail(e)}` };
    }
    if (now.length !== writable.length) return { failed: 'Could not confirm the pre-transaction state' };
    if (now.every((a, i) => sameAccount(a ?? null, pre[i]!))) return { pre, post, ...output };
    pre = now.map((a) => a ?? null);
    reads.push(pre);
    pre.forEach((a, i) => cache.set(writable[i]!, a));
  }
  const conservative = writable.map((_, i) => highestSeen(reads.map((r) => r[i]!)));
  return { pre: conservative, post, conservative: true, ...output };
}

function presetRun(preset: PresetSimulation, writable: readonly Address[]): SimRun {
  if ('failed' in preset) return { failed: preset.failed, ...(preset.logs && { logs: preset.logs }) };
  const { result, pre } = preset;
  const output = { logs: result.logs, unitsConsumed: result.unitsConsumed };
  if (result.err) return { failed: `Simulation failed: ${simError(result.err)}`, ...output };
  const aligned = (list: readonly (RawAccount | null)[]) =>
    list.length === writable.length && list.every((a, i) => a === null || a.address === writable[i]);
  if (!aligned(result.postAccounts) || !aligned(pre)) return { failed: 'Simulation returned accounts that do not match the request', ...output };
  return { pre: [...pre], post: result.postAccounts, ...output };
}

/** Balance and state changes from a simulation run, the same index-aligned lists feeding both. */
async function fromSimulation(
  run: SimRun,
  writable: readonly Address[],
  labeler: Labeler,
  issues: Issue[],
  load: (addresses: readonly Address[], what: string) => Promise<void>,
): Promise<Simulated> {
  if ('failed' in run) {
    issues.push({ stage: 'simulate', message: run.failed });
    return { balanceChanges: null };
  }
  const { pre, post } = run;
  if (run.conservative) issues.push({ stage: 'simulate', message: 'state changed during simulation; balances computed conservatively' });
  // Accounts created in the transaction may hold mints not seen before: their decimals are needed too.
  const postTokens = post.map((a) => (a ? decodeTokenAccount(a) : null));
  await load(postTokens.flatMap((t) => (t ? [t.mint] : [])), 'mints');
  const postTokenOwners: Record<string, Address> = {};
  postTokens.forEach((t, i) => {
    if (t) postTokenOwners[writable[i]!] = t.owner;
  });
  return {
    balanceChanges: balanceChangesFromSimulation(pre, post, (mint) => labeler.mintInfo(mint)),
    stateChanges: computeStateChanges(pre, post),
    states: { pre, post },
    postTokenOwners,
    ...(run.conservative && { conservative: true as const }),
  };
}

/** Addresses each instruction may see modified by earlier instructions of the transaction (top-level or CPI). */
function writtenBefore(instructions: readonly DecodedInstruction[]): ReadonlySet<string>[] {
  const seen = new Set<string>();
  return instructions.map((ix) => {
    const before = new Set(seen);
    for (const a of ix.accounts) if (a.writable) seen.add(a.address);
    return before;
  });
}

/** Identifies one instruction and verifies its relations. Never throws: failures become issues. */
async function identifyAndVerify(
  dix: DecodedInstruction,
  ctx: ExplainContext,
  cache: AccountCache,
  modifiedBefore: ReadonlySet<string>,
): Promise<{ ix: IdentifiedInstruction; relations: RelationEdge[]; issues: Issue[] }> {
  const issues: Issue[] = [];
  let ix: IdentifiedInstruction;
  try {
    ix = omitLegacyStakeNames(await identifyInstruction(dix, ctx.idls, issues), issues);
  } catch (e) {
    issues.push({ stage: 'idl', instructionIndex: dix.index, message: errorDetail(e) });
    ix = { ...dix, accounts: dix.accounts.map((a) => ({ ...a, mine: false })) };
  }
  const relations: RelationEdge[] = [];
  try {
    relations.push(...(await verifyCodamaPdas(ix)), ...(await verifyAnchorExtras(ix, cache, modifiedBefore)));
  } catch (e) {
    issues.push({ stage: 'relations', instructionIndex: dix.index, message: errorDetail(e) });
  }
  return { ix, relations, issues };
}

const INTERNAL_ERROR: Warning = { rule: 'internal-error', severity: 'danger', message: 'Clef could not finish its safety checks.' };

/**
 * Explains a transaction. Never throws for partial failures: those land in `issues` (and a failure of the
 * safety checks themselves becomes a danger). Throws only if the wire bytes cannot be decoded at all.
 */
export async function explain(
  input: { wire: Uint8Array; meta?: TxMeta | null },
  ctx: ExplainContext,
): Promise<ExplainedTransaction> {
  return (await explainWith(input, ctx)).explained;
}

/** What `explainBatch` needs beyond the explanation: the simulated states and the labels they were read with. */
export type ExplainRun = {
  explained: ExplainedTransaction;
  writable: Address[];
  states: { pre: (RawAccount | null)[]; post: (RawAccount | null)[] } | null;
  labeler: Labeler;
};

/** `explain`, optionally from a simulation the caller already ran (`preset`) instead of simulating itself. */
export async function explainWith(
  input: { wire: Uint8Array; meta?: TxMeta | null; tx?: DecodedTransaction },
  ctx: ExplainContext,
  preset?: PresetSimulation,
): Promise<ExplainRun> {
  const issues: Issue[] = [];
  const tx = input.tx ?? (await decodeTransaction(input.wire, ctx.reader, input.meta?.loadedAddresses));
  const addresses = tx.accounts.map((a) => a.address);
  const cache = new AccountCache(ctx.reader);
  const load = async (list: readonly Address[], what: string) => {
    try {
      await cache.load(list);
    } catch (e) {
      // Unloaded accounts read as unknown (`undefined`), never as missing: rules then assume the worst.
      issues.push({ stage: 'decode', message: `Could not load ${what}: ${errorDetail(e)}` });
    }
  };
  // Program accounts are never read (no rule needs them): skip those that appear only as programs.
  const used = new Set(tx.instructions.flatMap((ix) => ix.accounts.map((a) => a.address)));
  const programOnly = new Set(tx.instructions.map((ix) => ix.programId).filter((p) => !used.has(p)));
  await load([...addresses.filter((a) => !programOnly.has(a)), ...ctx.me], 'accounts');

  // Simulation starts right after the pre-read, while instructions are identified.
  const writable = tx.accounts.filter((a) => a.writable).map((a) => a.address);
  // A preset step starts from the state earlier steps left: it replaces the chain read for its writable accounts.
  if (preset && 'pre' in preset && preset.pre.length === writable.length) preset.pre.forEach((a, i) => cache.set(writable[i]!, a));
  const simulation = input.meta ? undefined : preset ? Promise.resolve(presetRun(preset, writable)) : runSimulation(input.wire, writable, ctx, cache);

  const relations: RelationEdge[] = [];
  try {
    relations.push(...(await tokenRelations(addresses, cache)));
  } catch (e) {
    issues.push({ stage: 'relations', message: errorDetail(e) });
  }
  // Mints referenced by token accounts are needed for symbols/decimals.
  await load(relations.filter((r) => r.kind === 'token-mint').map((r) => r.to), 'mints');

  // Instructions (and so the IDLs of distinct programs) are resolved in parallel; results keep their order.
  const modified = writtenBefore(tx.instructions);
  const results = await Promise.all(tx.instructions.map((dix) => identifyAndVerify(dix, ctx, cache, modified[dix.index]!)));
  const identified = results.map((r) => r.ix);
  for (const r of results) {
    issues.push(...r.issues);
    relations.push(...r.relations);
  }

  // On the meta path, the meta says who held each token account at the time.
  const metaOwners: Record<string, Address> = {};
  for (const t of [...(input.meta?.postTokenBalances ?? []), ...(input.meta?.preTokenBalances ?? [])]) {
    const at = addresses[t.accountIndex];
    if (at && t.owner) metaOwners[at] = t.owner;
  }
  const labeler = new Labeler(ctx.me, cache, ctx.addressBook, metaOwners);
  // `resolvedIdl` and `rawArgs` are for verification only: they never leave the orchestrator.
  const instructions: ExplainedInstruction[] = identified.map(({ resolvedIdl: _idl, rawArgs: _raw, ...ix }) => {
    const book = PROGRAM_NAMES[ix.programId] || !Object.hasOwn(ctx.addressBook ?? {}, ix.programId) ? undefined : ctx.addressBook![ix.programId];
    const programLabel = book === undefined ? '' : sanitizeText(book, 64).trim();
    const explained: ExplainedInstruction = {
      ...ix,
      ...(programLabel && { programLabel }),
      accounts: ix.accounts.map((a) => {
        const label = labeler.label(a.address);
        return { ...a, mine: labeler.isMine(a.address), ...(label !== undefined && { label }) };
      }),
    };
    const unit = amountUnit(explained, cache, labeler);
    return unit ? { ...explained, amountUnit: unit } : explained;
  });

  const numSignatures = tx.accounts.filter((a) => a.signer).length;
  const baseFee = 5000n * BigInt(numSignatures);
  // v1 (SIMD-0385): the config, a protocol field, sets the priority fee (a total in lamports) and the limits.
  // Compute budget instructions are ignored for configuration, even invalid ones, and run as no-ops.
  if (tx.version === 1 && instructions.some((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM)) {
    issues.push({ stage: 'decode', message: 'Compute budget instructions have no effect in a v1 transaction; its config sets the fee and limits.' });
  }
  // A compute budget instruction Clef couldn't decode may set any price: the fee is then unknown.
  const undecodedBudget = instructions.some((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM && !(ix.name && ix.idl?.trust === 'curated'));
  let fee: bigint | null;
  if (input.meta) fee = input.meta.fee;
  else if (tx.version === 1) fee = baseFee + (tx.config?.priorityFeeLamports ?? 0n);
  else if (undecodedBudget) fee = null;
  else {
    fee = estimateFee(
      numSignatures,
      toNumber(budgetArg(instructions, 'setComputeUnitLimit', 'units')),
      toBigint(budgetArg(instructions, 'setComputeUnitPrice', 'microLamports')),
      tx.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM).length,
    );
  }

  const tokenBalances: Record<string, TokenHolding> = {};
  const solBalances: Record<string, bigint> = {};
  const accountLamports: Record<string, bigint> = {};
  let simulated: Simulated;
  let logs: LogLine[] | null = null;
  let computeUnits: bigint | null = null;
  if (!input.meta) {
    const run = await simulation!;
    if (run.logs) logs = parseLogs(run.logs);
    computeUnits = run.unitsConsumed ?? null;
    simulated = await fromSimulation(run, writable, labeler, issues, load);
    // Read after the simulation: a retry may have refreshed the pre-state.
    for (const a of addresses) {
      const token = decodeTokenAccount(cache.get(a));
      if (token) tokenBalances[a] = { owner: token.owner, mint: token.mint, amount: token.amount };
    }
    for (const wallet of ctx.me) {
      const account = cache.get(wallet);
      if (account !== undefined) solBalances[wallet] = account?.lamports ?? 0n;
    }
    for (const a of addresses) {
      const account = cache.get(a);
      if (account !== undefined) accountLamports[a] = account?.lamports ?? 0n;
    }
  } else {
    const meta = input.meta;
    logs = parseLogs(meta.logMessages);
    computeUnits = meta.computeUnitsConsumed ?? null;
    if (meta.err) issues.push({ stage: 'execute', message: `Transaction failed: ${simError(meta.err)}` });
    const ownerOf = (a: Address) => decodeTokenAccount(cache.get(a))?.owner ?? null;
    simulated = { balanceChanges: balanceChangesFromMeta(addresses, meta, (mint) => labeler.mintInfo(mint), ownerOf) };
    // Pre-state as of the transaction, not today.
    for (const t of meta.preTokenBalances) {
      const at = addresses[t.accountIndex];
      const owner = at && (t.owner ?? ownerOf(at));
      if (at && owner) tokenBalances[at] = { owner, mint: t.mint, amount: t.amount };
    }
    addresses.forEach((a, i) => {
      const lamports = meta.preBalances[i];
      if (lamports !== undefined) accountLamports[a] = lamports;
    });
    for (const wallet of ctx.me) {
      const i = addresses.indexOf(wallet);
      const lamports = i >= 0 ? meta.preBalances[i] : undefined;
      if (lamports !== undefined) solBalances[wallet] = lamports;
    }
  }

  // Owner wallets of token accounts (pre-state first), and trusted labels for everyone involved.
  const tokenOwners: Record<string, Address> = { ...metaOwners, ...simulated.postTokenOwners };
  for (const [account, holding] of Object.entries(tokenBalances)) tokenOwners[account] = holding.owner;
  const labels: Record<string, string> = {};
  const involved = [...addresses, ...Object.values(tokenOwners), ...(simulated.balanceChanges ?? []).map((c) => c.owner)];
  for (const a of new Set(involved)) {
    const label = labeler.label(a);
    if (label !== undefined) labels[a] = label;
  }

  // Pre-state owner and size (from the cache, refreshed by a simulation retry), and the transaction's signer flags.
  const accountInfo: Record<string, AccountInfo> = {};
  for (const a of tx.accounts) {
    const account = cache.get(a.address);
    if (account) accountInfo[a.address] = { owner: account.owner, dataLength: account.data.length, signer: a.signer };
  }

  const me = [...ctx.me];
  const risk: RiskInput = {
    instructions,
    relations,
    balanceChanges: simulated.balanceChanges,
    issues,
    me,
    ...(fee !== null && { fee }),
    baseFee,
    feePayer: tx.feePayer,
    tokenBalances,
    solBalances,
    addressBook: new Set(Object.keys(ctx.addressBook ?? {})),
    labels,
    accountLamports,
    accountInfo,
    ...(simulated.conservative && { balancesChanged: true }),
    ...(simulated.stateChanges && { stateChanges: simulated.stateChanges }),
    ...(simulated.postTokenOwners && { postTokenOwners: simulated.postTokenOwners }),
    ...(ctx.valuedMints && { valuedMints: ctx.valuedMints }),
    ...(ctx.prices && { prices: ctx.prices }),
  };
  let warnings: Warning[];
  try {
    warnings = evaluateRisks(risk);
  } catch {
    // Fail closed: a rule that crashed may have been the one that mattered.
    warnings = [{ ...INTERNAL_ERROR }];
  }
  const balanceChanges = simulated.balanceChanges;
  let summary: string;
  try {
    summary = summarize({
      instructions, balanceChanges, me, warnings, ...(fee !== null && { fee }), baseFee, feePayer: tx.feePayer, labels, tokenOwners, tokenBalances, accountLamports,
    });
  } catch {
    const danger = warnings.find((w) => w.severity === 'danger');
    const programs = [...new Set(instructions.map(programDisplay))].join(', ') || 'no programs';
    summary = `Interact with ${programs}${danger ? ` -- ${danger.message}` : ''}`;
  }
  if (input.meta?.err) summary = `Failed: ${summary}`;
  const stateChanges = simulated.stateChanges ?? null;

  let accountDiffs: AccountDiff[] | null = null;
  if (simulated.states) {
    const { pre, post } = simulated.states;
    try {
      accountDiffs = await computeAccountDiffs(
        writable.map((address, i) => ({ address, pre: pre[i] ?? null, post: post[i] ?? null })),
        { idls: ctx.idls, labeler, me, ...(ctx.addressBook && { addressBook: ctx.addressBook }) },
      );
    } catch (e) {
      issues.push({ stage: 'decode', message: `Could not diff account state: ${errorDetail(e)}` });
    }
  }
  let external: RelationEdge[] = [];
  try {
    // A program account's owner is its loader: noise, not a relation worth showing.
    external = (await externalRelations(addresses, cache)).filter((r) => !(r.kind === 'program-owner' && cache.get(r.from)?.executable));
  } catch (e) {
    issues.push({ stage: 'relations', message: errorDetail(e) });
  }

  const explained: ExplainedTransaction = {
    tx, instructions, relations, balanceChanges, stateChanges, fee, issues, me, warnings, summary,
    accountDiffs, logs, computeUnits, externalRelations: external,
  };
  return { explained, writable, states: simulated.states ?? null, labeler };
}
