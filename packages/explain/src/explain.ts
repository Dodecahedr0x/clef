import type { RawAccount, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AccountCache, decodeTokenAccount } from './accounts';
import { verifyAnchorExtras } from './anchor-relations';
import { balanceChangesFromMeta, balanceChangesFromSimulation } from './balances';
import { decodeTransaction } from './decode';
import { identifyInstruction, type IdentifiedInstruction } from './identify';
import { Labeler, tokenRelations } from './labels';
import { verifyCodamaPdas } from './pda';
import { CLOCK_SYSVAR, COMPUTE_BUDGET_PROGRAM, RENT_SYSVAR, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import { estimateFee, evaluateRisks, type RiskInput, type TokenHolding } from './risk';
import { errorDetail } from './seeds';
import { computeStateChanges, type StateChange } from './state-changes';
import { summarize } from './summary';
import { sanitizeText } from './text';
import type { DecodedInstruction, ExplainContext, ExplainedInstruction, ExplainedTransaction, Issue, RelationEdge } from './types';

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

type Simulated = { balanceChanges: ExplainedTransaction['balanceChanges']; stateChanges?: StateChange[]; postTokenOwners?: Record<string, Address> };

/**
 * Simulates and diffs pre/post state of every writable account (only those can change, by top-level or CPI
 * instructions alike). The same index-aligned lists feed balance changes and state changes.
 */
async function simulate(
  wire: Uint8Array,
  writable: readonly Address[],
  ctx: ExplainContext,
  cache: AccountCache,
  labeler: Labeler,
  issues: Issue[],
  load: (addresses: readonly Address[], what: string) => Promise<void>,
): Promise<Simulated> {
  const failed = (message: string): Simulated => {
    issues.push({ stage: 'simulate', message });
    return { balanceChanges: null };
  };
  const loaded = writable.map((a) => cache.get(a));
  if (loaded.some((a) => a === undefined)) return failed('Simulation skipped: pre-transaction state unavailable');
  const pre = loaded as (RawAccount | null)[];

  let post: (RawAccount | null)[];
  try {
    const sim = await ctx.reader.simulate(wire, writable);
    if (sim.err) return failed(`Simulation failed: ${simError(sim.err)}`);
    post = sim.postAccounts;
  } catch (e) {
    return failed(`Simulation unavailable: ${errorDetail(e)}`);
  }
  if (post.length !== writable.length || post.some((a, i) => a !== null && a.address !== writable[i])) {
    return failed('Simulation returned accounts that do not match the request');
  }

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
    postTokenOwners,
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

/**
 * Explains a transaction. Never throws for partial failures: those land in `issues`.
 * Throws only if the wire bytes cannot be decoded at all.
 */
export async function explain(
  input: { wire: Uint8Array; meta?: TxMeta | null },
  ctx: ExplainContext,
): Promise<ExplainedTransaction> {
  const issues: Issue[] = [];
  const tx = await decodeTransaction(input.wire, ctx.reader, input.meta?.loadedAddresses);
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
  await load([...addresses, ...ctx.me], 'accounts');

  const relations: RelationEdge[] = [];
  try {
    relations.push(...(await tokenRelations(addresses, cache)));
  } catch (e) {
    issues.push({ stage: 'relations', message: errorDetail(e) });
  }
  // Mints referenced by token accounts are needed for symbols/decimals.
  await load(relations.filter((r) => r.kind === 'token-mint').map((r) => r.to), 'mints');

  const modified = writtenBefore(tx.instructions);
  const identified: IdentifiedInstruction[] = [];
  for (const dix of tx.instructions) {
    let ix: IdentifiedInstruction;
    try {
      ix = omitLegacyStakeNames(await identifyInstruction(dix, ctx.idls, issues), issues);
    } catch (e) {
      issues.push({ stage: 'idl', instructionIndex: dix.index, message: errorDetail(e) });
      ix = { ...dix, accounts: dix.accounts.map((a) => ({ ...a, mine: false })) };
    }
    identified.push(ix);
    // Neither throws: failures become `unverified` edges.
    relations.push(...(await verifyCodamaPdas(ix)), ...(await verifyAnchorExtras(ix, cache, modified[dix.index])));
  }

  const labeler = new Labeler(ctx.me, cache, ctx.addressBook);
  // `resolvedIdl` and `rawArgs` are for verification only: they never leave the orchestrator.
  const instructions: ExplainedInstruction[] = identified.map(({ resolvedIdl: _idl, rawArgs: _raw, ...ix }) => {
    const explained: ExplainedInstruction = {
      ...ix,
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
  // A compute budget instruction Clef couldn't decode may set any price: the fee is then unknown.
  const undecodedBudget = instructions.some((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM && !(ix.name && ix.idl?.trust === 'curated'));
  const fee = input.meta
    ? input.meta.fee
    : undecodedBudget
      ? null
      : estimateFee(
          numSignatures,
          toNumber(budgetArg(instructions, 'setComputeUnitLimit', 'units')),
          toBigint(budgetArg(instructions, 'setComputeUnitPrice', 'microLamports')),
          tx.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM).length,
        );

  const tokenBalances: Record<string, TokenHolding> = {};
  const solBalances: Record<string, bigint> = {};
  let simulated: Simulated;
  if (input.meta) {
    const meta = input.meta;
    if (meta.err) issues.push({ stage: 'execute', message: `Transaction failed: ${simError(meta.err)}` });
    const ownerOf = (a: Address) => decodeTokenAccount(cache.get(a))?.owner ?? null;
    simulated = { balanceChanges: balanceChangesFromMeta(addresses, meta, (mint) => labeler.mintInfo(mint), ownerOf) };
    // Pre-state as of the transaction, not today.
    for (const t of meta.preTokenBalances) {
      const at = addresses[t.accountIndex];
      const owner = at && (t.owner ?? ownerOf(at));
      if (at && owner) tokenBalances[at] = { owner, mint: t.mint, amount: t.amount };
    }
    for (const wallet of ctx.me) {
      const i = addresses.indexOf(wallet);
      const lamports = i >= 0 ? meta.preBalances[i] : undefined;
      if (lamports !== undefined) solBalances[wallet] = lamports;
    }
  } else {
    for (const a of addresses) {
      const token = decodeTokenAccount(cache.get(a));
      if (token) tokenBalances[a] = { owner: token.owner, mint: token.mint, amount: token.amount };
    }
    for (const wallet of ctx.me) {
      const account = cache.get(wallet);
      if (account !== undefined) solBalances[wallet] = account?.lamports ?? 0n;
    }
    const writable = tx.accounts.filter((a) => a.writable).map((a) => a.address);
    simulated = await simulate(input.wire, writable, ctx, cache, labeler, issues, load);
  }

  // Owner wallets of token accounts (pre-state first), and trusted labels for everyone involved.
  const tokenOwners: Record<string, Address> = { ...simulated.postTokenOwners };
  for (const [account, holding] of Object.entries(tokenBalances)) tokenOwners[account] = holding.owner;
  const labels: Record<string, string> = {};
  const involved = [...addresses, ...Object.values(tokenOwners), ...(simulated.balanceChanges ?? []).map((c) => c.owner)];
  for (const a of new Set(involved)) {
    const label = labeler.label(a);
    if (label !== undefined) labels[a] = label;
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
    ...(simulated.stateChanges && { stateChanges: simulated.stateChanges }),
    ...(simulated.postTokenOwners && { postTokenOwners: simulated.postTokenOwners }),
    ...(ctx.valuedMints && { valuedMints: ctx.valuedMints }),
    ...(ctx.prices && { prices: ctx.prices }),
  };
  const warnings = evaluateRisks(risk);
  const balanceChanges = simulated.balanceChanges;
  const summary = summarize({
    instructions, balanceChanges, me, warnings, ...(fee !== null && { fee }), baseFee, feePayer: tx.feePayer, labels, tokenOwners, tokenBalances,
  });
  return { tx, instructions, relations, balanceChanges, fee, issues, me, warnings, summary };
}
