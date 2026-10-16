import { KNOWN_MINTS } from '@clef/explain';

export type VerifiedMint = { symbol: string; name: string };

/** Curated mints Clef names itself: on-chain metadata never overrides these, and they are never spam. */
export const VERIFIED_MINTS: ReadonlyMap<string, VerifiedMint> = new Map<string, VerifiedMint>([
  ...Object.entries(KNOWN_MINTS).map(([mint, m]): [string, VerifiedMint] => [mint, { symbol: m.symbol, name: m.symbol }]),
  ['So11111111111111111111111111111111111111112', { symbol: 'wSOL', name: 'Wrapped SOL' }],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', name: 'USD Coin' }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', name: 'Tether USD' }],
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', { symbol: 'JUP', name: 'Jupiter' }],
  ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', { symbol: 'PYUSD', name: 'PayPal USD' }],
  ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', { symbol: 'mSOL', name: 'Marinade staked SOL' }],
  ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', { symbol: 'JitoSOL', name: 'Jito Staked SOL' }],
  ['bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', { symbol: 'bSOL', name: 'BlazeStake Staked SOL' }],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', { symbol: 'Bonk', name: 'Bonk' }],
]);

export const isVerifiedMint = (mint: string): boolean => VERIFIED_MINTS.has(mint);
