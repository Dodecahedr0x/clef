import { BUNDLED_PROGRAM_IDS } from '@clef/idl';
import { isOffCurveAddress, type Address } from '@solana/kit';
import { formatUnits } from './format';
import { shortAddress } from './labels';
import { CLOCK_SYSVAR, CORE_PROGRAMS, KNOWN_MINTS, MAX_COMPUTE_UNIT_LIMIT, NATIVE_MINTS, PROGRAM_NAMES, PLUMBING_PROGRAMS, RENT_SYSVAR, SENSITIVE_PROGRAMS, STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAMS, TRUSTED_PROGRAMS, VOTE_PROGRAM } from './registry';
import type { StateChange } from './state-changes';
import type { BalanceChange, ExplainedTransaction, NamedAccount, Warning } from './types';

export type RiskInput = Pick<ExplainedTransaction, 'instructions' | 'relations' | 'balanceChanges' | 'issues' | 'me'> & {
  /** Authority changes seen in pre/post account state (simulation), however they were made. */
  stateChanges?: StateChange[];
  /** Expected network fee in lamports (see `estimateFee`), paid by `feePayer`. */
  fee?: bigint;
  /** The signature part of `fee` (5000 lamports per signature); the rest is priority fee. Default 0. */
  baseFee?: bigint;
  feePayer?: Address;
  /** Pre-transaction state of token accounts the transaction touches, keyed by token account address. */
  tokenBalances?: Readonly<Record<string, TokenHolding>>;
  /** Pre-transaction lamports of the user's wallets, keyed by address. */
  solBalances?: Readonly<Record<string, bigint>>;
  /** Addresses in the user's address book: sending to them is not a sweep. */
  addressBook?: ReadonlySet<string>;
  /** Mints the user values (e.g. priced ones) besides `KNOWN_MINTS`: receiving them counts as an inflow. */
  valuedMints?: ReadonlySet<string>;
  /** Post-transaction owners of token accounts created in the transaction, keyed by token account address. */
  postTokenOwners?: Readonly<Record<string, Address>>;
  /** Balances changed on chain while checking, so pre-state was built conservatively (amounts may be overstated). */
  balancesChanged?: boolean;
  /** Pre-transaction lamports of the accounts the transaction touches, keyed by address. */
  accountLamports?: Readonly<Record<string, bigint>>;
  /** Display labels from trusted sources (see `Labeler`), keyed by address: used to name recipients. */
  labels?: Readonly<Record<string, string>>;
  /**
   * Pre-transaction owner program, data length, and signer flag of the transaction's accounts, keyed by address.
   * Lets value rules tell SOL you may control (stake, vote, nonce, your other keypairs) from SOL a program pays.
   */
  accountInfo?: Readonly<Record<string, AccountInfo>>;
  /** USD per whole unit, keyed by mint or 'SOL'. Lets the sweep rule weigh what comes back against what leaves. */
  prices?: Readonly<Record<string, number>>;
};

export type TokenHolding = { owner: Address; mint: Address; amount: bigint };
export type AccountInfo = { owner: Address; dataLength: number; signer: boolean };

/**
 * SOL losses up to this much (0.01 SOL) are not treated as an outflow: they cover the rent of a few new
 * accounts (an ATA costs ~0.002 SOL) that ordinary transactions create, and that rent stays recoverable.
 */
export const RENT_SLACK = 10_000_000n;

/**
 * Priority fees above this (0.01 SOL) raise `high-fee`, and only this much of a priority fee is allowed for
 * when judging outflows: an absurd fee is itself a loss, not an excuse for one.
 */
export const PRIORITY_FEE_LIMIT = 10_000_000n;

/** A priority fee is only ever a danger above this (0.05 SOL). */
const HIGH_FEE_DANGER = 50_000_000n;

/** How much of `fee` counts as expected spend: the base fee plus at most `PRIORITY_FEE_LIMIT` of priority fee. */
export function feeAllowance(fee: bigint | undefined, baseFee = 0n): bigint {
  if (fee === undefined) return 0n;
  return fee < baseFee + PRIORITY_FEE_LIMIT ? fee : baseFee + PRIORITY_FEE_LIMIT;
}

/** The runtime's default compute limit per instruction (legacy and v0). */
const DEFAULT_CU_PER_INSTRUCTION = 200_000;

/**
 * Base fee (5000 lamports per signature) plus priority fee: ceil(limit * microLamportsPerCu / 1e6). Without an
 * explicit `cuLimit`, the runtime's default applies: 200k CU per non-compute-budget instruction. Either is capped
 * at 1.4M.
 */
export function estimateFee(
  numSignatures: number,
  cuLimit?: number,
  microLamportsPerCu?: bigint,
  nonComputeBudgetInstructions = 0,
): bigint {
  // The runtime clamps an explicit limit too: an oversized one must not inflate the fee (and so the allowance).
  const limit = Math.min(cuLimit ?? DEFAULT_CU_PER_INSTRUCTION * nonComputeBudgetInstructions, MAX_COMPUTE_UNIT_LIMIT);
  const priority = BigInt(limit) * (microLamportsPerCu ?? 0n);
  return 5000n * BigInt(numSignatures) + (priority + 999_999n) / 1_000_000n;
}

const isToken = (p: string) => TOKEN_PROGRAMS.has(p);
/** Undefined when the account is absent, or its name is unknown because the IDL's names were ambiguous. */
const account = (ix: RiskInput['instructions'][number], name: string) => ix.accounts.find((a) => a.name === name);
const RANK = { info: 0, warn: 1, danger: 2 } as const;
/** Approvals of at least this much are treated as unlimited. */
export const HALF_U64 = 1n << 63n;

/**
 * Rules key on instruction names. For programs Clef bundles a curated IDL for, only that IDL's names count: any
 * other name is treated as undecoded, so it can't pass for (or hide) a known instruction.
 */
function trustedNames(instructions: RiskInput['instructions']): RiskInput['instructions'] {
  return instructions.map((ix) =>
    ix.name !== undefined && BUNDLED_PROGRAM_IDS.has(ix.programId) && ix.idl?.trust !== 'curated' ? { ...ix, name: undefined } : ix,
  );
}

export function evaluateRisks(raw: RiskInput): Warning[] {
  const input: RiskInput = { ...raw, instructions: trustedNames(raw.instructions) };
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
  /**
   * Someone else's business: a single signing key that is not yours (`authorityName`) acts on an account
   * (`subjectName`), and nothing the instruction touches is yours (nor held by you before the transaction).
   * Typical of bundles where several wallets co-sign: your signature authorizes nothing there. Unknown names, a
   * multisig authority (whose signers could include you), or a subject whose pre-state is unknown (it could be
   * yours) never qualify.
   */
  const othersBusiness = (ix: RiskInput['instructions'][number], subjectName: string, authorityName: string) => {
    const authority = account(ix, authorityName);
    const subject = account(ix, subjectName);
    return (
      !!authority?.signer &&
      !!subject &&
      Object.hasOwn(input.accountLamports ?? {}, subject.address) &&
      ix.accounts.every((a) => !a.mine && !me.has(a.address) && !me.has(input.tokenBalances?.[a.address]?.owner ?? ''))
    );
  };

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
    if (isToken(ix.programId) && (ix.name === 'approve' || ix.name === 'approveChecked') && !othersBusiness(ix, 'source', 'owner')) {
      const source = account(ix, 'source');
      const held = source && input.tokenBalances?.[source.address];
      const amount = ix.args?.amount;
      const unlimited = typeof amount !== 'bigint' || amount >= HALF_U64;
      // Unknown balance: assume the approval covers all of it.
      const all = unlimited || held === undefined || amount >= held.amount;
      const danger = all && notMineOrUnknown(account(ix, 'delegate'));
      const whose = source && (source.mine || me.has(source.address) || (held && me.has(held.owner))) ? 'your' : 'a';
      const what = unlimited ? 'an UNLIMITED amount' : all ? 'ALL' : 'some';
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
    if (isToken(ix.programId) && ix.name === 'closeAccount' && notMineOrUnknown(account(ix, 'destination')) && !othersBusiness(ix, 'account', 'owner')) {
      // A wrapped SOL account holds its whole balance as lamports: closing it hands over all of them.
      const closed = account(ix, 'account')?.address;
      const held = closed === undefined ? undefined : input.tokenBalances?.[closed];
      const lamports = closed === undefined ? undefined : input.accountLamports?.[closed];
      const message =
        held && NATIVE_MINTS.has(held.mint)
          ? `Closes a wrapped SOL account and sends its ${lamports === undefined ? 'entire balance' : `${formatUnits(lamports, 9)} SOL`} to an address you do not own.`
          : 'Closes an account and sends its rent to an address you do not own.';
      warn('close-to-third-party', 'danger', message, i);
    }
    if (ix.programId === SYSTEM_PROGRAM && ix.name === 'authorizeNonceAccount') {
      const next = ix.args?.newNonceAuthority;
      if (typeof next !== 'string' || !me.has(next)) {
        warn('authority-change', 'danger', 'Hands control of a durable nonce account to someone else.', i);
      }
    }
    if (ix.programId === STAKE_PROGRAM) {
      for (const [rule, severity, message] of stakeRisks(ix, (a) => a !== undefined && me.has(a))) warn(rule, severity, message, i);
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
      const what = amount >= HALF_U64 ? 'an UNLIMITED amount' : all ? 'ALL' : 'some';
      warn('delegation', all ? 'danger' : 'warn', `Lets a delegate spend ${what} of the tokens in your token account.`, undefined, c.address);
    }
  }

  for (const r of input.relations) {
    if (r.status === 'mismatch') {
      warn('relation-mismatch', 'danger', `Account ${r.from} does not match its expected ${r.label}${r.detail ? ` (${r.detail})` : ''}.`, r.instructionIndex);
    }
  }

  const priority = input.fee !== undefined ? input.fee - (input.baseFee ?? 0n) : 0n;
  if (input.feePayer !== undefined && me.has(input.feePayer) && priority > PRIORITY_FEE_LIMIT) {
    const balance = input.solBalances?.[input.feePayer];
    // Danger: more than 5% of what the payer holds, and more than 0.05 SOL.
    const severity = balance !== undefined && priority * 20n > balance && priority > HIGH_FEE_DANGER ? 'danger' : 'warn';
    warn('high-fee', severity, `Pays a priority fee of ${formatUnits(priority, 9)} SOL.`);
  }

  if (input.issues.some((i) => i.stage === 'execute')) {
    warn('transaction-failed', 'info', 'Transaction failed; only the fee was charged.');
  }

  if (input.balancesChanged) {
    warn('balances-changed', 'warn', 'Your balances changed while Clef was checking; amounts may be overstated.');
  }

  // A simulate issue with balance changes (e.g. computed conservatively) is not a failed simulation.
  if (input.balanceChanges === null && input.issues.some((i) => i.stage === 'simulate')) {
    warn('simulation-failed', 'warn', 'Simulation failed or unavailable: balance changes are unknown.');
  }

  const unexplained = input.instructions.some((ix) => !ix.name && !PLUMBING_PROGRAMS.has(ix.programId));
  if (unexplained && possibleOutflow(input, me)) {
    // An ordinary swap through a router Clef can't decode: about the same value comes back, in SOL or a major
    // stablecoin. Only known balance changes, with a price for everything in and out, can show that.
    if (input.balanceChanges && comparableValueBack(input, me)) {
      warn('unexplained-outflow', 'warn', "Funds leave your wallet through a program Clef can't decode; you receive about the same value back in SOL/major stablecoins.");
    } else {
      warn('unexplained-outflow', 'danger', 'Funds leave your wallet in a transaction Clef cannot fully explain.');
    }
  }

  if (possibleOutflow(input, me)) {
    const selfDescribed = input.instructions.filter((ix) => ix.idl?.trust === 'authority' && !TRUSTED_PROGRAMS.has(ix.programId));
    for (const programId of new Set(selfDescribed.map((ix) => ix.programId))) {
      const name = PROGRAM_NAMES[programId] ?? shortAddress(programId);
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
 * Stake rules. The vendored IDL names only the program's modern account layout; the legacy layout (still
 * accepted, and sent by most clients) puts sysvars (Clock, Rent, ...) before the authorities and shifts every
 * later name. So accounts are read by position, branching on the sysvar the way the program does
 * (program/src/processor.rs at the vendored commit).
 */
function stakeRisks(ix: RiskInput['instructions'][number], mine: (a: string | undefined) => boolean): [string, Warning['severity'], string][] {
  const at = (n: number) => ix.accounts[n]?.address;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const staker = stakeRole(ix.name === 'authorize' ? ix.args?.arg1 : ix.args?.stakeAuthorize) === 'staker';
  // Withdrawer (or an unreadable role) handed over: danger. Only the staker role: it can redelegate or
  // deactivate, not withdraw, so warn.
  const handOff = (to: string | undefined): [string, Warning['severity'], string] =>
    staker
      ? ['stake-delegation-authority', 'warn', `Hands staking control (not withdrawal) of a stake account to ${to ? shortAddress(to) : 'an unknown address'}.`]
      : ['authority-change', 'danger', 'Hands control of a stake account to someone else.'];
  const authorize = (to: string | undefined, extra?: string) =>
    !mine(to) ? [handOff(to)] : extra !== undefined && !mine(extra) ? [handOff(extra)] : [];
  switch (ix.name) {
    case 'authorize':
      return authorize(str(ix.args?.arg0));
    case 'authorizeWithSeed':
      return authorize(str(ix.args?.newAuthorizedPubkey));
    // Legacy: [stake, clock, old, new, custodian?]. Modern: [stake, old, new, custodian?]; there every
    // authority after the old one must be yours too (defense in depth).
    case 'authorizeChecked':
      return at(1) === CLOCK_SYSVAR ? authorize(at(3)) : authorize(at(2), at(3));
    // Legacy: [stake, base, clock, new, custodian?]. Modern: [stake, base, new, custodian?].
    case 'authorizeCheckedWithSeed':
      return at(2) === CLOCK_SYSVAR ? authorize(at(3)) : authorize(at(2), at(3));
    case 'withdraw':
      // [stake, recipient, ...] in both layouts.
      return mine(at(1)) ? [] : [['stake-withdraw', 'danger', 'Withdraws staked SOL to an address you do not own.']];
    case 'initialize':
    case 'initializeChecked': {
      const authorized = ix.args?.arg0 as { staker?: unknown; withdrawer?: unknown } | undefined;
      // initializeChecked: legacy [stake, rent, staker, withdrawer], modern [stake, staker, withdrawer].
      const [stakerKey, withdrawer] =
        ix.name === 'initialize'
          ? [str(authorized?.staker), str(authorized?.withdrawer)]
          : at(1) === RENT_SYSVAR
            ? [at(2), at(3)]
            : [at(1), at(2)];
      if (!mine(withdrawer)) return [['stake-foreign-authority', 'danger', 'Creates a stake account that someone else can withdraw from.']];
      return mine(stakerKey) ? [] : [['stake-foreign-authority', 'warn', 'Creates a stake account whose staking (not withdrawal) someone else controls.']];
    }
    case 'setLockup':
    case 'setLockupChecked': {
      // setLockupChecked: [stake, authority, newCustodian?].
      const custodian = ix.name === 'setLockup' ? authorityArg(ix.args?.custodian) : (at(2) ?? null);
      return custodian === null || mine(custodian)
        ? [['stake-lockup', 'warn', 'Changes the lockup of a stake account.']]
        : [['stake-lockup', 'danger', 'Makes someone else the lockup custodian of a stake account.']];
    }
    default:
      return [];
  }
}

/** The decoded `StakeAuthorize` enum (`{ __kind: 'Staker', __discriminator: 0 }` / Withdrawer, 1); undefined if unreadable. */
export function stakeRole(v: unknown): 'staker' | 'withdrawer' | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const { __kind, __discriminator } = v as { __kind?: unknown; __discriminator?: unknown };
  if (__kind === 'Staker' && __discriminator === 0) return 'staker';
  if (__kind === 'Withdrawer' && __discriminator === 1) return 'withdrawer';
  return undefined;
}

/**
 * A decoded `option<address>` arg: the address, null for None, undefined when the shape is unexpected.
 * Codama decodes options as `{ __option: 'Some', value }` / `{ __option: 'None' }`.
 */
export function authorityArg(v: unknown): string | null | undefined {
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
 * Funds go to wallets that are neither yours nor in your address book, and nothing of value comes back: two or
 * more assets (`sweep`, danger), or (almost) a whole holding (`send-entire-balance`, warn). Judged on balance
 * changes alone, so it holds whichever IDLs decoded the transaction. Deposits into program-owned accounts by a
 * non-core program, and partial single-asset sends, are not flagged.
 */
function sweepWarnings(input: RiskInput, me: ReadonlySet<string>): [string, Warning['severity'], string][] {
  const changes = input.balanceChanges;
  if (!changes) return [];
  const allOut = outflows(input, me);
  // Weighed on the net change of all your wallets: your own churn (unwrapping your wSOL, moving SOL between
  // your wallets) is neither value leaving nor value coming back.
  const valued = (mint: string) => mint in KNOWN_MINTS || !!input.valuedMints?.has(mint);
  const { inflows, outflows: netOut } = netFlows(input, me, valued);
  const priced = isPriced(input, [...netOut, ...inflows]);
  // SOL drawn from another account (your stake, a position) may be your own coming back: never fair then.
  const fairExchange = priced ? !foreignSolSource(input, me) && usdTotal(input, inflows) >= usdTotal(input, netOut) / 2 : undefined;

  // Program-owned (off-curve) recipients are exempt only when reached through a non-core program, which may be
  // depositing into its own vault. Recipients of top-level core transfers are never exempt: a decoy program
  // instruction must not cover for a plain transfer to a PDA.
  const deposits = input.instructions.some((ix) => !CORE_PROGRAMS.has(ix.programId));
  const direct = directRecipients(input);
  // Rent-sized SOL amounts (e.g. a validator tip) don't count as landing on a wallet.
  const toWallet = (c: BalanceChange) =>
    (c.mint === 'SOL' ? c.delta > RENT_SLACK : c.delta > 0n) &&
    !me.has(c.owner) &&
    !input.addressBook?.has(c.owner) &&
    (!deposits || direct.unknown || direct.owners.has(c.owner) || onCurve(c.owner));
  // Wrapped SOL you lose arrives as plain SOL when its account is closed or unwrapped.
  const sameAsset = (c: BalanceChange, mint: string) => c.mint === mint || (c.mint === 'SOL' && NATIVE_MINTS.has(mint));
  const recipient = (mint: string) => changes.find((c) => sameAsset(c, mint) && toWallet(c))?.owner;
  const out = allOut.filter((c) => recipient(c.mint));

  // Without prices, an inflow only vouches for an exchange of one asset: it never offsets two or more other
  // assets leaving (paying back a little of something must not defuse a sweep).
  const sweptAssets = new Set(out.map((c) => c.mint));
  const sweep = priced ? sweptAssets.size >= 2 && !fairExchange : sweptAssets.size >= 2;
  const name = (a: string) => input.labels?.[a] ?? shortAddress(a);
  if (sweep) {
    const to = [...new Set(out.map((c) => recipient(c.mint)!))].map(name).join(', ');
    return [['sweep', 'danger', `Moves several of your assets to ${to} without giving you comparable value back.`]];
  }
  if (priced ? fairExchange : inflows.length > 0) return [];

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
    return ['send-entire-balance', 'warn', `Sends (almost) your entire ${asset} balance to ${name(recipient(c.mint)!)}.`];
  });
}

/** One asset's net change over all your wallets. Wrapped SOL counts as SOL. */
type NetChange = { mint: string; decimals: number | null; delta: bigint };

/**
 * Your net inflows and outflows, one per asset over all your wallets (wrapped SOL as SOL), so that moving your
 * own funds around never counts as value leaving or coming back. Inflows: SOL beyond `RENT_SLACK`, or a token
 * `counts` accepts (an airdrop of an unknown token is free to mint and must not count). Outflows: any token
 * decrease, or a SOL loss beyond the allowed fee (if you pay it) plus `RENT_SLACK`.
 */
function netFlows(input: RiskInput, me: ReadonlySet<string>, counts: (mint: string) => boolean): { inflows: NetChange[]; outflows: NetChange[] } {
  const net = new Map<string, NetChange>();
  for (const c of input.balanceChanges ?? []) {
    if (!me.has(c.owner)) continue;
    const sol = c.mint === 'SOL' || NATIVE_MINTS.has(c.mint);
    const mint = sol ? 'SOL' : c.mint;
    const decimals = sol ? 9 : c.decimals;
    const prev = net.get(mint);
    net.set(mint, prev ? { mint, decimals: prev.decimals === null || decimals === null ? null : prev.decimals, delta: prev.delta + c.delta } : { mint, decimals, delta: c.delta });
  }
  const allowance = (input.feePayer !== undefined && me.has(input.feePayer) ? feeAllowance(input.fee, input.baseFee) : 0n) + RENT_SLACK;
  const all = [...net.values()];
  return {
    inflows: all.filter((n) => (n.mint === 'SOL' ? n.delta > RENT_SLACK : n.delta > 0n && counts(n.mint))),
    outflows: all.filter((n) => (n.mint === 'SOL' ? -n.delta > allowance : n.delta < 0n)),
  };
}

/**
 * USD value of a net change, undefined without a usable price or decimals. A price that isn't a finite positive
 * number (0, negative, Infinity, NaN) counts as missing: it could make a drain look free or a payback look rich.
 */
function usdValue(input: RiskInput, n: NetChange): number | undefined {
  const price = input.prices?.[n.mint];
  if (price === undefined || !Number.isFinite(price) || price <= 0 || n.decimals === null) return undefined;
  return (Math.abs(Number(n.delta)) / 10 ** n.decimals) * price;
}
const isPriced = (input: RiskInput, ns: NetChange[]) => input.prices !== undefined && ns.every((n) => usdValue(input, n) !== undefined);
const usdTotal = (input: RiskInput, ns: NetChange[]) => ns.reduce((total, n) => total + usdValue(input, n)!, 0);

/** A System-owned durable nonce account's data size. */
const NONCE_ACCOUNT_SIZE = 80;

/**
 * Whether SOL may be flowing out of an account you plausibly control without it being yours by `me`: a Stake or
 * Vote account, a durable nonce account, or another System-owned keypair that signs this transaction. SOL
 * arriving in your wallet may then be your own funds (e.g. a stake withdrawal), not value given back for what
 * leaves. A loss within `RENT_SLACK` (plus the allowed fee, for the fee payer) is ignored.
 *
 * Without `accountInfo`, or for an account missing from it, any non-`me` account counts (fail safe). AMM and
 * bonding-curve PDAs owned by other programs pay SOL legitimately, so they don't count.
 *
 * Known gap: a withdrawal from your own position held in a program-owned account (e.g. a lending deposit) looks
 * like a program paying you, so it can still count as value coming back.
 *
 * Read from the balance changes: a non-token account's SOL change is keyed by its own address; a token
 * account's rent is keyed by its owner, and stays within `RENT_SLACK`.
 */
function foreignSolSource(input: RiskInput, me: ReadonlySet<string>): boolean {
  const allowance = (owner: string) => (owner === input.feePayer ? feeAllowance(input.fee, input.baseFee) : 0n) + RENT_SLACK;
  const plausiblyYours = (address: string) => {
    const info = input.accountInfo && (Object.hasOwn(input.accountInfo, address) ? input.accountInfo[address] : undefined);
    if (!info) return true;
    if (info.owner === STAKE_PROGRAM || info.owner === VOTE_PROGRAM) return true;
    return info.owner === SYSTEM_PROGRAM && (info.dataLength === NONCE_ACCOUNT_SIZE || info.signer);
  };
  return (input.balanceChanges ?? []).some(
    (c) => c.mint === 'SOL' && !me.has(c.owner) && -c.delta > allowance(c.owner) && plausiblyYours(c.owner),
  );
}

/** At least this share of what leaves must come back for an undecodable outflow to be only a warning. */
const COMPARABLE_VALUE = 0.9;

/**
 * Whether what leaves your wallets comes back as about the same value (`COMPARABLE_VALUE`), counting only SOL
 * and `KNOWN_MINTS` (never tokens priced or valued by the caller: those are the easiest to fake), with a price
 * for everything in and out.
 */
function comparableValueBack(input: RiskInput, me: ReadonlySet<string>): boolean {
  const { inflows, outflows: out } = netFlows(input, me, (mint) => mint in KNOWN_MINTS);
  if (!inflows.length || !out.length || !isPriced(input, [...inflows, ...out])) return false;
  if (foreignSolSource(input, me)) return false;
  return usdTotal(input, inflows) >= usdTotal(input, out) * COMPARABLE_VALUE;
}

const TOKEN_TRANSFERS: ReadonlySet<string> = new Set(['transfer', 'transferChecked', 'transferCheckedWithFee']);

/**
 * Who top-level core transfers pay: SOL destinations, and the owners of token destinations (from pre-state
 * `tokenBalances` or `postTokenOwners`). `unknown` when some token destination's owner can't be resolved.
 */
function directRecipients(input: RiskInput): { owners: Set<string>; unknown: boolean } {
  const owners = new Set<string>();
  let unknown = false;
  for (const ix of input.instructions) {
    if (ix.programId === SYSTEM_PROGRAM && (ix.name === 'transferSol' || ix.name === 'transferSolWithSeed')) {
      // By name, else by the IDL position: [source, destination] / [source, base, destination].
      const destination = account(ix, 'destination')?.address ?? ix.accounts[ix.name === 'transferSol' ? 1 : 2]?.address;
      if (destination) owners.add(destination);
      else unknown = true;
    }
    if (isToken(ix.programId) && ix.name !== undefined && TOKEN_TRANSFERS.has(ix.name)) {
      // [source, destination, authority] / [source, mint, destination, authority] (Checked and CheckedWithFee).
      const destination = account(ix, 'destination')?.address ?? ix.accounts[ix.name === 'transfer' ? 1 : 2]?.address;
      const owner = destination && (input.tokenBalances?.[destination]?.owner ?? input.postTokenOwners?.[destination]);
      if (owner) owners.add(owner);
      else unknown = true;
    }
  }
  return { owners, unknown };
}

/** Your outflows: any token decrease, or a SOL loss beyond the allowed fee (if you pay it) plus `RENT_SLACK`. */
function outflows(input: RiskInput, me: ReadonlySet<string>): BalanceChange[] {
  const allowance = (owner: string) => (owner === input.feePayer ? feeAllowance(input.fee, input.baseFee) : 0n) + RENT_SLACK;
  return (input.balanceChanges ?? []).filter(
    (c) => me.has(c.owner) && (c.mint === 'SOL' ? -c.delta > allowance(c.owner) : c.delta < 0n),
  );
}

/** Unknown balance changes (no meta, no successful simulation) count as a possible outflow. */
const possibleOutflow = (input: RiskInput, me: ReadonlySet<string>) =>
  input.balanceChanges === null || outflows(input, me).length > 0;
