export type PriceQuote = { usdPrice: number; priceChange24h: number | null };

export interface PriceSource {
  prices(mints: readonly string[]): Promise<Record<string, PriceQuote>>;
}

export type SwapQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  minOutAmount: bigint;
  slippageBps: number;
  priceImpactPct: number;
  route: { label: string; percent: number }[];
  raw: unknown;
};

export type TokenSearchResult = { mint: string; symbol: string; name: string; decimals: number; icon?: string; verified: boolean };

export type JupiterErrorCode = 'invalid-key' | 'rate-limited' | 'bad-request' | 'unavailable';

export class JupiterError extends Error {
  constructor(
    readonly code: JupiterErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'JupiterError';
  }
}

export type JupiterConfig = { apiKey: string | null; host?: string; fetch?: typeof fetch; now?: () => number };

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
