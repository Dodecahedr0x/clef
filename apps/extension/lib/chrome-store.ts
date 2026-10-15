import type { KeyValueStore } from '@clef/vault';

/** The subset of `chrome.storage.StorageArea` we use (also satisfied by the fake browser in tests). */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class ChromeStore implements KeyValueStore {
  constructor(private readonly area: StorageAreaLike) {}

  async get<T>(key: string): Promise<T | undefined> {
    const items = await this.area.get(key);
    return items[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
}
