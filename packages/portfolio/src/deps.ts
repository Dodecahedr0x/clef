import type { Address } from '@solana/kit';

// Structural copies of @clef/rpc (§C2) and @clef/market (§C3) types, until those exports land.
export type TokenAccountInfo = { address: Address; mint: Address; owner: Address; amount: bigint; decimals: number; program: Address; delegate: Address | null; delegatedAmount: bigint; state: 'initialized' | 'frozen' };
export type DasAsset = { id: Address; interface: string; name?: string; symbol?: string; image?: string; decimals?: number; balance?: bigint; tokenProgram?: Address; mintAuthority?: string | null; freezeAuthority?: string | null };
export type SignatureInfo = { signature: string; slot: bigint; blockTime: number | null; err: unknown | null };
export interface PortfolioReader {
  getBalance(owner: Address): Promise<bigint>;
  getTokenAccounts(owner: Address): Promise<TokenAccountInfo[]>;
  hasDas(): Promise<boolean>;
  getAssetsByOwner(owner: Address): Promise<DasAsset[]>;
  getSignatures(address: Address, opts: { before?: string; limit: number }): Promise<SignatureInfo[]>;
  getHealth(): Promise<{ slot: bigint; latencyMs: number }>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  confirm(signature: string, lastValidBlockHeight: bigint, opts?: { pollMs?: number }): Promise<'confirmed' | 'failed' | 'expired'>;
}
export type PriceQuote = { usdPrice: number; priceChange24h: number | null };
export interface PriceSource { prices(mints: readonly string[]): Promise<Record<string, PriceQuote>> }
