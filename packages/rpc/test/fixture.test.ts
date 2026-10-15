import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { FixtureChainReader, MemoryChainReader, RecordingChainReader } from '../src';

const A = address('So11111111111111111111111111111111111111112');
const B = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

describe('fixture readers', () => {
  it('memory reader returns stored accounts and null for unknown ones', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, lamports: 5n, data: new Uint8Array([1, 2]) });
    const [a, b] = await mem.getAccounts([A, B]);
    expect(a?.data).toEqual(new Uint8Array([1, 2]));
    expect(a?.executable).toBe(false);
    expect(b).toBeNull();
  });

  it('replays exactly what was recorded and fails loudly on a miss', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, lamports: 5n, data: new Uint8Array([1, 2]) });
    const rec = new RecordingChainReader(mem);
    const live = await rec.getAccounts([A, B]);

    const fixture = rec.toFixture({ note: 'test' });
    const replay = FixtureChainReader.fromJson(fixture);
    expect(await replay.getAccounts([A, B])).toEqual(live);
    expect(replay.input).toEqual({ note: 'test' });
    await expect(replay.getAccounts([B])).rejects.toThrow(/fixture miss/);
  });

  it('records slot-tied reads and simulations under keys without their options', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, lamports: 5n, data: new Uint8Array([1]) });
    const rec = new RecordingChainReader(mem);
    const read = await rec.getAccountsWithSlot([A], { minContextSlot: 7n });
    const sim = await rec.simulate(new Uint8Array([1]), [A], { minContextSlot: 7n });
    const replay = FixtureChainReader.fromJson(rec.toFixture());
    // Replayed with other options (or none): same recorded answers.
    expect(await replay.getAccountsWithSlot([A], { minContextSlot: 9n })).toEqual(read);
    expect(await replay.getAccountsWithSlot([A])).toEqual(read);
    expect(await replay.simulate(new Uint8Array([1]), [A])).toEqual(sim);
    // A reader without slots reports slot 0.
    expect(read.slot).toBe(0n);
  });

  it('applies defaults only for missing lamports/executable', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, data: new Uint8Array(), lamports: undefined, executable: true });
    const [a] = await mem.getAccounts([A]);
    expect(a?.lamports).toBe(1_000_000n);
    expect(a?.executable).toBe(true);
  });

  it('hands out copies, never shared objects', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: B, data: new Uint8Array([1]) });
    const rec = new RecordingChainReader(mem);
    (await rec.getAccounts([A]))[0]!.data[0] = 99;
    expect((await mem.getAccounts([A]))[0]!.data).toEqual(new Uint8Array([1]));

    const replay = FixtureChainReader.fromJson(rec.toFixture());
    (await replay.getAccounts([A]))[0]!.data[0] = 77;
    expect((await replay.getAccounts([A]))[0]!.data).toEqual(new Uint8Array([1]));
  });

  it('rejects malformed fixtures', async () => {
    expect(() => FixtureChainReader.fromJson('{"version":2,"calls":{}}')).toThrow(/version/);
    expect(() => FixtureChainReader.fromJson('{"version":1}')).toThrow(/calls/);
    expect(() => FixtureChainReader.fromJson('null')).toThrow(/version/);
    const replay = FixtureChainReader.fromJson('{"version":1,"calls":{}}');
    await expect(replay.getTransaction('x')).rejects.toThrow(/fixture miss/);
  });
});
