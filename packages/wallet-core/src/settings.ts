import type { KeyValueStore } from '@clef/vault';

export type Network = 'mainnet' | 'devnet' | 'localnet' | 'custom';
export type Cluster = 'mainnet' | 'devnet';
export type CustomRpc = { url: string; cluster: Cluster };
export type Settings = {
  network: Network;
  rpcUrl: string;
  /** Which cluster the custom RPC URL serves. */
  customCluster: Cluster;
  /** Every custom RPC the user added, the one in use included, to switch between them. */
  customRpcs: CustomRpc[];
  autoLockMinutes: number;
  detailLevel: 'basic' | 'intermediate' | 'expert';
  hideSpam: boolean;
  /** Shown only when detailLevel === 'expert'. */
  networkSwitchInHeader: boolean;
  devnetTint: boolean;
  jupiterApiKey: string | null;
  errorReports: boolean;
  /** Where the toolbar icon opens Clef: the popup, or the browser's side panel (stays open beside the page). */
  openIn: 'popup' | 'panel';
};

export const NETWORKS: readonly Network[] = ['mainnet', 'devnet', 'localnet', 'custom'];

/**
 * api.mainnet-beta.solana.com refuses browser requests (403 "Access forbidden"), so mainnet defaults to publicnode,
 * which accepts them but blocks token-account scans and keeps little history. A provider URL (custom) fixes both.
 */
export const DEFAULT_RPC: Record<Exclude<Network, 'custom'>, string> = {
  mainnet: 'https://solana-rpc.publicnode.com',
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

export const DEFAULT_SETTINGS: Settings = {
  network: 'mainnet',
  rpcUrl: DEFAULT_RPC.mainnet,
  customCluster: 'mainnet',
  customRpcs: [],
  autoLockMinutes: 15,
  detailLevel: 'intermediate',
  hideSpam: true,
  networkSwitchInHeader: true,
  devnetTint: true,
  jupiterApiKey: null,
  errorReports: false,
  openIn: 'popup',
};

export const chainFor = (s: Pick<Settings, 'network' | 'customCluster'>): 'solana:mainnet' | 'solana:devnet' | 'solana:localnet' =>
  s.network === 'localnet' ? 'solana:localnet' : `solana:${s.network === 'custom' ? s.customCluster : s.network}`;

const KEY = 'settings';
const MAX_AUTO_LOCK_MINUTES = 24 * 60;
/** Saved custom RPCs; adding one more forgets the oldest that isn't in use. */
export const MAX_CUSTOM_RPCS = 10;
const LEVELS = ['basic', 'intermediate', 'expert'];
const BOOLEANS = ['hideSpam', 'networkSwitchInHeader', 'devnetTint', 'errorReports'] as const;
export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

const isLoopback = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/** https everywhere; plain http only for a loopback validator on localnet. */
function validRpcUrl(network: Network, text: string): boolean {
  const url = parseUrl(text);
  if (!url) return false;
  return url.protocol === 'https:' || (network === 'localnet' && url.protocol === 'http:' && isLoopback(url));
}

/** M2 stored mainnet/devnet with any URL, incl. loopback http (now localnet's job). */
const BROWSER_BLOCKED_MAINNET = 'https://api.mainnet-beta.solana.com';

function migrate(stored: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...stored };
  if (s.network === 'mainnet' && s.rpcUrl.replace(/\/+$/, '') === BROWSER_BLOCKED_MAINNET) s.rpcUrl = DEFAULT_RPC.mainnet;
  const url = parseUrl(s.rpcUrl);
  if ((s.network === 'mainnet' || s.network === 'devnet') && url?.protocol === 'http:' && isLoopback(url)) s.network = 'localnet';
  // Before the list existed, the custom RPC in use was the only one kept.
  if (!Array.isArray(s.customRpcs)) s.customRpcs = [];
  if (s.network === 'custom' && !s.customRpcs.some((r) => r.url === s.rpcUrl)) s.customRpcs = [...s.customRpcs, { url: s.rpcUrl, cluster: s.customCluster }];
  return s;
}

/** Valid, distinct by URL, the one in use kept (with the cluster it serves) and the list capped, oldest dropped first. */
function cleanCustomRpcs(next: Settings): CustomRpc[] {
  const list = next.customRpcs;
  if (!Array.isArray(list) || list.length > MAX_CUSTOM_RPCS + 1) throw new Error('Invalid custom RPCs');
  const seen = new Map<string, CustomRpc>();
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.url !== 'string' || !validRpcUrl('custom', r.url)) throw new Error('RPC URL must use https');
    if (r.cluster !== 'mainnet' && r.cluster !== 'devnet') throw new Error('Unknown cluster');
    seen.delete(r.url);
    seen.set(r.url, { url: r.url, cluster: r.cluster });
  }
  if (next.network === 'custom') seen.set(next.rpcUrl, { url: next.rpcUrl, cluster: next.customCluster });
  const out = [...seen.values()];
  while (out.length > MAX_CUSTOM_RPCS) out.splice(out.findIndex((r) => !(next.network === 'custom' && r.url === next.rpcUrl)), 1);
  return out;
}

function cleanApiKey(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new Error('Invalid Jupiter API key');
  const key = v.trim();
  if (!key) return null;
  if (key.length > 128 || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid Jupiter API key');
  return key;
}

export class SettingsStore {
  constructor(private readonly store: KeyValueStore) {}

  async get(): Promise<Settings> {
    return migrate((await this.store.get<Partial<Settings>>(KEY)) ?? {});
  }

  /** Validates the whole result. Switching to a built-in network without a new RPC URL selects its default RPC. */
  async update(patch: Partial<Settings>): Promise<Settings> {
    const next: Settings = { ...(await this.get()), ...patch };
    if (patch.network && patch.network !== 'custom' && patch.rpcUrl === undefined) next.rpcUrl = DEFAULT_RPC[patch.network] ?? '';
    if (!NETWORKS.includes(next.network)) throw new Error('Unknown network');
    if (next.customCluster !== 'mainnet' && next.customCluster !== 'devnet') throw new Error('Unknown cluster');
    if (typeof next.rpcUrl !== 'string' || !validRpcUrl(next.network, next.rpcUrl)) throw new Error('RPC URL must use https (http only for a localhost validator)');
    if (!Number.isInteger(next.autoLockMinutes) || next.autoLockMinutes < 1 || next.autoLockMinutes > MAX_AUTO_LOCK_MINUTES) {
      throw new Error('Auto-lock must be between 1 minute and 24 hours');
    }
    if (!LEVELS.includes(next.detailLevel)) throw new Error('Unknown detail level');
    if (next.openIn !== 'popup' && next.openIn !== 'panel') throw new Error('Unknown openIn');
    for (const k of BOOLEANS) if (typeof next[k] !== 'boolean') throw new Error(`Invalid ${k}`);
    next.jupiterApiKey = cleanApiKey(next.jupiterApiKey);
    next.customRpcs = cleanCustomRpcs(next);
    await this.store.set(KEY, next);
    return next;
  }
}
