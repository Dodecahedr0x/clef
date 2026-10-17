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

export type Warning = {
  rule: string;
  severity: Severity;
  message: string;
  instructionIndex?: number;
  /** The program a decode warning is about, so the UI can offer to add its IDL. */
  programId?: Address;
  /** Why, in a few plain lines, for the UI to show on demand. */
  details?: string[];
};

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
  /** IDLs that exist for the program but declare no instruction matching this one (names sanitized, bounded). */
  idlMismatch?: { source: IdlSourceKind; programName: string; instructions: string[] }[];
};

export type SeedInfo = { kind: 'const' | 'account' | 'arg'; display: string };

export type RelationKind = 'pda' | 'has_one' | 'token-owner' | 'token-mint' | 'ata'
  | 'program-owner' | 'ata-derivation' | 'mint-authority' | 'freeze-authority' | 'delegate' | 'close-authority'
  /** A program account whose data holds another key of the transaction. */
  | 'data-ref';

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
  /** Not the PDA the IDL describes, yet controlled by the same program (another instance of it?): unconfirmed. */
  unconfirmed?: true;
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

/**
 * Value the transaction moves between two accounts, from System and Token instructions, top-level or invoked by
 * a program (CPI; only when the RPC returns inner instructions). `create`: lamports funding a new account.
 * `mint` goes from the mint to the token account, `burn` from the token account to the mint.
 */
export type Transfer = {
  kind: 'sol' | 'create' | 'token' | 'mint' | 'burn';
  from: Address;
  to: Address;
  mint: Address | 'SOL';
  amount: bigint;
  symbol?: string;
  /** Null when the mint's decimals are unknown. */
  decimals: number | null;
  /** 0-based top-level instruction. */
  instructionIndex: number;
  /** Made by a program the instruction invoked, not by the instruction itself. */
  inner: boolean;
  /** `create`: the new account's owner program and size. */
  owner?: Address;
  space?: number;
};

/** What Clef knows of one account of the transaction, before and after it. */
export type AccountFact = {
  address: Address;
  /**
   * Its owner program: after the transaction when the transaction creates it, else before. For a landed
   * transaction (meta), today's owner (`ownerNow`), since the meta doesn't record owners.
   */
  owner: Address | null;
  ownerNow?: true;
  executable: boolean;
  /** Bytes of data, same rule as `owner`; null when unknown. */
  dataLength: number | null;
  /** Null when unknown (account not loaded, or no simulation). */
  lamports: { before: bigint | null; after: bigint | null };
  /** `missing`: does not exist before, and nothing says it does after. */
  lifecycle: 'created' | 'closed' | 'existing' | 'missing';
  token?: { mint: Address; holder: Address; symbol?: string; decimals: number | null; before: bigint | null; after: bigint | null };
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
  /** Every account of the transaction, in key order. */
  accountFacts: AccountFact[];
  /** Null when not known: no meta and no successful simulation (or the transaction failed). */
  transfers: Transfer[] | null;
  /** The RPC returned no inner instructions: `transfers` lists only those the instructions make themselves. */
  transfersPartial?: true;
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
