import { describe, expect, it } from 'vitest';
import { address, getAddressDecoder } from '@solana/kit';
import { MemoryChainReader } from '@clef/rpc';
import type { DasAsset, PortfolioReader, PriceQuote, PriceSource, TokenAccountInfo } from '../src/deps';
import { metaplexMetadataPda } from '../src/metadata';
import { loadPortfolio } from '../src/portfolio';
import { isVerifiedMint } from '../src/verified-mints';
import { isSpam } from '../src/spam';
import { METAPLEX, TOKEN, TOKEN_2022, metaplexMetadata, token2022MintWithMetadata, tokenMint } from './fixtures';

const OWNER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const AUTH = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const fake = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const T22 = fake(1);
const MPX = fake(2);
const SPAM = fake(3);
const ACC = (n: number) => fake(10 + n);

const accounts: TokenAccountInfo[] = [
  { address: ACC(0), mint: USDC, owner: OWNER, amount: 100_000_000n, decimals: 6, program: TOKEN, delegate: null, delegatedAmount: 0n, state: 'initialized' },
  { address: ACC(1), mint: T22, owner: OWNER, amount: 4_000_000_000n, decimals: 9, program: TOKEN_2022, delegate: AUTH, delegatedAmount: 5n, state: 'initialized' },
  { address: ACC(2), mint: MPX, owner: OWNER, amount: 10_00n, decimals: 2, program: TOKEN, delegate: null, delegatedAmount: 0n, state: 'initialized' },
  { address: ACC(3), mint: SPAM, owner: OWNER, amount: 1_000n, decimals: 0, program: TOKEN, delegate: null, delegatedAmount: 0n, state: 'initialized' },
];

const das: DasAsset[] = [
  { id: USDC, interface: 'FungibleToken', name: 'USD Coin', symbol: 'USDC', decimals: 6, balance: 100_000_000n, tokenProgram: TOKEN, mintAuthority: null, freezeAuthority: null },
  { id: T22, interface: 'FungibleToken', name: 'Twenty Two', symbol: 'TT', decimals: 9, balance: 4_000_000_000n, tokenProgram: TOKEN_2022, mintAuthority: AUTH, freezeAuthority: null },
  { id: MPX, interface: 'FungibleToken', name: 'Meta Token', symbol: 'MPX', decimals: 2, balance: 1000n, tokenProgram: TOKEN, mintAuthority: null, freezeAuthority: AUTH },
  { id: SPAM, interface: 'FungibleToken', decimals: 0, balance: 1000n, tokenProgram: TOKEN, mintAuthority: AUTH, freezeAuthority: null },
];

async function chain(): Promise<MemoryChainReader> {
  const c = new MemoryChainReader();
  c.setAccount({ address: USDC, owner: TOKEN, data: tokenMint(6) });
  c.setAccount({ address: T22, owner: TOKEN_2022, data: token2022MintWithMetadata(T22, 9, { name: 'Twenty Two', symbol: 'TT', uri: '' }, AUTH) });
  c.setAccount({ address: MPX, owner: TOKEN, data: tokenMint(2, null, AUTH) });
  c.setAccount({ address: await metaplexMetadataPda(MPX), owner: METAPLEX, data: metaplexMetadata(MPX, { name: 'Meta Token', symbol: 'MPX', uri: 'https://x/m.json' }) });
  c.setAccount({ address: SPAM, owner: TOKEN, data: tokenMint(0, AUTH) });
  return c;
}

function reader(opts: { das: boolean | 'throws' }): PortfolioReader {
  const no = () => Promise.reject(new Error('unused'));
  return {
    getBalance: async () => 2_000_000_000n,
    getTokenAccounts: async () => accounts.map((a) => ({ ...a })),
    hasDas: async () => opts.das !== false,
    getAssetsByOwner: async () => {
      if (opts.das === 'throws') throw new Error('DAS down');
      return das.map((a) => ({ ...a }));
    },
    getSignatures: no,
    getHealth: no,
    getLatestBlockhash: no,
    confirm: no,
  };
}

const quotes: Record<string, PriceQuote> = {
  SOL: { usdPrice: 150, priceChange24h: 2 },
  [USDC]: { usdPrice: 1, priceChange24h: 0 },
  [T22]: { usdPrice: 0.5, priceChange24h: -10 },
  [MPX]: { usdPrice: 3, priceChange24h: null },
};
const prices: PriceSource = { prices: async (mints) => Object.fromEntries(Object.entries(quotes).filter(([m]) => mints.includes(m))) };

describe('loadPortfolio', () => {
  it('DAS and RPC fallback paths produce the same portfolio', async () => {
    const c = await chain();
    const viaDas = await loadPortfolio({ reader: reader({ das: true }), chain: c, prices }, OWNER, { hideSpam: true });
    const viaRpc = await loadPortfolio({ reader: reader({ das: false }), chain: c, prices }, OWNER, { hideSpam: true });
    const viaFallback = await loadPortfolio({ reader: reader({ das: 'throws' }), chain: c, prices }, OWNER, { hideSpam: true });
    expect(viaDas.source).toBe('das');
    expect(viaRpc.source).toBe('rpc');
    expect(viaFallback.source).toBe('rpc');
    expect({ ...viaDas, source: 'rpc' }).toEqual(viaRpc);
    expect(viaFallback).toEqual(viaRpc);
  });

  it('puts SOL first, then sorts by USD value, with names from the verified list, Token-2022 and Metaplex metadata', async () => {
    const p = await loadPortfolio({ reader: reader({ das: false }), chain: await chain(), prices }, OWNER, { hideSpam: true });
    expect(p.holdings.map((h) => [h.symbol, h.name, h.uiAmount, h.usdValue])).toEqual([
      ['SOL', 'Solana', '2', 300],
      ['USDC', 'USD Coin', '100', 100],
      ['MPX', 'Meta Token', '10', 30],
      ['TT', 'Twenty Two', '4', 2],
    ]);
    const tt = p.holdings.find((h) => h.symbol === 'TT')!;
    expect(tt).toMatchObject({ mint: T22, program: 'token-2022', tokenAccount: ACC(1), delegate: AUTH, mintAuthority: AUTH, freezeAuthority: null, verified: false, spam: false });
    expect(p.holdings[0]).toMatchObject({ mint: 'SOL', program: 'native', decimals: 9, amount: 2_000_000_000n, verified: true, change24h: 2 });
    expect(p.holdings.find((h) => h.symbol === 'MPX')).toMatchObject({ freezeAuthority: AUTH, mintAuthority: null, program: 'token' });
  });

  it('flags verified mints', async () => {
    const p = await loadPortfolio({ reader: reader({ das: false }), chain: await chain(), prices }, OWNER, { hideSpam: true });
    expect(p.holdings.filter((h) => h.verified).map((h) => h.symbol)).toEqual(['SOL', 'USDC']);
    expect(isVerifiedMint(USDC)).toBe(true);
    expect(isVerifiedMint('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN')).toBe(true);
    expect(isVerifiedMint(SPAM)).toBe(false);
  });

  it('hides and counts spam when hideSpam, shows it flagged otherwise', async () => {
    const c = await chain();
    const hidden = await loadPortfolio({ reader: reader({ das: false }), chain: c, prices }, OWNER, { hideSpam: true });
    expect(hidden.hiddenSpam).toBe(1);
    expect(hidden.holdings.some((h) => h.mint === SPAM)).toBe(false);
    const shown = await loadPortfolio({ reader: reader({ das: false }), chain: c, prices }, OWNER, { hideSpam: false });
    expect(shown.hiddenSpam).toBe(0);
    expect(shown.holdings.at(-1)).toMatchObject({ mint: SPAM, spam: true, usdValue: null });
    expect(shown.totalUsd).toBe(hidden.totalUsd);
  });

  it('totals USD and the 24h change', async () => {
    const p = await loadPortfolio({ reader: reader({ das: false }), chain: await chain(), prices }, OWNER, { hideSpam: true });
    expect(p.totalUsd).toBeCloseTo(432);
    // SOL 300 at +2% -> +5.882; USDC 0; TT 2 at -10% -> -0.222; MPX unknown change -> 0
    expect(p.change24hUsd).toBeCloseTo(300 - 300 / 1.02 + (2 - 2 / 0.9));
  });

  it('hides USD when prices are unavailable and flags no spam on missing prices', async () => {
    const failing: PriceSource = { prices: () => Promise.reject(new Error('429')) };
    for (const src of [null, failing]) {
      const p = await loadPortfolio({ reader: reader({ das: false }), chain: await chain(), prices: src }, OWNER, { hideSpam: true });
      expect(p.totalUsd).toBeNull();
      expect(p.change24hUsd).toBeNull();
      expect(p.holdings.every((h) => h.usdValue === null && h.usdPrice === null)).toBe(true);
      // without metadata it is still spam; priced-zero rule needs prices
      expect(p.hiddenSpam).toBe(1);
      expect(p.holdings.map((h) => h.symbol)).toEqual(['SOL', 'MPX', 'TT', 'USDC']);
    }
  });

  it('skips empty token accounts and merges accounts of one mint', async () => {
    const r = reader({ das: false });
    const extra: TokenAccountInfo[] = [
      { ...accounts[0]!, address: ACC(3), amount: 50_000_000n },
      { ...accounts[2]!, address: ACC(1), amount: 0n },
    ];
    r.getTokenAccounts = async () => [accounts[0]!, ...extra];
    const p = await loadPortfolio({ reader: r, chain: await chain(), prices }, OWNER, { hideSpam: true });
    expect(p.holdings.map((h) => [h.symbol, h.uiAmount, h.tokenAccount])).toEqual([
      ['SOL', '2', undefined],
      ['USDC', '150', ACC(0)],
    ]);
  });
});

describe('isSpam', () => {
  it('flags unverified tokens without metadata, or quoted at exactly zero once prices loaded', () => {
    expect(isSpam({ verified: false, hasMetadata: false, usdValue: null }, false)).toBe(true);
    expect(isSpam({ verified: false, hasMetadata: true, usdValue: 0 }, true)).toBe(true);
    expect(isSpam({ verified: false, hasMetadata: true, usdValue: 0 }, false)).toBe(false);
  });

  it('never flags a named token just because it has no price quote', () => {
    expect(isSpam({ verified: false, hasMetadata: true, usdValue: null }, true)).toBe(false);
  });

  it('never flags verified tokens', () => {
    expect(isSpam({ verified: true, hasMetadata: false, usdValue: 0 }, true)).toBe(false);
  });
});
