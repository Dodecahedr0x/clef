import type { KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';

export type Permission = { origin: string; accounts: Address[]; connectedAt: number };

const KEY = 'permissions';

/** Which accounts each origin may use. Keyed by exact origin (scheme + host + port). */
export class PermissionStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  private async all(): Promise<Record<string, Permission>> {
    return (await this.store.get<Record<string, Permission>>(KEY)) ?? {};
  }

  async get(origin: string): Promise<Permission | null> {
    const all = await this.all();
    return Object.hasOwn(all, origin) ? all[origin]! : null;
  }

  async list(): Promise<Permission[]> {
    return Object.values(await this.all());
  }

  async grant(origin: string, accounts: Address[]): Promise<void> {
    await this.store.set(KEY, { ...(await this.all()), [origin]: { origin, accounts, connectedAt: this.now() } });
  }

  async revoke(origin: string): Promise<void> {
    const all = await this.all();
    delete all[origin];
    await this.store.set(KEY, all);
  }

  /** Drops `account` everywhere; origins left with no accounts are revoked. */
  async removeAccount(account: string): Promise<void> {
    const next: Record<string, Permission> = {};
    for (const p of Object.values(await this.all())) {
      const accounts = p.accounts.filter((a) => a !== account);
      if (accounts.length) next[p.origin] = { ...p, accounts };
    }
    await this.store.set(KEY, next);
  }

  async allowed(origin: string, account: string): Promise<boolean> {
    return (await this.get(origin))?.accounts.includes(account as Address) ?? false;
  }
}
