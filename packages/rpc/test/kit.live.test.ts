import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { KitChainReader } from '../src';

describe.skipIf(!process.env.CLEF_LIVE_RPC)('KitChainReader (live)', () => {
  const reader = new KitChainReader(process.env.CLEF_LIVE_RPC ?? '');

  it('fetches the USDC mint', async () => {
    const usdc = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const [mint] = await reader.getAccounts([usdc]);
    expect(mint?.owner).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(mint?.data.length).toBe(82);
  });
});
