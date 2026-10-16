import type { Address } from '@solana/kit';
import { fromJson, toJson } from './serde';
import {
  UnsupportedMethodError,
  type ChainReader,
  type FetchedTransaction,
  type RawAccount,
  type ReadOptions,
  type SequenceResult,
  type SimulateOptions,
  type SimulationResult,
} from './types';

const UNSUPPORTED = '$unsupported';

export type FixtureFile = { version: 1; input?: unknown; calls: Record<string, unknown> };

export function callKey(method: string, args: unknown[]): string {
  return `${method}:${toJson(args)}`;
}

/**
 * Wraps a live reader and remembers every response so it can be replayed offline. Keys are the method and its
 * request arguments only: freshness options (`minContextSlot`) are passed through to the live reader but left out
 * of the key, so a replay matches whatever slots it asks for.
 */
export class RecordingChainReader implements ChainReader {
  readonly calls: Record<string, unknown> = {};

  constructor(private readonly inner: ChainReader) {}

  private async record<T>(method: string, args: unknown[], run: () => Promise<T>): Promise<T> {
    const result = await run();
    this.calls[callKey(method, args)] = structuredClone(result);
    return result;
  }

  getAccounts(addresses: readonly Address[]) {
    return this.record('getAccounts', [addresses], () => this.inner.getAccounts(addresses));
  }

  /** Readers without slots report slot 0 (no freshness constraint). */
  getAccountsWithSlot(addresses: readonly Address[], options?: ReadOptions) {
    return this.record('getAccountsWithSlot', [addresses], async () =>
      this.inner.getAccountsWithSlot
        ? this.inner.getAccountsWithSlot(addresses, options)
        : { accounts: await this.inner.getAccounts(addresses), slot: 0n },
    );
  }

  getTransaction(signature: string) {
    return this.record('getTransaction', [signature], () => this.inner.getTransaction(signature));
  }

  simulate(wire: Uint8Array, addresses: readonly Address[], options?: SimulateOptions) {
    return this.record('simulate', [wire, addresses], () => this.inner.simulate(wire, addresses, options));
  }

  /** An `UnsupportedMethodError` (including an inner reader without the method) is recorded and replayed. */
  async simulateSequence(wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[], options?: SimulateOptions) {
    const key = callKey('simulateSequence', [wires, addresses]);
    try {
      if (!this.inner.simulateSequence) throw new UnsupportedMethodError('simulateSequence');
      const result = await this.inner.simulateSequence(wires, addresses, options);
      this.calls[key] = structuredClone(result);
      return result;
    } catch (e) {
      if (e instanceof UnsupportedMethodError) this.calls[key] = { [UNSUPPORTED]: e.method };
      throw e;
    }
  }

  toFixture(input?: unknown): string {
    const file: FixtureFile = { version: 1, input, calls: this.calls };
    return toJson(file, 1);
  }
}

/** Replays a recorded fixture; any request that was not recorded throws. */
export class FixtureChainReader implements ChainReader {
  constructor(private readonly fixture: FixtureFile) {}

  static fromJson(text: string): FixtureChainReader {
    const file = fromJson(text) as Partial<FixtureFile> | null;
    if (file?.version !== 1) throw new Error(`unsupported fixture version: ${String(file?.version)}`);
    if (!file.calls || typeof file.calls !== 'object' || Array.isArray(file.calls)) {
      throw new Error('invalid fixture: `calls` must be an object');
    }
    return new FixtureChainReader(file as FixtureFile);
  }

  get input(): unknown {
    return this.fixture.input;
  }

  private lookup<T>(method: string, args: unknown[]): Promise<T> {
    const key = callKey(method, args);
    if (!Object.hasOwn(this.fixture.calls, key)) {
      return Promise.reject(new Error(`fixture miss: ${key.slice(0, 200)}`));
    }
    return Promise.resolve(structuredClone(this.fixture.calls[key]) as T);
  }

  getAccounts(addresses: readonly Address[]) {
    return this.lookup<(RawAccount | null)[]>('getAccounts', [addresses]);
  }

  /** `options` are ignored: see `RecordingChainReader`. */
  getAccountsWithSlot(addresses: readonly Address[], _options?: ReadOptions) {
    return this.lookup<{ accounts: (RawAccount | null)[]; slot: bigint }>('getAccountsWithSlot', [addresses]);
  }

  getTransaction(signature: string) {
    return this.lookup<FetchedTransaction | null>('getTransaction', [signature]);
  }

  simulate(wire: Uint8Array, addresses: readonly Address[], _options?: SimulateOptions) {
    return this.lookup<SimulationResult>('simulate', [wire, addresses]);
  }

  /** Fixtures recorded without any sequence call replay as an RPC without `simulateBundle`. */
  async simulateSequence(wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[], _options?: SimulateOptions) {
    if (!Object.keys(this.fixture.calls).some((k) => k.startsWith('simulateSequence:'))) {
      throw new UnsupportedMethodError('simulateSequence');
    }
    const value = await this.lookup<SequenceResult | { [UNSUPPORTED]: string }>('simulateSequence', [wires, addresses]);
    if (UNSUPPORTED in value) throw new UnsupportedMethodError(value[UNSUPPORTED]);
    return value;
  }
}
