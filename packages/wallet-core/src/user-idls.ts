import { sanitizeText } from '@clef/explain';
import { resolveIdl } from '@clef/idl';
import type { KeyValueStore } from '@clef/vault';
import { isAddress, type Address } from '@solana/kit';
import type { Network } from './settings';

export type UserIdl = { programId: Address; network: Network; name: string; json: string; hash: string; addedAt: number };

const KEY = 'userIdls';
const NETWORKS: readonly string[] = ['mainnet', 'devnet', 'localnet', 'custom'];
const MAX_JSON = 1_000_000;
const MAX_NAME = 48;

/** IDLs the user imported by hand (trust tier 'user'), one per program and network. */
export class UserIdlStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<UserIdl[]> {
    return (await this.store.get<UserIdl[]>(KEY)) ?? [];
  }

  async add(p: { programId: string; network: Network; name?: string; json: string }): Promise<UserIdl> {
    return this.replace(null, p);
  }

  /** Saves `p` and drops `old` in one write (an edit may change the program or network); validated like `add`. */
  async replace(old: { programId: string; network: Network } | null, p: { programId: string; network: Network; name?: string; json: string }): Promise<UserIdl> {
    if (!isAddress(p.programId)) throw new Error('Invalid program address');
    if (!NETWORKS.includes(p.network)) throw new Error('Unknown network');
    if (p.json.length > MAX_JSON) throw new Error('IDL is too large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(p.json);
    } catch {
      throw new Error('Invalid IDL JSON');
    }
    if (parsed === null || typeof parsed !== 'object') throw new Error('Invalid IDL: not a JSON object');
    let resolved: Awaited<ReturnType<typeof resolveIdl>>;
    try {
      resolved = await resolveIdl(p.programId, 'user', 'user', parsed);
    } catch (e) {
      throw new Error(`Invalid IDL: ${sanitizeText(e instanceof Error ? e.message : String(e), 200)}`);
    }
    const name = sanitizeText(p.name ?? '', MAX_NAME).trim() || sanitizeText(resolved.root.program.name ?? '', MAX_NAME).trim() || 'Unknown program';
    const entry: UserIdl = { programId: p.programId, network: p.network, name, json: p.json, hash: resolved.hash, addedAt: this.now() };
    const gone = (x: UserIdl) => (x.programId === p.programId && x.network === p.network) || (old !== null && x.programId === old.programId && x.network === old.network);
    await this.store.set(KEY, [...(await this.list()).filter((x) => !gone(x)), entry]);
    return entry;
  }

  async remove(programId: string, network: Network): Promise<void> {
    const rest = (await this.list()).filter((x) => !(x.programId === programId && x.network === network));
    await this.store.set(KEY, rest);
  }
}
