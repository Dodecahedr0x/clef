import type { PhishingHit, PhishingList } from '@clef/wallet-core';

export const PHISHING_ALARM = 'clef-phishing-refresh';
export const PHISHING_STORAGE_KEY = 'phishing:list';
const DAY_MINUTES = 24 * 60;
const MAX_LIST_BYTES = 32 * 1024 * 1024;

export type PhishingGuardDeps = {
  /** The bundled snapshot (raw config JSON). */
  snapshot: () => unknown;
  parse: (json: unknown) => PhishingList;
  detector: (list: PhishingList) => { check(hostname: string): PhishingHit | null };
  store: { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T): Promise<void> };
  fetch: typeof fetch;
  url: string;
  now: () => number;
};

export interface PhishingAlarms {
  get(name: string): Promise<unknown>;
  create(name: string, info: { delayInMinutes: number; periodInMinutes: number }): Promise<void> | void;
  onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
}

/**
 * The phishing list for dApp origins: the bundled snapshot, replaced by a newer validated copy from storage or
 * from the daily refresh. The list is data only; matching is wallet-core's PhishingDetector.
 */
export class PhishingGuard {
  readonly ready: Promise<void>;
  private list!: PhishingList;
  private detector!: { check(hostname: string): PhishingHit | null };

  constructor(private readonly deps: PhishingGuardDeps) {
    const snapshot = deps.snapshot() as { fetchedAt?: unknown };
    // fetchedAt is ours, not parse's: a stored list wins only if downloaded after the snapshot was taken.
    this.use({ ...deps.parse(snapshot), fetchedAt: Number(snapshot.fetchedAt) || 0 });
    this.ready = this.loadStored();
  }

  private use(list: PhishingList): void {
    this.detector = this.deps.detector(list);
    this.list = list;
  }

  private async loadStored(): Promise<void> {
    try {
      const stored = await this.deps.store.get<PhishingList>(PHISHING_STORAGE_KEY);
      if (!stored) return;
      const list = { ...this.deps.parse(stored), fetchedAt: Number(stored.fetchedAt) || 0 };
      if (list.fetchedAt > this.list.fetchedAt) this.use(list);
    } catch {
      // corrupt copy: keep the snapshot; the next refresh overwrites it
    }
  }

  /** Only web origins are checked; the wallet's own origin (clef://wallet) never is. */
  checkOrigin(origin: string): PhishingHit | null {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return this.detector.check(url.hostname);
  }

  status(): { version: number; fetchedAt: number; domains: number } {
    return { version: this.list.version, fetchedAt: this.list.fetchedAt, domains: this.list.blacklist.length + this.list.fuzzylist.length };
  }

  /** Throws (keeping the current list) unless the download is a valid config. */
  async refresh(): Promise<void> {
    const res = await this.deps.fetch(this.deps.url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!res.ok) throw new Error(`Phishing list download failed (${res.status})`);
    const text = await res.text();
    if (text.length > MAX_LIST_BYTES) throw new Error('Phishing list too large');
    const list = { ...this.deps.parse(JSON.parse(text)), fetchedAt: this.deps.now() };
    await this.ready;
    this.use(list);
    await this.deps.store.set(PHISHING_STORAGE_KEY, list);
  }

  /** The alarm survives service-worker restarts; create it once, re-attach the listener every start. */
  async schedule(alarms: PhishingAlarms, onError: (e: unknown) => void): Promise<void> {
    alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === PHISHING_ALARM) this.refresh().catch(onError);
    });
    if (!(await alarms.get(PHISHING_ALARM))) await alarms.create(PHISHING_ALARM, { delayInMinutes: 1, periodInMinutes: DAY_MINUTES });
  }
}
