import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { JupiterClient } from '../src';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TAKER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
// Keyless limit is 0.5 RPS.
const pause = () => new Promise((r) => setTimeout(r, 2_100));

describe.skipIf(!process.env.CLEF_LIVE_JUPITER)('JupiterClient (live)', () => {
  const client = new JupiterClient({ apiKey: process.env.CLEF_JUPITER_API_KEY ?? null });

  it('prices SOL and USDC', async () => {
    const prices = await client.prices(['SOL', USDC]);
    expect(prices.SOL?.usdPrice).toBeGreaterThan(0);
    expect(prices[USDC]?.usdPrice).toBeGreaterThan(0);
  });

  it('quotes and builds 0.01 SOL -> USDC as a decodable v0 wire', async () => {
    await pause();
    const { quote, wire } = await client.quoteAndBuild({ inputMint: 'SOL', outputMint: USDC, amount: 10_000_000n, slippageBps: 50, taker: TAKER });
    expect(quote.outAmount).toBeGreaterThan(0n);
    const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
    expect(msg.version).toBe(0);
    expect(msg.staticAccounts[0]).toBe(TAKER);
  }, 20_000);
});
