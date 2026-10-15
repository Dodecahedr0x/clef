import type { Address } from '@solana/kit';
import { fromJson, toJson } from './serde';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult } from './types';

export type FixtureFile = { version: 1; input?: unknown; calls: Record<string, unknown> };

export function callKey(method: string, args: unknown[]): string {
  return `${method}:${toJson(args)}`;
}

/** Wraps a live reader and remembers every response so it can be replayed offline. */
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

  getTransaction(signature: string) {
    return this.record('getTransaction', [signature], () => this.inner.getTransaction(signature));
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]) {
    return this.record('simulate', [wire, addresses], () => this.inner.simulate(wire, addresses));
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

  getTransaction(signature: string) {
    return this.lookup<FetchedTransaction | null>('getTransaction', [signature]);
  }

  simulate(wire: Uint8Array, addresses: readonly Address[]) {
    return this.lookup<SimulationResult>('simulate', [wire, addresses]);
  }
}
