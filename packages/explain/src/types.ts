import type { ChainReader } from '@clef/rpc';
import type { IdlResolver, IdlSourceKind, TrustTier } from '@clef/idl';
import type { Address } from '@solana/kit';

export type DetailLevel = 'basic' | 'intermediate' | 'expert';
export type Severity = 'info' | 'warn' | 'danger';

export type Issue = {
  stage: 'decode' | 'idl' | 'parse' | 'relations' | 'simulate';
  message: string;
  instructionIndex?: number;
};

export type Warning = { rule: string; severity: Severity; message: string; instructionIndex?: number };

export type AccountRef = { address: Address; signer: boolean; writable: boolean; lookupTable?: Address };

export type DecodedInstruction = { index: number; programId: Address; accounts: AccountRef[]; data: Uint8Array };

export type DecodedTransaction = {
  version: 'legacy' | 0;
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
};
