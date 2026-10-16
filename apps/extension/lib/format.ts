const MINUS = '−';
const DASH = '—';

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.005) return n < 0 ? `${MINUS}<$0.01` : '<$0.01';
  const text = `$${usd.format(abs)}`;
  return n < 0 && text !== '$0.00' ? MINUS + text : text;
}

export function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  const text = Math.abs(n).toFixed(1);
  if (text === '0.0') return '0.0%';
  return `${n < 0 ? MINUS : '+'}${text}%`;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Truncates (never rounds up) so a displayed balance is never more than what is held.
export function formatToken(amount: bigint, decimals: number, max = 4): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, '0') : '';
  frac = frac.slice(0, Math.min(max, decimals)).replace(/0+$/, '');
  const minFrac = Math.min(2, decimals);
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0');
  if (whole === 0n && abs > 0n && /^0*$/.test(frac)) return `${neg ? MINUS : ''}<0.${'0'.repeat(Math.max(0, Math.min(max, decimals) - 1))}1`;
  const text = frac ? `${group(whole.toString())}.${frac}` : group(whole.toString());
  return neg ? MINUS + text : text;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function timeAgo(ms: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  const d = new Date(ms);
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

export function shortAddress(a: string): string {
  return a.length <= 9 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
