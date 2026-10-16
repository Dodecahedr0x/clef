/**
 * Spam heuristic: an unverified token with no name/symbol, or (when prices are known at all) one the price source
 * quotes at exactly zero. A token with no quote is not spam: price sources omit many legitimate tokens, and a
 * price outage must hide nothing extra.
 */
export function isSpam(h: { verified: boolean; hasMetadata: boolean; usdValue: number | null }, pricesAvailable: boolean): boolean {
  if (h.verified) return false;
  if (!h.hasMetadata) return true;
  return pricesAvailable && h.usdValue === 0;
}
