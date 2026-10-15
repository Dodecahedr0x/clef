import type { KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';

export type Account =
  | { kind: 'hd'; address: Address; label: string; secretId: string; index: number }
  | { kind: 'imported'; address: Address; label: string; secretId: string }
  | { kind: 'watch'; address: Address; label: string };

const KEY = 'accounts';
const MAX_LABEL = 32;

export class AccountStore {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<Account[]> {
    return (await this.store.get<Account[]>(KEY)) ?? [];
  }

  async get(address: string): Promise<Account | undefined> {
    return (await this.list()).find((a) => a.address === address);
  }

  async add(account: Account): Promise<void> {
    const all = await this.list();
    if (all.some((a) => a.address === account.address)) throw new Error('Account already added');
    await this.store.set(KEY, [...all, account]);
  }

  async rename(address: string, label: string): Promise<void> {
    const clean = label.trim().slice(0, MAX_LABEL);
    if (!clean) throw new Error('Label required');
    await this.store.set(KEY, (await this.list()).map((a) => (a.address === address ? { ...a, label: clean } : a)));
  }

  async remove(address: string): Promise<void> {
    await this.store.set(KEY, (await this.list()).filter((a) => a.address !== address));
  }

  async canSign(address: string): Promise<boolean> {
    const a = await this.get(address);
    return a !== undefined && a.kind !== 'watch';
  }

  async nextHdIndex(secretId: string): Promise<number> {
    const used = (await this.list()).flatMap((a) => (a.kind === 'hd' && a.secretId === secretId ? [a.index] : []));
    return used.length ? Math.max(...used) + 1 : 0;
  }
}
