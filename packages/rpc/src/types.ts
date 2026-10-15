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

/** Every chain read the engine performs goes through this interface (live, recorded, or replayed). */
export interface ChainReader {
  getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]>;
  /** Optional: `getAccounts` plus the (highest) slot the reads were served at. */
  getAccountsWithSlot?(addresses: readonly Address[], options?: ReadOptions): Promise<{ accounts: (RawAccount | null)[]; slot: bigint }>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
  simulate(wire: Uint8Array, addresses: readonly Address[], options?: SimulateOptions): Promise<SimulationResult>;
}
