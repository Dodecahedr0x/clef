import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChromeStore } from '../lib/chrome-store';

describe('ChromeStore', () => {
  beforeEach(() => fakeBrowser.reset());

  it.each(['local', 'session'] as const)('round-trips values in %s storage', async (area) => {
    const store = new ChromeStore(fakeBrowser.storage[area]);
    expect(await store.get('k')).toBeUndefined();
    await store.set('k', { a: [1, 2] });
    expect(await store.get('k')).toEqual({ a: [1, 2] });
    await store.remove('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('keeps areas separate', async () => {
    await new ChromeStore(fakeBrowser.storage.local).set('k', 1);
    expect(await new ChromeStore(fakeBrowser.storage.session).get('k')).toBeUndefined();
  });
});
