import { MemoryStore } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { ContactStore } from '../src/contacts';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const B = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

describe('ContactStore', () => {
  it('upserts, keeps createdAt on update, sorts by name and removes', async () => {
    let t = 1000;
    const c = new ContactStore(new MemoryStore(), () => t);
    const first = await c.upsert({ address: A, name: ' zed ', kind: 'contact' });
    expect(first).toEqual({ address: A, name: 'zed', kind: 'contact', createdAt: 1000 });
    t = 2000;
    await c.upsert({ address: B, name: 'Alice', kind: 'label', note: 'cold wallet' });
    t = 3000;
    const updated = await c.upsert({ address: A, name: 'Bob', kind: 'contact' });
    expect(updated.createdAt).toBe(1000);
    expect((await c.list()).map((x) => x.name)).toEqual(['Alice', 'Bob']);
    await c.remove(B);
    expect((await c.list()).map((x) => x.address)).toEqual([A]);
  });

  it('rejects invalid input', async () => {
    const c = new ContactStore(new MemoryStore());
    await expect(c.upsert({ address: 'nope', name: 'x', kind: 'contact' })).rejects.toThrow();
    await expect(c.upsert({ address: A, name: '   ', kind: 'contact' })).rejects.toThrow();
    await expect(c.upsert({ address: A, name: 'x'.repeat(33), kind: 'contact' })).rejects.toThrow();
    await expect(c.upsert({ address: A, name: 'x', kind: 'contact', note: 'n'.repeat(141) })).rejects.toThrow();
    await expect(c.upsert({ address: A, name: 'x', kind: 'friend' as never })).rejects.toThrow();
    expect(await c.list()).toEqual([]);
  });
});
