import type { KeyValueStore } from '@clef/vault';

export type Network = 'mainnet' | 'devnet' | 'localnet' | 'custom';
export type Cluster = 'mainnet' | 'devnet';
export type Settings = {
  network: Network;
  rpcUrl: string;
  /** Which cluster the custom RPC URL serves. */
  customCluster: Cluster;
  autoLockMinutes: number;
  detailLevel: 'basic' | 'intermediate' | 'expert';
  hideSpam: boolean;
  /** Shown only when detailLevel === 'expert'. */
  networkSwitchInHeader: boolean;
  devnetTint: boolean;
  jupiterApiKey: string | null;
  errorReports: boolean;
};

export const NETWORKS: readonly Network[] = ['mainnet', 'devnet', 'localnet', 'custom'];

export const DEFAULT_RPC: Record<Exclude<Network, 'custom'>, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

export const DEFAULT_SETTINGS: Settings = {
  network: 'mainnet',
  rpcUrl: DEFAULT_RPC.mainnet,
  customCluster: 'mainnet',
  autoLockMinutes: 15,
  detailLevel: 'intermediate',
  hideSpam: true,
  networkSwitchInHeader: true,
  devnetTint: true,
  jupiterApiKey: null,
  errorReports: false,
};

export const chainFor = (s: Pick<Settings, 'network' | 'customCluster'>): 'solana:mainnet' | 'solana:devnet' | 'solana:localnet' =>
  s.network === 'localnet' ? 'solana:localnet' : `solana:${s.network === 'custom' ? s.customCluster : s.network}`;

const KEY = 'settings';
const MAX_AUTO_LOCK_MINUTES = 24 * 60;
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
function migrate(stored: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...stored };
  const url = parseUrl(s.rpcUrl);
  if ((s.network === 'mainnet' || s.network === 'devnet') && url?.protocol === 'http:' && isLoopback(url)) s.network = 'localnet';
  return s;
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
    for (const k of BOOLEANS) if (typeof next[k] !== 'boolean') throw new Error(`Invalid ${k}`);
    next.jupiterApiKey = cleanApiKey(next.jupiterApiKey);
    await this.store.set(KEY, next);
    return next;
  }
}
