import type { Address } from '@solana/kit';
import { UnsupportedMethodError, type ChainReader, type FetchedTransaction, type RawAccount, type SequenceResult, type SimulationResult } from './types';

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

  /**
   * Default: runs `simulateImpl` per transaction, reporting each one's `pre` from the state the earlier ones
   * left (their `postAccounts`), stopping at the first error. Set to null to act like an RPC without bundles.
   */
  simulateSequenceImpl: ((wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[]) => Promise<SequenceResult>) | null =
    async (wires, addresses) => {
      const overlay = new Map<string, RawAccount | null>();
      const results: SequenceResult['results'] = [];
      let failedIndex: number | null = null;
      for (let i = 0; i < wires.length; i++) {
        const keys = addresses[i] ?? [];
        if (failedIndex !== null) {
          results.push(null);
          continue;
        }
        const pre = keys.map((a) => structuredClone(overlay.has(a) ? overlay.get(a)! : (this.accounts.get(a) ?? null)));
        const sim = await this.simulateImpl(wires[i]!, keys);
        results.push({ ...sim, pre });
        if (sim.err !== null && sim.err !== undefined) failedIndex = i;
        else keys.forEach((a, j) => overlay.set(a, sim.postAccounts[j] ?? null));
      }
      return { results, failedIndex };
    };

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

  simulateSequence(wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[]): Promise<SequenceResult> {
    if (!this.simulateSequenceImpl) return Promise.reject(new UnsupportedMethodError('simulateSequence'));
    return this.simulateSequenceImpl(wires, addresses);
  }
}
