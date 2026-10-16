import {
  deriveEd25519,
  fromBase64,
  legacySolanaPath,
  generateMnemonic,
  LockedError,
  mnemonicToSeed,
  normalizeMnemonic,
  parseSecretKey,
  solanaPath,
  validateMnemonic,
  zeroize,
  type DerivationScheme,
  type Vault,
} from '@clef/vault';
import { address as toAddress, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, getProgramDerivedAddress, isAddress, type Address } from '@solana/kit';
import { isKeyAccount, type Account, type AccountStore } from './accounts';
import type { ContactStore } from './contacts';
import type { ErrorReporter } from './error-reporter';
import type { Permission, PermissionStore } from './permissions';
import type { PhishingListStore } from './phishing';
import type { RequestLog } from './request-log';
import type { SubmitParams, SubmitResult } from './service';
import { NETWORKS, SETTINGS_KEYS, type Network, type Settings, type SettingsStore } from './settings';
import type { UserIdlStore } from './user-idls';

/** What extension pages may see: never secrets, never secret ids. */
export type PublicAccount = {
  kind: Account['kind'];
  address: Address;
  label: string;
  index?: number;
  /** 1-based position of the account's recovery phrase in the vault; present while unlocked. */
  phrase?: number;
  path?: string;
  xfp?: string;
  multisig?: Address;
  vaultIndex?: number;
  member?: Address;
};
export type WalletState = {
  hasVault: boolean;
  unlocked: boolean;
  accounts: PublicAccount[];
  settings: Settings;
  permissions: Permission[];
  /** How many recovery phrases the vault holds; present while unlocked. */
  phrases?: number;
};
export type FullWalletState = WalletState & { activeAccount: Address | null; errorReportsAvailable: boolean };

export type InternalApiDeps = {
  vault: Vault;
  accounts: AccountStore;
  permissions: PermissionStore;
  settings: SettingsStore;
  onLock: () => void;
  onUnlock: () => Promise<void>;
  /** Tells every page of `origin` its accounts changed (same channel as WalletService events). */
  emit: (origin: string, accounts: string[]) => void;
  contacts?: ContactStore;
  userIdls?: UserIdlStore;
  log?: Pick<RequestLog, 'list' | 'clear'>;
  phishing?: Pick<PhishingListStore, 'status' | 'refresh'>;
  reporter?: Pick<ErrorReporter, 'available' | 'report'>;
  /** The WalletService: popup screens sign through the same approval window as dApps. */
  service?: { submit(p: SubmitParams): Promise<SubmitResult> };
};

const SQUADS_PROGRAM_ID = toAddress('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const PURPOSES = ['send', 'swap', 'squads-vote', 'squads-execute'];
const MAX_SCAN = 50;
const MAX_INDEX = 2 ** 31 - 1;
const MAX_SUBMIT = 16;
const MAX_TX_BASE64 = Math.ceil(4096 / 3) * 4;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function field(call: Record<string, unknown>, name: string, max = 1024): string {
  const v = call[name];
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new Error(`Missing or invalid ${name}`);
  return v;
}

function optField(call: Record<string, unknown>, name: string, max: number): string | undefined {
  return call[name] === undefined ? undefined : field(call, name, max);
}

function addressField(call: Record<string, unknown>, name: string): Address {
  const v = field(call, name, 64);
  if (!isAddress(v)) throw new Error(`Invalid ${name}`);
  return v;
}

function intField(call: Record<string, unknown>, name: string, min: number, max: number, fallback?: number): number {
  const v = call[name] ?? fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`Missing or invalid ${name}`);
  return v;
}

function networkField(call: Record<string, unknown>): Network {
  const v = call.network;
  if (typeof v !== 'string' || !(NETWORKS as readonly string[]).includes(v)) throw new Error('Invalid network');
  return v as Network;
}

function mnemonicField(call: Record<string, unknown>): string {
  const m = normalizeMnemonic(field(call, 'mnemonic', 1024));
  if (!validateMnemonic(m)) throw new Error('Invalid recovery phrase');
  return m;
}

function schemeField(call: Record<string, unknown>): DerivationScheme | undefined {
  const v = call.scheme;
  if (v === undefined || v === 'standard') return undefined;
  if (v !== 'legacy') throw new Error('Invalid scheme');
  return v;
}

function indexesField(call: Record<string, unknown>, fallback?: number[]): number[] {
  const indexes = call.indexes === undefined ? fallback : call.indexes;
  if (!Array.isArray(indexes) || indexes.length === 0 || indexes.length > MAX_SCAN) throw new Error('Invalid indexes');
  if (!indexes.every((i) => Number.isInteger(i) && i >= 0 && i <= MAX_INDEX)) throw new Error('Invalid indexes');
  return [...new Set(indexes as number[])];
}

function base64Field(v: unknown, name: string): Uint8Array {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_TX_BASE64 || v.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw new Error(`Invalid ${name}`);
  return fromBase64(v);
}

const toPublic = (a: Account, phraseIds: string[] | null): PublicAccount => {
  const base = { kind: a.kind, address: a.address, label: a.label };
  switch (a.kind) {
    case 'hd': {
      const n = phraseIds ? phraseIds.indexOf(a.secretId) + 1 : 0;
      return { ...base, index: a.index, ...(n > 0 && { phrase: n }) };
    }
    case 'ledger':
      return { ...base, path: a.path };
    case 'keystone':
      return { ...base, path: a.path, xfp: a.xfp };
    case 'squads':
      return { ...base, multisig: a.multisig, vaultIndex: a.vaultIndex, member: a.member };
    default:
      return base;
  }
};

async function addressAt(seed: Uint8Array, index: number, scheme?: DerivationScheme): Promise<Address> {
  const key = deriveEd25519(seed, scheme === 'legacy' ? legacySolanaPath(index) : solanaPath(index));
  try {
    return (await createKeyPairSignerFromPrivateKeyBytes(key)).address;
  } finally {
    zeroize(key);
  }
}

/** Squads v4 vault PDA: seeds ['multisig', multisig, 'vault', u8 index]. */
async function squadsVault(multisig: Address, index: number): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SQUADS_PROGRAM_ID,
    seeds: ['multisig', getAddressEncoder().encode(multisig), 'vault', new Uint8Array([index])],
  });
  return pda;
}

function need<T>(dep: T | undefined): T {
  if (dep === undefined) throw new Error('Unavailable');
  return dep;
}

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
        // [] (onboarding by private key or watch-only) keeps the phrase without accounts
        const unique = Array.isArray(raw.indexes) && raw.indexes.length === 0 ? [] : indexesField(raw, [0]);
        const secretIds = await vault.create(field(raw, 'password'), [{ kind: 'mnemonic', phrase: field(raw, 'mnemonic') }]);
        for (const index of unique) await this.addHdAccount(secretIds[0]!, index);
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
      case 'vault:revealMnemonic': {
        // unlock() re-derives the key from the password and fails on a wrong one
        await vault.unlock(field(raw, 'password'));
        const id = await this.phraseId(raw);
        const mnemonic = (await vault.secrets()).find((s) => s.id === id);
        if (mnemonic?.kind !== 'mnemonic') throw new Error('No recovery phrase in this wallet');
        return { mnemonic: mnemonic.phrase };
      }
      case 'vault:changePassword':
        await vault.changePassword(field(raw, 'current'), field(raw, 'next'));
        return {};
      case 'mnemonic:generate':
        return { mnemonic: generateMnemonic(12) };
      case 'accounts:scan': {
        const mnemonic = mnemonicField(raw);
        const from = intField(raw, 'from', 0, MAX_INDEX - MAX_SCAN, 0);
        const count = intField(raw, 'count', 1, MAX_SCAN, 5);
        const scheme = schemeField(raw);
        const seed = await mnemonicToSeed(mnemonic);
        try {
          const out: { index: number; address: Address }[] = [];
          for (let index = from; index < from + count; index++) out.push({ index, address: await addressAt(seed, index, scheme) });
          return { accounts: out };
        } finally {
          zeroize(seed);
        }
      }
      case 'accounts:derive': {
        const secretId = await this.phraseId(raw);
        // continue on the path this phrase's accounts were last added with
        const last = (await accounts.list()).filter((a) => a.kind === 'hd' && a.secretId === secretId).at(-1);
        const scheme = last?.kind === 'hd' ? last.scheme : undefined;
        await this.addHdAccount(secretId, await accounts.nextHdIndex(secretId, scheme), scheme);
        return {};
      }
      case 'accounts:importMnemonic': {
        await this.requireUnlocked();
        const mnemonic = mnemonicField(raw);
        const indexes = indexesField(raw);
        const scheme = schemeField(raw);
        const secretId = await vault.addSecret({ kind: 'mnemonic', phrase: mnemonic });
        const seed = await mnemonicToSeed(mnemonic);
        try {
          for (const index of indexes) {
            if (await accounts.get(await addressAt(seed, index, scheme))) continue;
            await this.addHdAccount(secretId, index, scheme);
          }
        } finally {
          zeroize(seed);
        }
        return { phrase: (await this.phraseIds()).indexOf(secretId) + 1 };
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
      case 'accounts:addHardware': {
        const kind = raw.kind;
        if (kind !== 'ledger' && kind !== 'keystone') throw new Error('Invalid kind');
        const address = addressField(raw, 'address');
        const path = field(raw, 'path', 64);
        const n = (await accounts.list()).filter((a) => a.kind === kind).length + 1;
        const label = optField(raw, 'label', 32)?.trim() || `${kind === 'ledger' ? 'Ledger' : 'Keystone'} ${n}`;
        await accounts.add(kind === 'ledger' ? { kind, address, label, path } : { kind, address, label, path, xfp: field(raw, 'xfp', 16) });
        return {};
      }
      case 'accounts:addSquads': {
        const multisig = addressField(raw, 'multisig');
        const vaultIndex = intField(raw, 'vaultIndex', 0, 255);
        const member = await accounts.get(addressField(raw, 'member'));
        if (!member || !isKeyAccount(member)) throw new Error('The member must be one of your signing accounts');
        const label = field(raw, 'label', 32).trim() || 'Multisig';
        await accounts.add({ kind: 'squads', address: await squadsVault(multisig, vaultIndex), label, multisig, vaultIndex, member: member.address });
        return {};
      }
      case 'accounts:select':
        await accounts.select(addressField(raw, 'address'));
        return {};
      case 'accounts:rename':
        await accounts.rename(addressField(raw, 'address'), field(raw, 'label', 64));
        return {};
      case 'accounts:remove': {
        const address = addressField(raw, 'address');
        const affected = (await permissions.list()).filter((p) => p.accounts.includes(address));
        await accounts.remove(address);
        await permissions.removeAccount(address);
        for (const p of affected) this.deps.emit(p.origin, (await permissions.get(p.origin))?.accounts ?? []);
        return {};
      }
      case 'permissions:revoke': {
        const origin = field(raw, 'origin', 512);
        await permissions.revoke(origin);
        this.deps.emit(origin, []);
        return {};
      }
      case 'settings:update': {
        const patch = raw.patch;
        if (!isObj(patch) || !Object.keys(patch).every((k) => (SETTINGS_KEYS as readonly string[]).includes(k))) throw new Error('Invalid settings');
        await settings.update(patch as Partial<Settings>);
        return {};
      }
      case 'contacts:list':
        return need(this.deps.contacts).list();
      case 'contacts:upsert': {
        const kind = raw.kind;
        if (kind !== 'contact' && kind !== 'label') throw new Error('Invalid kind');
        const note = optField(raw, 'note', 140);
        await need(this.deps.contacts).upsert({ address: addressField(raw, 'address'), name: field(raw, 'name', 64), kind, ...(note !== undefined && { note }) });
        return {};
      }
      case 'contacts:remove':
        await need(this.deps.contacts).remove(addressField(raw, 'address'));
        return {};
      case 'idls:list':
        return need(this.deps.userIdls).list();
      case 'idls:add': {
        const name = optField(raw, 'name', 48);
        return need(this.deps.userIdls).add({
          programId: addressField(raw, 'programId'),
          network: networkField(raw),
          json: field(raw, 'json', 1_000_000),
          ...(name !== undefined && { name }),
        });
      }
      case 'idls:remove':
        await need(this.deps.userIdls).remove(addressField(raw, 'programId'), networkField(raw));
        return {};
      case 'log:list':
        return need(this.deps.log).list(raw.limit === undefined ? undefined : intField(raw, 'limit', 1, 500));
      case 'log:clear':
        await need(this.deps.log).clear();
        return {};
      case 'phishing:status':
        return need(this.deps.phishing).status();
      case 'phishing:refresh':
        await need(this.deps.phishing).refresh();
        return {};
      case 'errors:report': {
        const reporter = this.deps.reporter;
        if (!reporter?.available) return {};
        const error = Object.assign(new Error(field(raw, 'message', 4096)), { stack: optField(raw, 'stack', 16_384) ?? '' });
        const origin = optField(raw, 'origin', 512);
        await reporter.report(error, { area: field(raw, 'area', 64), ...(origin !== undefined && { origin }) });
        return {};
      }
      case 'wallet:submit': {
        const list = raw.transactions;
        if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SUBMIT) throw new Error('Invalid transactions');
        if (typeof raw.send !== 'boolean') throw new Error('Invalid send');
        if (!PURPOSES.includes(raw.purpose as string)) throw new Error('Invalid purpose');
        const transactions = list.map((t, i) => base64Field(t, `transactions[${i}]`));
        return need(this.deps.service).submit({ account: addressField(raw, 'account'), transactions, send: raw.send });
      }
      default:
        throw new Error('Unknown call');
    }
  }

  private async state(): Promise<FullWalletState> {
    const { vault, accounts, permissions, settings } = this.deps;
    const unlocked = await vault.isUnlocked();
    const phraseIds = unlocked ? await this.phraseIds() : null;
    return {
      hasVault: await vault.exists(),
      unlocked,
      ...(phraseIds && { phrases: phraseIds.length }),
      accounts: (await accounts.list()).map((a) => toPublic(a, phraseIds)),
      settings: await settings.get(),
      permissions: await permissions.list(),
      activeAccount: await accounts.active(),
      errorReportsAvailable: this.deps.reporter?.available ?? false,
    };
  }

  private async requireUnlocked(): Promise<void> {
    if (!(await this.deps.vault.isUnlocked())) throw new LockedError();
  }

  /** Mnemonic secret ids in vault order: extension pages name phrases by position, never by id. */
  private async phraseIds(): Promise<string[]> {
    return (await this.deps.vault.list()).filter((s) => s.kind === 'mnemonic').map((s) => s.id);
  }

  private async phraseId(call: Record<string, unknown>): Promise<string> {
    const n = intField(call, 'phrase', 1, MAX_SCAN, 1);
    const id = (await this.phraseIds())[n - 1];
    if (!id) throw new Error('No recovery phrase in this wallet');
    return id;
  }

  private async addHdAccount(secretId: string, index: number, scheme?: DerivationScheme): Promise<void> {
    const ref = { secretId, index, ...(scheme && { scheme }) };
    const address = await this.deps.vault.withPrivateKey(ref, async (_key, addr) => addr);
    const n = (await this.deps.accounts.list()).filter((a) => a.kind === 'hd').length + 1;
    await this.deps.accounts.add({ kind: 'hd', address, label: `Account ${n}`, ...ref });
  }
}
