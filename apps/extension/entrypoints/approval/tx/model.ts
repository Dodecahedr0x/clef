import type { BatchView, ExpertView, RelationEdge, Warning } from '@clef/explain';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';

export type Tab = 'all' | number;

export const MINUS = '−';
export const displaySign = (s: string) => (s === '-' ? MINUS : s);
/** Amount strings from views use an ASCII minus; shown with the typographic one. */
/**
 * An engine amount ('-1234567.891234', '+5 (raw units)') for display: a real minus sign and grouped thousands.
 * `round`: Basic keeps 4 decimals (more for amounts under 1, enough to show 2 significant digits) and marks the cut
 * with '…'; the exact value is for a tooltip and for Expert.
 */
export function displayAmount(a: string, opts: { round?: boolean } = {}): string {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(.*)$/s.exec(a);
  if (!m) return a.startsWith('-') ? MINUS + a.slice(1) : a;
  const [, sign = '', whole = '', fraction = '', rest = ''] = m;
  let frac = fraction;
  let cut = false;
  if (opts.round && frac) {
    const keep = whole !== '0' ? 4 : Math.max(6, (/^0*/.exec(frac)?.[0].length ?? 0) + 2);
    if (frac.length > keep) {
      frac = frac.slice(0, keep).replace(/0+$/, '');
      cut = true;
    }
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign === '-' ? MINUS : sign}${grouped}${frac ? `.${frac}` : ''}${cut ? '…' : ''}${rest}`;
}

/** Thousands grouped in prose ("Send 1234567.5 USDC" -> "Send 1,234,567.5 USDC"); addresses and short numbers untouched. */
export const groupNumbers = (text: string) => text.replace(/(?<![\w.…,])(\d{4,})(?=(?:\.\d+)?(?![\w…]))/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ','));

/** '1 new account' / '2 new accounts'. */
/** The USD value of a signed display amount ("-1,234.5"), or null when the amount is in raw units or unpriced. */
export function usdOf(amount: string, usdPrice: number | undefined): number | null {
  if (usdPrice === undefined || amount.includes('raw')) return null;
  const n = Number(amount.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n * usdPrice : null;
}

export const depositNote = (count: number) => `Opens ${count} new ${count === 1 ? 'account' : 'accounts'}; the SOL comes back to whoever closes ${count === 1 ? 'it' : 'them'}.`;
export const direction = (a: string): 'in' | 'out' | 'neutral' => (a.startsWith('-') ? 'out' : a.startsWith('+') ? 'in' : 'neutral');

export const hasDanger = (warnings: readonly Warning[]) => warnings.some((w) => w.severity === 'danger');

export function batchWarnings(view: BatchView): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  const add = (w: Warning) => {
    const key = `${w.severity}|${w.rule}|${w.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  };
  for (const s of view.steps) {
    if (!unexplained(s)) continue;
    // The RPC's own words for the failure, under "Why?".
    const details = s.view?.warnings.find((w) => (w.rule === 'simulation-failed' || w.rule === 'transaction-failed') && w.details?.length)?.details;
    add({ rule: UNEXPLAINED_RULE, severity: 'danger', message: unexplainedMessage(s), ...(details && { details }) });
  }
  view.combined.warnings.forEach(add);
  for (const s of view.steps) s.view?.warnings.forEach(add);
  return out;
}

export const UNEXPLAINED_RULE = 'unexplained-step';

/** Fails closed: a step without a view, or one the simulation did not reach, counts as danger whatever the engine says. */
export const unexplained = (s: BatchView['steps'][number]) => !s.view || s.status === 'failed' || s.status === 'not-simulated';

function unexplainedMessage(s: BatchView['steps'][number]): string {
  const why = !s.view ? 'it could not be decoded' : s.status === 'failed' ? 'its simulation failed' : 'it was not simulated';
  return `Clef could not explain transaction ${s.index + 1}: ${why}. Signing what you cannot see can lose funds.`;
}

/** What a danger means, in a few plain words (the message says who and how much). Unlisted rules: 'owner-change' -> 'Owner change'. */
const RULE_TITLES: Record<string, string> = {
  'unexplained-step': "Clef can't read this",
  'could-not-explain': "Clef can't read this",
  'internal-error': "Clef can't read this",
  'authority-change': 'Gives away control',
  delegation: 'Lets someone spend your tokens',
  'close-to-third-party': "Sends an account's balance to someone else",
  'relation-mismatch': 'Wrong account',
  'unexplained-outflow': "Funds leave in a way Clef can't read",
  sweep: 'Moves your assets away',
  'sensitive-program': 'Changes stake, vote or program accounts',
  'stake-withdraw': 'Withdraws your stake to someone else',
  'stake-foreign-authority': 'Someone else controls this stake',
  'high-fee': 'Very high fee',
};

export const ruleTitle = (rule: string) => {
  if (RULE_TITLES[rule]) return RULE_TITLES[rule];
  const t = rule.replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const TRUST_LABEL: Record<string, string> = { curated: 'Curated IDL', authority: 'Published IDL', user: 'Your IDL' };

export function accountLabel(state: FullState, address: string): string {
  return state.accounts.find((a) => a.address === address)?.label ?? shortAddress(address);
}

export function networkName(chain: string): string {
  const c = chain.replace(/^solana:/, '');
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export const stepStatusLabel: Record<string, { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  simulated: { text: '✓ simulated', tone: 'ok' },
  independent: { text: '✓ simulated alone', tone: 'ok' },
  dependent: { text: 'depends on earlier', tone: 'warn' },
  'not-simulated': { text: 'not simulated', tone: 'muted' },
  failed: { text: '✗ fails', tone: 'danger' },
};

export function listSteps(indexes: number[]): string {
  const n = indexes.map((i) => String(i + 1));
  if (n.length <= 1) return `transaction ${n[0] ?? ''}`.trim();
  return `transactions ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Expert views visible for the selected tab, with their 0-based step index. */
export function expertSteps(view: BatchView<'expert'>, tab: Tab): { index: number; title: string; view: ExpertView }[] {
  return view.steps
    .filter((s) => (tab === 'all' || s.index === tab) && s.view)
    .map((s) => ({ index: s.index, title: s.title, view: s.view as ExpertView }));
}

export const edgeKey = (e: RelationEdge) => `${e.kind}|${e.from}|${e.to}|${e.label}`;

/** Compute units for display: engine views already end in " CU"; bare numbers get it added. */
export const withCu = (v: string): string => (v.endsWith(' CU') ? v : `${v} CU`);
/** The bare number, for "used / limit CU". */
export const cuNumber = (v: string): string => v.replace(/ CU$/, '');
