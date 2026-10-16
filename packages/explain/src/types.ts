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
 * A v1 transaction's config (SIMD-0385): protocol fields read straight from the message header, trusted as
 * such. Each field is present only when its mask bit is set. Unset means: no priority fee; a compute unit limit
 * and a loaded accounts data size limit of 0 (not a default: such a transaction fails if it needs any); a 32 KiB
 * heap. The priority fee is a total in lamports, not a price per compute unit. Compute budget instructions in a
 * v1 transaction are ignored for all of these. Decoding rejects unknown mask bits, a lone priority fee bit, and
 * a heap size outside 32-256 KiB or not a multiple of 1 KiB.
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

export type RelationKind = 'pda' | 'has_one' | 'token-owner' | 'token-mint' | 'ata'
  | 'program-owner' | 'ata-derivation' | 'mint-authority' | 'freeze-authority' | 'delegate' | 'close-authority';

export type RelationEdge = {
  kind: RelationKind;
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
  /** A fact from on-chain state reaching outside the transaction's keys (program owner, authorities, ...). */
  external: boolean;
};

/** Diff values are strings: raw integers with `_` thousands separators, addresses in full. */
export type FieldChange = { path: string; before: string | null; after: string | null; note?: string };
/** Lowercase hex, space-separated bytes, at most 16 bytes per entry. */
export type ByteChange = { offset: number; before: string; after: string };
export type AccountDiff = {
  address: Address;
  /** e.g. 'Your USDC account', 'You · Main', a trusted label, else the short address. */
  title: string;
  mine: boolean;
  lifecycle: 'created' | 'closed' | 'modified';
  owner: { before: Address | null; after: Address | null };
  lamports: { before: bigint; after: bigint };
  decoded: { by: 'system' | 'token' | 'idl'; type: string; changed: FieldChange[]; context: FieldChange[] } | null;
  /** Non-null iff `decoded` is null and the data changed. */
  raw: { size: { before: number; after: number }; changes: ByteChange[]; changedBytes: number } | null;
  undecodedReason?: string;
  /** Batch combined view: 0-based index of the last step that changed it. */
  lastChangedBy?: number;
};
export type LogKind = 'invoke' | 'success' | 'failed' | 'log' | 'data' | 'consumed' | 'return' | 'other';
export type LogLine = {
  depth: number;
  kind: LogKind;
  text: string;
  programId?: Address;
  programName?: string;
  computeUnits?: { consumed: number; budget: number };
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
  /** Null without a successful simulation (and on the meta path). */
  accountDiffs: AccountDiff[] | null;
  /** From the simulation or `meta.logMessages`. */
  logs: LogLine[] | null;
  computeUnits: bigint | null;
  /** Edges with `external: true`: targets outside the transaction's keys. */
  externalRelations: RelationEdge[];
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
