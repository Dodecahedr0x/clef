import type { Address } from '@solana/kit';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult } from './types';

type AccountInput = Omit<RawAccount, 'executable' | 'lamports'> & Partial<Pick<RawAccount, 'executable' | 'lamports'>>;

/** In-memory chain for unit tests. Simulation defaults to "nothing changes". */
export class MemoryChainReader implements ChainReader {
  readonly accounts = new Map<string, RawAccount>();
  readonly transactions = new Map<string, FetchedTransaction>();
  simulateImpl: (wire: Uint8Array, addresses: readonly Address[]) => Promise<SimulationResult> = async (
    _wire,
    addresses,
  ) => ({
    err: null,
    logs: [],
    unitsConsumed: null,
    postAccounts: addresses.map((a) => this.accounts.get(a) ?? null),
  });

  setAccount(input: AccountInput): void {
    this.accounts.set(input.address, {
      ...input,
      lamports: input.lamports ?? 1_000_000n,
      executable: input.executable ?? false,
    });
  }

  async getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]> {
    return addresses.map((a) => structuredClone(this.accounts.get(a) ?? null));
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    return structuredClone(this.transactions.get(signature) ?? null);
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult> {
    return this.simulateImpl(wire, addresses);
  }
}
