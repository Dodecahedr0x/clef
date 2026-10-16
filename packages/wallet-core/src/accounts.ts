import type { DerivationScheme, KeyRef, KeyValueStore } from '@clef/vault';
import type { Address } from '@solana/kit';

export type Account =
  | { kind: 'hd'; address: Address; label: string; secretId: string; index: number; scheme?: DerivationScheme }
  | { kind: 'imported'; address: Address; label: string; secretId: string }
  | { kind: 'watch'; address: Address; label: string }
  | { kind: 'ledger'; address: Address; label: string; path: string }
  | { kind: 'keystone'; address: Address; label: string; path: string; xfp: string }
  | { kind: 'squads'; address: Address /* vault PDA */; label: string; multisig: Address; vaultIndex: number; member: Address };

/** The vault reference for a software account's key. */
export function keyRef(a: Extract<Account, { kind: 'hd' | 'imported' }>): KeyRef {
  if (a.kind === 'imported') return { secretId: a.secretId };
  return { secretId: a.secretId, index: a.index, ...(a.scheme && { scheme: a.scheme }) };
}

/** Accounts whose own key (in the vault or on a device) signs. */
export const isKeyAccount = (a: Account): boolean => a.kind === 'hd' || a.kind === 'imported' || a.kind === 'ledger' || a.kind === 'keystone';

const KEY = 'accounts';
const ACTIVE = 'activeAccount';
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

  /** A squads vault signs through its member, which must itself hold a key. */
  async canSign(address: string): Promise<boolean> {
    const all = await this.list();
    const a = all.find((x) => x.address === address);
    if (!a) return false;
    if (a.kind !== 'squads') return isKeyAccount(a);
    const member = all.find((x) => x.address === a.member);
    return member !== undefined && isKeyAccount(member);
  }

  async active(): Promise<Address | null> {
    const all = await this.list();
    const chosen = await this.store.get<string>(ACTIVE);
    return (all.find((a) => a.address === chosen) ?? all[0])?.address ?? null;
  }

  async select(address: string): Promise<void> {
    if (!(await this.get(address))) throw new Error('Unknown account');
    await this.store.set(ACTIVE, address);
  }

  async nextHdIndex(secretId: string, scheme?: DerivationScheme): Promise<number> {
    const used = (await this.list()).flatMap((a) => (a.kind === 'hd' && a.secretId === secretId && a.scheme === scheme ? [a.index] : []));
    return used.length ? Math.max(...used) + 1 : 0;
  }
}
