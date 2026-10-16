import { readFileSync } from 'node:fs';
import { normalizeIdl } from '@clef/idl';
import { MemoryStore } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { UserIdlStore } from '../src/user-idls';

const MEMO = readFileSync(new URL('../../idl/idls/memo.json', import.meta.url), 'utf8');
const MEMO_ID = 'Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH';
const OTHER = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('UserIdlStore', () => {
  it('rejects invalid JSON and unrecognized IDLs', async () => {
    const s = new UserIdlStore(new MemoryStore());
    await expect(s.add({ programId: MEMO_ID, network: 'mainnet', json: '{nope' })).rejects.toThrow('Invalid IDL JSON');
    await expect(s.add({ programId: MEMO_ID, network: 'mainnet', json: '{"a":1}' })).rejects.toThrow(/^Invalid IDL: /);
  });

  it('stores a valid IDL with its normalized hash and replaces the same program+network', async () => {
    let t = 5;
    const s = new UserIdlStore(new MemoryStore(), () => t);
    const added = await s.add({ programId: MEMO_ID, network: 'mainnet', json: MEMO });
    expect(added.hash).toBe((await normalizeIdl(MEMO)).hash);
    expect(added).toMatchObject({ programId: MEMO_ID, network: 'mainnet', addedAt: 5, json: MEMO });
    expect(added.name.length).toBeGreaterThan(0);
    await s.add({ programId: MEMO_ID, network: 'devnet', json: MEMO, name: 'Memo dev' });
    t = 9;
    await s.add({ programId: MEMO_ID, network: 'mainnet', json: MEMO, name: 'Memo‮ v2' });
    const list = await s.list();
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.network === 'mainnet')).toMatchObject({ name: 'Memo v2', addedAt: 9 });
    await s.remove(MEMO_ID, 'devnet');
    expect((await s.list()).map((x) => x.network)).toEqual(['mainnet']);
  });

  it('rejects an IDL declaring another program address, bad network and bad program id', async () => {
    const s = new UserIdlStore(new MemoryStore());
    await expect(s.add({ programId: OTHER, network: 'mainnet', json: MEMO })).rejects.toThrow(/^Invalid IDL: .*not/);
    await expect(s.add({ programId: MEMO_ID, network: 'testnet' as never, json: MEMO })).rejects.toThrow();
    await expect(s.add({ programId: 'bad', network: 'mainnet', json: MEMO })).rejects.toThrow();
    expect(await s.list()).toEqual([]);
  });
});

describe('UserIdlStore.replace (edit)', () => {
  it('edits in place, can move an IDL to another network, and leaves the others alone', async () => {
    const s = new UserIdlStore(new MemoryStore(), () => 5);
    await s.add({ programId: MEMO_ID, network: 'mainnet', json: MEMO, name: 'Memo main' });
    await s.add({ programId: MEMO_ID, network: 'devnet', json: MEMO, name: 'Memo dev' });

    await s.replace({ programId: MEMO_ID, network: 'mainnet' }, { programId: MEMO_ID, network: 'mainnet', json: MEMO, name: 'Memo renamed' });
    expect((await s.list()).map((x) => `${x.network}:${x.name}`).sort()).toEqual(['devnet:Memo dev', 'mainnet:Memo renamed']);

    await s.replace({ programId: MEMO_ID, network: 'mainnet' }, { programId: MEMO_ID, network: 'localnet', json: MEMO, name: 'Memo local' });
    expect((await s.list()).map((x) => `${x.network}:${x.name}`).sort()).toEqual(['devnet:Memo dev', 'localnet:Memo local']);
  });

  it('an invalid edit changes nothing', async () => {
    const s = new UserIdlStore(new MemoryStore());
    await s.add({ programId: MEMO_ID, network: 'mainnet', json: MEMO });
    await expect(s.replace({ programId: MEMO_ID, network: 'mainnet' }, { programId: MEMO_ID, network: 'mainnet', json: '{nope' })).rejects.toThrow('Invalid IDL JSON');
    expect(await s.list()).toHaveLength(1);
  });
});
