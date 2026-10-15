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
});
