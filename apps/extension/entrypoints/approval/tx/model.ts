import type { BatchView, ExpertView, RelationEdge, Warning } from '@clef/explain';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';

export type Tab = 'all' | number;

export const MINUS = '−';
export const displaySign = (s: string) => (s === '-' ? MINUS : s);
/** Amount strings from views use an ASCII minus; shown with the typographic one. */
export const displayAmount = (a: string) => (a.startsWith('-') ? MINUS + a.slice(1) : a);
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
  view.combined.warnings.forEach(add);
  for (const s of view.steps) s.view?.warnings.forEach(add);
  return out;
}

/** 'owner-change' -> 'Owner change'. */
export const ruleTitle = (rule: string) => {
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
