import { address, generateKeyPairSigner } from '@solana/kit';
import { describe, expect, inject, it } from 'vitest';
import { fund, fundToken } from '../../../test/surfpool/cheats';
import { KitChainReader, KitPortfolioReader, TOKEN_PROGRAM, UnsupportedMethodError } from '../src';
import { transferWire } from './local-tx';

const url = inject('surfpoolRpcUrl');
const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

describe('KitPortfolioReader on surfpool', () => {
  const reader = new KitPortfolioReader(url);

  it('reads SOL and token balances', async () => {
    const owner = await generateKeyPairSigner();
    await fund(url, owner.address, 2_000_000_000n);
    await fundToken(url, owner.address, USDC, 1_500_000n);
    expect(await reader.getBalance(owner.address)).toBe(2_000_000_000n);
    const tokens = await reader.getTokenAccounts(owner.address);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ mint: USDC, owner: owner.address, amount: 1_500_000n, decimals: 6, program: TOKEN_PROGRAM, state: 'initialized', delegate: null });
  });

  it('has no DAS', async () => {
    expect(await reader.hasDas()).toBe(false);
    await expect(reader.getAssetsByOwner(address('11111111111111111111111111111111'))).rejects.toBeInstanceOf(UnsupportedMethodError);
  });

  it('reports health and a blockhash', async () => {
    const h = await reader.getHealth();
    expect(h.slot).toBeGreaterThan(0n);
    const latest = await reader.getLatestBlockhash();
    expect(latest.blockhash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('confirms a sent transfer by polling and lists its signature', async () => {
    const [a, b] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    await fund(url, a.address, 1_000_000_000n);
    const latest = await reader.getLatestBlockhash();
    const sig = await new KitChainReader(url).send(await transferWire(a, b.address, 5_000_000n, latest));
    expect(await reader.confirm(sig, latest.lastValidBlockHeight, { pollMs: 200 })).toBe('confirmed');
    const sigs = await reader.getSignatures(a.address, { limit: 10 });
    expect(sigs.map((s) => s.signature)).toContain(sig);
    expect(await reader.getBalance(b.address)).toBe(5_000_000n);
  });
});
