import type { KeyValueStore } from '@clef/vault';

export type Network = 'mainnet' | 'devnet';
export type Settings = { network: Network; rpcUrl: string; autoLockMinutes: number };

export const DEFAULT_RPC: Record<Network, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

export const DEFAULT_SETTINGS: Settings = { network: 'mainnet', rpcUrl: DEFAULT_RPC.mainnet, autoLockMinutes: 15 };

export const chainFor = (n: Network): 'solana:mainnet' | 'solana:devnet' => (n === 'mainnet' ? 'solana:mainnet' : 'solana:devnet');

const KEY = 'settings';
const MAX_AUTO_LOCK_MINUTES = 24 * 60;

function validRpcUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || (local && url.protocol === 'http:');
}

export class SettingsStore {
  constructor(private readonly store: KeyValueStore) {}

  async get(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await this.store.get<Partial<Settings>>(KEY)) };
  }

  /** Validates the whole result. Switching network without a new RPC URL selects that network's default RPC. */
  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    if (patch.network && patch.rpcUrl === undefined) next.rpcUrl = DEFAULT_RPC[patch.network] ?? '';
    if (next.network !== 'mainnet' && next.network !== 'devnet') throw new Error('Unknown network');
    if (!validRpcUrl(next.rpcUrl)) throw new Error('RPC URL must use https (http only for localhost)');
    if (!Number.isInteger(next.autoLockMinutes) || next.autoLockMinutes < 1 || next.autoLockMinutes > MAX_AUTO_LOCK_MINUTES) {
      throw new Error('Auto-lock must be between 1 minute and 24 hours');
    }
    await this.store.set(KEY, next);
    return next;
  }
}
