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
   * when `err` is set, the entries carry no meaning.
   */
  postAccounts: (RawAccount | null)[];
};

/** Every chain read the engine performs goes through this interface (live, recorded, or replayed). */
export interface ChainReader {
  getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
  simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult>;
}
