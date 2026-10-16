import { sanitizeText } from '@clef/explain';
import type { KeyValueStore } from '@clef/vault';
import { isAddress, type Address } from '@solana/kit';

export type Contact = { address: Address; name: string; kind: 'contact' | 'label'; note?: string; createdAt: number };

const KEY = 'contacts';
const MAX_NAME = 32;
const MAX_NOTE = 140;

/** Address book entries and account labels, keyed by address. */
export class ContactStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  private async all(): Promise<Record<string, Contact>> {
    return (await this.store.get<Record<string, Contact>>(KEY)) ?? {};
  }

  async list(): Promise<Contact[]> {
    return Object.values(await this.all()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async upsert(c: { address: string; name: string; kind: 'contact' | 'label'; note?: string }): Promise<Contact> {
    if (!isAddress(c.address)) throw new Error('Invalid address');
    if (c.kind !== 'contact' && c.kind !== 'label') throw new Error('Invalid contact kind');
    const name = sanitizeText(c.name, Infinity).trim();
    if (!name) throw new Error('Name is required');
    if (Array.from(name).length > MAX_NAME) throw new Error(`Name is longer than ${MAX_NAME} characters`);
    const note = c.note === undefined ? undefined : sanitizeText(c.note, Infinity).trim();
    if (note !== undefined && Array.from(note).length > MAX_NOTE) throw new Error(`Note is longer than ${MAX_NOTE} characters`);
    const all = await this.all();
    const prev = Object.hasOwn(all, c.address) ? all[c.address] : undefined;
    const contact: Contact = { address: c.address, name, kind: c.kind, createdAt: prev?.createdAt ?? this.now() };
    if (note) contact.note = note;
    await this.store.set(KEY, { ...all, [c.address]: contact });
    return contact;
  }

  async remove(address: string): Promise<void> {
    const all = await this.all();
    delete all[address];
    await this.store.set(KEY, all);
  }
}
