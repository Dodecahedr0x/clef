/** Minimal async key-value storage; values must be JSON-compatible. Implemented by memory (tests) and chrome.storage (extension). */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}
