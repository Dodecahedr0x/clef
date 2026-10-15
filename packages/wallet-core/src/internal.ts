import { LockedError, parseSecretKey, zeroize, type Vault } from '@clef/vault';
import { isAddress, type Address } from '@solana/kit';
import type { Account, AccountStore } from './accounts';
import type { Permission, PermissionStore } from './permissions';
import type { Settings, SettingsStore } from './settings';

/** What extension pages may see: never secrets, never secret ids. */
export type PublicAccount = { kind: Account['kind']; address: Address; label: string; index?: number };
export type WalletState = {
  hasVault: boolean;
  unlocked: boolean;
  accounts: PublicAccount[];
  settings: Settings;
  permissions: Permission[];
};

export type InternalApiDeps = {
  vault: Vault;
  accounts: AccountStore;
  permissions: PermissionStore;
  settings: SettingsStore;
  onLock: () => void;
  onUnlock: () => Promise<void>;
};

const SETTINGS_KEYS = ['network', 'rpcUrl', 'autoLockMinutes'] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function field(call: Record<string, unknown>, name: string, max = 1024): string {
  const v = call[name];
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new Error(`Missing or invalid ${name}`);
  return v;
}

function addressField(call: Record<string, unknown>, name: string): Address {
  const v = field(call, name, 64);
  if (!isAddress(v)) throw new Error(`Invalid ${name}`);
  return v;
}

const toPublic = (a: Account): PublicAccount => ({
  kind: a.kind,
  address: a.address,
  label: a.label,
  ...(a.kind === 'hd' && { index: a.index }),
});

/**
 * The API used by the popup and approval pages. Passwords and recovery phrases pass through it, so the background
 * must only route calls from extension pages here. Error messages never include inputs.
 */
export class InternalApi {
  constructor(private readonly deps: InternalApiDeps) {}

  async call(raw: unknown): Promise<unknown> {
    if (!isObj(raw)) throw new Error('Invalid call');
    const { vault, accounts, permissions, settings } = this.deps;
    switch (raw.type) {
      case 'state':
        return this.state();
      case 'vault:create': {
        const secretIds = await vault.create(field(raw, 'password'), [{ kind: 'mnemonic', phrase: field(raw, 'mnemonic') }]);
        await this.addHdAccount(secretIds[0]!);
        await this.deps.onUnlock();
        return {};
      }
      case 'vault:unlock':
        await vault.unlock(field(raw, 'password'));
        await this.deps.onUnlock();
        return {};
      case 'vault:lock':
        await vault.lock();
        this.deps.onLock();
        return {};
      case 'accounts:derive': {
        const mnemonic = (await vault.secrets()).find((s) => s.kind === 'mnemonic');
        if (!mnemonic) throw new Error('No recovery phrase in this wallet');
        await this.addHdAccount(mnemonic.id);
        return {};
      }
      case 'accounts:import': {
        await this.requireUnlocked();
        const { address, privateKey } = await parseSecretKey(field(raw, 'secretKey'));
        try {
          if (await accounts.get(address)) throw new Error('Account already added');
          const secretId = await vault.addSecret({ kind: 'keypair', privateKey });
          const n = (await accounts.list()).filter((a) => a.kind === 'imported').length + 1;
          await accounts.add({ kind: 'imported', address, label: `Imported ${n}`, secretId });
        } finally {
          zeroize(privateKey);
        }
        return {};
      }
      case 'accounts:watch':
        await accounts.add({ kind: 'watch', address: addressField(raw, 'address'), label: field(raw, 'label', 32).trim() || 'Watch' });
        return {};
      case 'accounts:rename':
        await accounts.rename(addressField(raw, 'address'), field(raw, 'label', 64));
        return {};
      case 'accounts:remove': {
        const address = addressField(raw, 'address');
        await accounts.remove(address);
        await permissions.removeAccount(address);
        return {};
      }
      case 'permissions:revoke':
        await permissions.revoke(field(raw, 'origin', 512));
        return {};
      case 'settings:update': {
        const patch = raw.patch;
        if (!isObj(patch) || !Object.keys(patch).every((k) => (SETTINGS_KEYS as readonly string[]).includes(k))) throw new Error('Invalid settings');
        await settings.update(patch as Partial<Settings>);
        return {};
      }
      default:
        throw new Error('Unknown call');
    }
  }

  private async state(): Promise<WalletState> {
    const { vault, accounts, permissions, settings } = this.deps;
    return {
      hasVault: await vault.exists(),
      unlocked: await vault.isUnlocked(),
      accounts: (await accounts.list()).map(toPublic),
      settings: await settings.get(),
      permissions: await permissions.list(),
    };
  }

  private async requireUnlocked(): Promise<void> {
    if (!(await this.deps.vault.isUnlocked())) throw new LockedError();
  }

  private async addHdAccount(secretId: string): Promise<void> {
    const index = await this.deps.accounts.nextHdIndex(secretId);
    const address = await this.deps.vault.withPrivateKey({ secretId, index }, async (_key, addr) => addr);
    const n = (await this.deps.accounts.list()).filter((a) => a.kind === 'hd').length + 1;
    await this.deps.accounts.add({ kind: 'hd', address, label: `Account ${n}`, secretId, index });
  }
}
