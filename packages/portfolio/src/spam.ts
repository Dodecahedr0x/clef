/**
 * Spam heuristic: an unverified token with no name/symbol, or (when prices are known at all) one the price source
 * values at nothing. Zero-priced tokens only count once prices loaded, so a price outage hides nothing extra.
 */
export function isSpam(h: { verified: boolean; hasMetadata: boolean; usdValue: number | null }, pricesAvailable: boolean): boolean {
  if (h.verified) return false;
  if (!h.hasMetadata) return true;
  return pricesAvailable && (h.usdValue ?? 0) === 0;
}
