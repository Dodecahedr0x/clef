import { generateKeyPairSigner } from '@solana/kit';
import { describe, expect, inject, it } from 'vitest';
import { fund } from '../../../test/surfpool/cheats';
import { KitChainReader, KitPortfolioReader } from '../src';
import { transferWire } from './local-tx';

const url = inject('surfpoolRpcUrl');

describe('simulateSequence on surfpool', () => {
  it('tx2 spends what tx1 funded: the sequence succeeds where tx2 alone fails', async () => {
    const [a, b, c] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    await fund(url, a.address, 10_000_000_000n);
    const latest = await new KitPortfolioReader(url).getLatestBlockhash();
    const tx1 = await transferWire(a, b.address, 1_000_000_000n, latest);
    const tx2 = await transferWire(b, c.address, 100_000_000n, latest);
    const reader = new KitChainReader(url);

    const seq = await reader.simulateSequence([tx1, tx2], [[a.address, b.address], [b.address, c.address]]);
    expect(seq.failedIndex).toBeNull();
    expect(seq.results[0]?.pre[1]).toBeNull();
    expect(seq.results[0]?.postAccounts[1]?.lamports).toBe(1_000_000_000n);
    expect(seq.results[1]?.pre[0]?.lamports).toBe(1_000_000_000n);
    expect(seq.results[1]?.postAccounts[1]?.lamports).toBe(100_000_000n);
    expect(seq.results[1]?.logs.length).toBeGreaterThan(0);

    const alone = await reader.simulateSequence([tx2], [[b.address, c.address]]);
    expect(alone.failedIndex).toBe(0);
    expect(alone.results[0]?.err).not.toBeNull();

    // Nothing was persisted.
    expect(await reader.getAccounts([b.address])).toEqual([null]);
  });
});
