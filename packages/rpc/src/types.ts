import type { Address } from '@solana/kit';

export type RawAccount = {
  address: Address;
  owner: Address;
  lamports: bigint;
  data: Uint8Array;
  executable: boolean;
};

export type TokenBalance = {
  accountIndex: number;
  mint: Address;
  owner: Address | null;
  amount: bigint;
  decimals: number;
};

export type TxMeta = {
  err: unknown;
  fee: bigint;
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  loadedAddresses: { writable: Address[]; readonly: Address[] };
  logMessages: string[];
  /** Compute units the transaction used (absent from old RPC responses and fixtures). */
  computeUnitsConsumed?: bigint | null;
};

export type FetchedTransaction = {
  wire: Uint8Array;
  meta: TxMeta | null;
  slot: bigint;
  blockTime: bigint | null;
};

export type SimulationResult = {
  err: unknown;
  logs: string[];
  unitsConsumed: bigint | null;
  /**
   * Post-simulation state, same order as the `addresses` passed to `simulate`.
   * Always the same length as `addresses`. Entries are null when the account does not exist;
   * when `err` is set, the entries carry no meaning. The fee payer's lamports are assumed to already have the
   * transaction fee deducted (as the runtime does): the explain engine allows for the fee when judging outflows.
   */
  postAccounts: (RawAccount | null)[];
  /** The slot the simulation ran at, when the reader reports it. */
  slot?: bigint;
};

export type SimulateOptions = {
  /** Simulate against state no older than this slot (e.g. the slot the pre-state was read at). */
  minContextSlot?: bigint;
};

export type ReadOptions = {
  /** Read state no older than this slot (e.g. the slot a simulation ran at). */
  minContextSlot?: bigint;
};

/** The RPC does not offer `method` (HTTP 410, JSON-RPC -32601, or no DAS). */
export class UnsupportedMethodError extends Error {
  constructor(readonly method: string) {
    super(`RPC method not supported: ${method}`);
    this.name = 'UnsupportedMethodError';
  }
}

/**
 * One result per input transaction, simulated in order on accumulated state. `pre` is the state of each
 * transaction's `addresses` right before it ran. After a failure at `failedIndex`, later results are null.
 */
export type SequenceResult = {
  results: ((SimulationResult & { pre: (RawAccount | null)[] }) | null)[];
  failedIndex: number | null;
  slot?: bigint;
};

/** Every chain read the engine performs goes through this interface (live, recorded, or replayed). */
export interface ChainReader {
  getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]>;
  /** Optional: `getAccounts` plus the (highest) slot the reads were served at. */
  getAccountsWithSlot?(addresses: readonly Address[], options?: ReadOptions): Promise<{ accounts: (RawAccount | null)[]; slot: bigint }>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
  simulate(wire: Uint8Array, addresses: readonly Address[], options?: SimulateOptions): Promise<SimulationResult>;
  /** Optional: simulate `wires` in order on one state. Throws `UnsupportedMethodError` when the RPC cannot. */
  simulateSequence?(wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[], options?: SimulateOptions): Promise<SequenceResult>;
}
