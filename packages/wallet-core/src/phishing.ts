import type { KeyValueStore } from '@clef/vault';
// Regenerate the bundled snapshot (from the repo root):
//   curl -sSfL https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json \
//     | jq -c --argjson t "$(($(date +%s)*1000))" '{version,tolerance,fuzzylist,whitelist,blacklist,fetchedAt:$t}' \
//     > packages/wallet-core/data/phishing-snapshot.json
import snapshot from '../data/phishing-snapshot.json';

export type PhishingHit = { reason: 'blocklist' | 'fuzzy'; match: string };
export type PhishingList = { version: number; tolerance: number; fuzzylist: string[]; whitelist: string[]; blacklist: string[]; fetchedAt: number };

export const PHISHING_LIST_URL = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json';

const KEY = 'phishingList';
const MAX_DOMAIN = 253;
const MAX_TOLERANCE = 3;

function domains(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Phishing list: ${field} is not an array`);
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const d = v.trim().toLowerCase().replace(/\.$/, '');
    if (d && d.length <= MAX_DOMAIN) out.push(d);
  }
  return out;
}

/** Validates an eth-phishing-detect config (or a stored PhishingList). Untrusted data: never evaluated. */
export function parsePhishingConfig(json: unknown, fetchedAt: number = Date.now()): PhishingList {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('Phishing list: not an object');
  const o = json as Record<string, unknown>;
  if (typeof o.version !== 'number' || !Number.isFinite(o.version)) throw new Error('Phishing list: bad version');
  if (typeof o.tolerance !== 'number' || !Number.isInteger(o.tolerance) || o.tolerance < 0 || o.tolerance > MAX_TOLERANCE)
    throw new Error('Phishing list: bad tolerance');
  return {
    version: o.version,
    tolerance: o.tolerance,
    fuzzylist: domains(o.fuzzylist, 'fuzzylist'),
    whitelist: domains(o.whitelist, 'whitelist'),
    blacklist: domains(o.blacklist, 'blacklist'),
    fetchedAt,
  };
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function normalizeHost(hostname: string): string | null {
  let h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.startsWith('[') || h.includes(':')) return null;
  try {
    h = new URL(`http://${h}`).hostname;
  } catch {
    return null;
  }
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost')) return null;
  if (/^\d+(\.\d+){3}$/.test(h)) return null;
  return h;
}

/** MetaMask eth-phishing-detect semantics: whitelist wins, then blacklist (host or parent), then fuzzy on the last two labels. */
export class PhishingDetector {
  private readonly white: Set<string>;
  private readonly black: Set<string>;

  constructor(private readonly list: PhishingList) {
    this.white = new Set(list.whitelist);
    this.black = new Set(list.blacklist);
  }

  check(hostname: string): PhishingHit | null {
    const host = normalizeHost(hostname);
    if (!host) return null;
    const labels = host.split('.');
    const suffixes: string[] = [];
    for (let i = 0; i < labels.length - 1; i++) suffixes.push(labels.slice(i).join('.'));
    if (suffixes.some((s) => this.white.has(s))) return null;
    const blocked = suffixes.find((s) => this.black.has(s));
    if (blocked) return { reason: 'blocklist', match: blocked };
    const base = labels.slice(-2).join('.');
    for (const entry of this.list.fuzzylist) {
      const d = levenshtein(base, entry, this.list.tolerance);
      if (d !== 0 && d <= this.list.tolerance) return { reason: 'fuzzy', match: entry };
    }
    return null;
  }

  size(): number {
    return this.list.blacklist.length + this.list.fuzzylist.length;
  }
}

export const BUNDLED_PHISHING_LIST: PhishingList = parsePhishingConfig(snapshot, snapshot.fetchedAt);

/** Bundled snapshot plus a refreshable copy in storage; the newer one is used. */
export class PhishingListStore {
  private readonly store: KeyValueStore;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly bundled: PhishingList;
  private current: Promise<{ list: PhishingList; detector: PhishingDetector }> | null = null;

  constructor(o: { store: KeyValueStore; fetch?: typeof fetch; now?: () => number; bundled?: PhishingList }) {
    this.store = o.store;
    this.fetch = o.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = o.now ?? Date.now;
    this.bundled = o.bundled ?? BUNDLED_PHISHING_LIST;
  }

  private load(): Promise<{ list: PhishingList; detector: PhishingDetector }> {
    this.current ??= (async () => {
      let list = this.bundled;
      try {
        const raw = await this.store.get<PhishingList>(KEY);
        if (raw && typeof raw.fetchedAt === 'number' && raw.fetchedAt > list.fetchedAt) list = parsePhishingConfig(raw, raw.fetchedAt);
      } catch {
        // Corrupt stored list: fall back to the bundled one.
      }
      return { list, detector: new PhishingDetector(list) };
    })();
    return this.current;
  }

  async check(hostname: string): Promise<PhishingHit | null> {
    return (await this.load()).detector.check(hostname);
  }

  async status(): Promise<{ version: number; fetchedAt: number; domains: number }> {
    const { list, detector } = await this.load();
    return { version: list.version, fetchedAt: list.fetchedAt, domains: detector.size() };
  }

  async refresh(): Promise<void> {
    const res = await this.fetch(PHISHING_LIST_URL, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`Phishing list fetch failed: HTTP ${res.status}`);
    const list = parsePhishingConfig(await res.json(), this.now());
    await this.store.set(KEY, list);
    this.current = Promise.resolve({ list, detector: new PhishingDetector(list) });
  }
}
