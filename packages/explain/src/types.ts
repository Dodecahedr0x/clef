import type { ChainReader } from '@clef/rpc';
import type { IdlResolver, IdlSourceKind, TrustTier } from '@clef/idl';
import type { Address } from '@solana/kit';
import type { StateChange } from './state-changes';

export type DetailLevel = 'basic' | 'intermediate' | 'expert';
export type Severity = 'info' | 'warn' | 'danger';

export type Issue = {
  /** `execute`: the transaction itself failed on chain (from its meta). */
  stage: 'decode' | 'idl' | 'parse' | 'relations' | 'simulate' | 'execute';
  message: string;
  instructionIndex?: number;
};

export type Warning = { rule: string; severity: Severity; message: string; instructionIndex?: number };

export type AccountRef = { address: Address; signer: boolean; writable: boolean; lookupTable?: Address };

export type DecodedInstruction = { index: number; programId: Address; accounts: AccountRef[]; data: Uint8Array };

/**
 * A v1 transaction's config (SIMD-0385): protocol fields read straight from the message. Unlike legacy and v0,
 * the priority fee is a total in lamports, and an absent compute unit limit or loaded accounts data size limit
 * means zero, not a default.
 */
export type V1Config = {
  priorityFeeLamports?: bigint;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
  heapSize?: number;
};

export type DecodedTransaction = {
  version: 'legacy' | 0 | 1;
  /** v1 only. */
  config?: V1Config;
  feePayer: Address;
  recentBlockhash: string;
  accounts: AccountRef[];
  instructions: DecodedInstruction[];
  wire: Uint8Array;
};

export type NamedAccount = AccountRef & { name?: string; label?: string; mine: boolean };

export type ExplainedInstruction = {
  index: number;
  programId: Address;
  programName?: string;
  /** The program's name in the user's address book (their own label, trusted), unless Clef's registry names it. */
  programLabel?: string;
  /** Undefined when no IDL could decode the instruction. */
  name?: string;
  args?: Record<string, unknown>;
  idl?: { source: IdlSourceKind; trust: TrustTier; hash: string };
  accounts: NamedAccount[];
  data: Uint8Array;
  /** How to format an `amount` argument, when known. */
  amountUnit?: { symbol: string; decimals: number };
};

export type SeedInfo = { kind: 'const' | 'account' | 'arg'; display: string };

export type RelationEdge = {
  kind: 'pda' | 'has_one' | 'token-owner' | 'token-mint' | 'ata';
  /** The account the fact is about. */
  from: Address;
  /** The related account (owner, mint, holder, or deriving program). */
  to: Address;
  label: string;
  status: 'verified' | 'mismatch' | 'unverified';
  detail?: string;
  instructionIndex?: number;
  seeds?: SeedInfo[];
  bump?: number;
};

export type BalanceChange = {
  owner: Address;
  mint: Address | 'SOL';
  symbol?: string;
  /** Null when the mint's decimals are unknown. */
  decimals: number | null;
  delta: bigint;
};

export type ExplainedTransaction = {
  tx: DecodedTransaction;
  instructions: ExplainedInstruction[];
  relations: RelationEdge[];
  /** Null when neither tx meta nor a successful simulation was available. */
  balanceChanges: BalanceChange[] | null;
  /** Authority changes seen in simulated pre/post state; null without a successful simulation (e.g. tx meta). */
  stateChanges: StateChange[] | null;
  /** Network fee in lamports: from tx meta, else estimated; null when it can't be estimated. */
  fee: bigint | null;
  me: Address[];
  summary: string;
  warnings: Warning[];
  issues: Issue[];
};

export type ExplainContext = {
  reader: ChainReader;
  idls: IdlResolver;
  /** Addresses that belong to the user. */
  me: readonly Address[];
  addressBook?: Readonly<Record<string, string>>;
  /** USD per whole unit, keyed by mint or 'SOL': lets the sweep rule weigh what comes back. */
  prices?: Readonly<Record<string, number>>;
  /** Mints the user values besides Clef's known ones: receiving them counts as an inflow. */
  valuedMints?: ReadonlySet<string>;
};
