import type { DetailLevel } from '@clef/explain';
import { sanitizeText } from '@clef/explain';
import type { KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';
import type { ApprovalRequest } from './service';

export type RequestLogEntry = {
  id: string;
  at: number;
  origin: string;
  kind: ApprovalRequest['kind'];
  outcome: 'approved' | 'rejected' | 'blocked' | 'failed';
  account?: Address;
  summary: string;
  dangerRules: string[];
  signatures?: string[];
  snapshot?: { level: DetailLevel; summary: string; balanceChanges: { owner: string; asset: string; amount: string; /** 'SOL' or the token's mint; older entries lack it. */ mint?: string }[] | null };
};

export const REQUEST_LOG_MAX = 500;
const KEY = 'requestLog';

/** Local history of dApp requests, newest first, capped at REQUEST_LOG_MAX. */
export class RequestLog {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly store: KeyValueStore,
    opts: { now?: () => number; id?: () => string } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.id = opts.id ?? (() => crypto.randomUUID());
  }

  async add(e: Omit<RequestLogEntry, 'id' | 'at'>): Promise<RequestLogEntry> {
    const entry: RequestLogEntry = { ...e, id: this.id(), at: this.now(), summary: sanitizeText(e.summary, 200) };
    await this.store.set(KEY, [entry, ...(await this.list())].slice(0, REQUEST_LOG_MAX));
    return entry;
  }

  async list(limit?: number): Promise<RequestLogEntry[]> {
    const all = (await this.store.get<RequestLogEntry[]>(KEY)) ?? [];
    return limit === undefined ? all : all.slice(0, Math.max(0, limit));
  }

  async clear(): Promise<void> {
    await this.store.remove(KEY);
  }
}
