import type { Address } from '@solana/kit';
import type { ChainReader } from '@clef/rpc';
import { TOKEN_2022_PROGRAM, formatUnits, sanitizeText, shortAddress } from '@clef/explain';
import type { DasAsset, PortfolioReader, PriceQuote, PriceSource, TokenAccountInfo } from './deps';
import { decodeMetaplexMetadata, decodeMintInfo, metaplexMetadataPda } from './metadata';
import { isSpam } from './spam';
import { VERIFIED_MINTS } from './verified-mints';

export type Holding = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: bigint;
  uiAmount: string;
  usdPrice: number | null;
  usdValue: number | null;
  change24h: number | null;
  program: 'native' | 'token' | 'token-2022';
  tokenAccount?: Address;
  verified: boolean;
  spam: boolean;
  logoUri?: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  delegate?: string | null;
};
export type Portfolio = { owner: Address; totalUsd: number | null; change24hUsd: number | null; holdings: Holding[]; hiddenSpam: number; source: 'das' | 'rpc';
  /** Set when the RPC refused to list token accounts (e.g. a free public endpoint): only SOL is shown. */
  tokensUnavailable?: true;
  /** Set when the price source rejected the configured API key: prices are missing until the user fixes it. */
  priceError?: 'invalid-key';
};

type MintMeta = { name?: string; symbol?: string; mintAuthority: string | null; freezeAuthority: string | null };

/** Metadata per mint from DAS. Logos are not used: loading them would reach arbitrary hosts. */
function fromDas(assets: DasAsset[]): Map<string, MintMeta> {
  return new Map(
    assets.map((a) => [a.id, { name: a.name, symbol: a.symbol, mintAuthority: a.mintAuthority ?? null, freezeAuthority: a.freezeAuthority ?? null }]),
  );
}

/** Metadata per mint from chain reads: Token-2022 metadata extension first, then Metaplex Token Metadata. */
async function fromChain(chain: ChainReader, mints: Address[]): Promise<Map<string, MintMeta>> {
  const pdas = await Promise.all(mints.map(metaplexMetadataPda));
  const [mintAccounts, metaAccounts] = await Promise.all([chain.getAccounts(mints), chain.getAccounts(pdas)]);
  const out = new Map<string, MintMeta>();
  mints.forEach((mint, i) => {
    const acc = mintAccounts[i];
    const info = acc ? decodeMintInfo(mint, acc.data, acc.owner) : null;
    const meta = metaAccounts[i];
    const md = info?.metadata ?? (meta ? decodeMetaplexMetadata(meta.data, mint) : null);
    out.set(mint, { name: md?.name, symbol: md?.symbol, mintAuthority: info?.mintAuthority ?? null, freezeAuthority: info?.freezeAuthority ?? null });
  });
  return out;
}

async function loadPrices(prices: PriceSource | null, mints: string[]): Promise<Record<string, PriceQuote> | 'invalid-key' | null> {
  if (!prices) return null;
  try {
    return await prices.prices(['SOL', ...mints]);
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === 'invalid-key' ? 'invalid-key' : null;
  }
}

const clean = (s: string | undefined, max: number) => (s === undefined ? '' : sanitizeText(s, max).trim());

function usd(amount: bigint, decimals: number, quote: PriceQuote | undefined) {
  if (!quote) return { usdPrice: null, usdValue: null, change24h: null };
  return { usdPrice: quote.usdPrice, usdValue: Number(formatUnits(amount, decimals)) * quote.usdPrice, change24h: quote.priceChange24h };
}

export async function loadPortfolio(
  deps: { reader: PortfolioReader; chain: ChainReader; prices: PriceSource | null },
  owner: Address,
  opts: { hideSpam: boolean },
): Promise<Portfolio> {
  const [lamports, listed] = await Promise.all([
    deps.reader.getBalance(owner),
    deps.reader.getTokenAccounts(owner).catch(() => null),
  ]);
  const accounts = listed ?? [];

  // Accounts of one mint merge; the largest is the one to send from.
  const byMint = new Map<string, { accounts: TokenAccountInfo[]; amount: bigint }>();
  for (const a of accounts) {
    if (a.amount === 0n) continue;
    const entry = byMint.get(a.mint) ?? { accounts: [], amount: 0n };
    entry.accounts.push(a);
    entry.amount += a.amount;
    byMint.set(a.mint, entry);
  }
  const mints = [...byMint.keys()] as Address[];

  let source: Portfolio['source'] = 'rpc';
  let meta: Map<string, MintMeta> | null = null;
  try {
    if (mints.length && (await deps.reader.hasDas())) {
      meta = fromDas(await deps.reader.getAssetsByOwner(owner));
      source = 'das';
    }
  } catch {
    meta = null;
  }
  const [metadata, loaded] = await Promise.all([meta ?? fromChain(deps.chain, mints), loadPrices(deps.prices, mints)]);
  const quotes = loaded === 'invalid-key' ? null : loaded;

  const holdings: Holding[] = [
    {
      mint: 'SOL',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      amount: lamports,
      uiAmount: formatUnits(lamports, 9),
      ...usd(lamports, 9, quotes?.SOL),
      program: 'native',
      verified: true,
      spam: false,
    },
  ];
  for (const [mint, { accounts: list, amount }] of byMint) {
    const main = list.reduce((a, b) => (b.amount > a.amount ? b : a));
    const verified = VERIFIED_MINTS.get(mint);
    const m = metadata.get(mint);
    const name = verified?.name ?? clean(m?.name, 64);
    const symbol = verified?.symbol ?? clean(m?.symbol, 16);
    const price = usd(amount, main.decimals, quotes?.[mint]);
    holdings.push({
      mint,
      symbol: symbol || shortAddress(mint),
      name: name || 'Unknown token',
      decimals: main.decimals,
      amount,
      uiAmount: formatUnits(amount, main.decimals),
      ...price,
      program: main.program === TOKEN_2022_PROGRAM ? 'token-2022' : 'token',
      tokenAccount: main.address,
      verified: verified !== undefined,
      spam: isSpam({ verified: verified !== undefined, hasMetadata: Boolean(name && symbol), usdValue: price.usdValue }, quotes !== null),
      mintAuthority: m?.mintAuthority ?? null,
      freezeAuthority: m?.freezeAuthority ?? null,
      delegate: main.delegate,
    });
  }

  holdings.sort((a, b) => {
    if (a.mint === 'SOL' || b.mint === 'SOL') return a.mint === 'SOL' ? -1 : 1;
    if (a.spam !== b.spam) return a.spam ? 1 : -1;
    const d = (b.usdValue ?? -1) - (a.usdValue ?? -1);
    return d !== 0 ? d : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });

  const counted = holdings.filter((h) => !h.spam);
  const totalUsd = quotes ? counted.reduce((s, h) => s + (h.usdValue ?? 0), 0) : null;
  const change24hUsd = quotes
    ? counted.reduce((s, h) => (h.usdValue === null || h.change24h === null || h.change24h <= -100 ? s : s + h.usdValue - h.usdValue / (1 + h.change24h / 100)), 0)
    : null;
  const shown = opts.hideSpam ? counted : holdings;
  return { owner, totalUsd, change24hUsd, holdings: shown, hiddenSpam: holdings.length - shown.length, source, ...(listed === null && { tokensUnavailable: true as const }), ...(loaded === 'invalid-key' && { priceError: 'invalid-key' as const }) };
}
