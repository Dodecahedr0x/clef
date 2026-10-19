import type { ChangeView, Warning } from '@clef/explain';
import type { PhishingHit } from '@clef/wallet-core';
import { Icon } from '../../../components';
import { direction, displayAmount, listSteps, ruleTitle, type Tab } from './model';
import { useState } from 'react';
import { useIdlAdder, useOnChain } from './source';

export function PhishingBanner({ hit }: { hit: PhishingHit }) {
  return (
    <div role="alert" className="flex items-center gap-2 bg-danger-bg-2 px-4 py-2.5 text-xs text-danger-ink-2">
      <span className="text-danger">
        <Icon name="warn" size={16} />
      </span>
      <span>This site is on a phishing list</span>
      <span className="ml-auto font-mono text-danger-ink">{hit.reason === 'fuzzy' ? `looks like ${hit.match}` : hit.match}</span>
    </div>
  );
}

/**
 * Clef's one-line description of the transaction: the heading of a request to sign; for a past transaction
 * (whose title is its signature) a small grey line.
 */
export function Summary({ text, className }: { text: string; className: string }) {
  if (useOnChain()) return <p className="m-0 text-xs leading-normal text-muted [overflow-wrap:anywhere]">{text}</p>;
  return <h1 className={className}>{text}</h1>;
}

/** Warnings and infos beyond this many are behind "Show N more" (dangers never are). */
export const WARN_VISIBLE = 3;

const PILL: Record<Warning['severity'], { text: string; className: string }> = {
  danger: { text: 'DANGER', className: 'bg-danger' },
  warn: { text: 'WARN', className: 'bg-warn' },
  info: { text: 'INFO', className: 'bg-info' },
};
const RANK: Record<Warning['severity'], number> = { danger: 0, warn: 1, info: 2 };

/**
 * Dangers, warnings and infos in one compact table, most severe first: a row each (severity, message, action).
 * Dangers are tinted and never folded away; the rest fold after three.
 */
export function WarningsTable({ warnings }: { warnings: Warning[] }) {
  const addIdl = useIdlAdder();
  const [all, setAll] = useState(false);
  if (!warnings.length) return null;
  const sorted = [...warnings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const dangers = sorted.filter((w) => w.severity === 'danger').length;
  const shown = all ? sorted : sorted.slice(0, dangers + WARN_VISIBLE);
  return (
    <section aria-label={dangers ? 'Danger and warnings' : 'Warnings'} className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <table className="w-full border-collapse text-xs leading-[1.45]">
        <tbody>
          {shown.map((w, i) => {
            const danger = w.severity === 'danger';
            return (
              <tr key={i} className={`border-t border-line-soft first:border-t-0 ${danger ? 'bg-danger-bg text-danger-ink' : 'text-ink'}`}>
                <td className="w-px py-1.5 pr-2 pl-2.5 align-top">
                  <span className={`inline-block rounded-full px-1.5 text-[10px] leading-4 font-semibold tracking-[0.04em] whitespace-nowrap text-white ${PILL[w.severity].className}`}>{PILL[w.severity].text}</span>
                </td>
                <td className="py-1.5 pr-2.5 align-top [overflow-wrap:anywhere]">
                  {danger && <strong className="font-semibold text-danger-ink-2">{ruleTitle(w.rule)}. </strong>}
                  {w.message}
                  {w.details && w.details.length > 0 && (
                    <details className="inline [&[open]]:block">
                      <summary className="ml-1 inline cursor-pointer font-semibold text-muted underline">Why?</summary>
                      <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4 text-muted [overflow-wrap:anywhere]">
                        {w.details.map((d, j) => (
                          <li key={j}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                {w.programId && addIdl ? (
                  <td className="w-px py-1.5 pr-2.5 align-top whitespace-nowrap">
                    <button type="button" onClick={() => addIdl(w.programId!)} className="border-0 bg-transparent p-0 text-xs font-semibold text-info underline">
                      Add IDL
                    </button>
                  </td>
                ) : (
                  <td className="w-px p-0" />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > dangers + WARN_VISIBLE && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-0 border-t border-line-soft bg-surface-2 px-2.5 py-1 text-left text-xs font-semibold text-muted">
          {all ? 'Show fewer' : `Show ${sorted.length - shown.length} more`}
        </button>
      )}
    </section>
  );
}

/** The table, for dangers alone (e.g. "could not explain"). */
export const DangerCards = WarningsTable;
/** The table, for warnings alone. */
export const WarnCards = WarningsTable;

export function AllClear({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <section className="flex items-center gap-2 rounded-[10px] border border-ok-line bg-ok-bg px-3 py-[9px] text-xs text-ok-ink">
        <span className="text-ok">
          <Icon name="shield-check" size={16} />
        </span>
        <span>No warnings</span>
      </section>
    );
  }
  return (
    <section className="flex items-center gap-2.5 rounded-xl border border-ok-line bg-ok-bg px-3.5 py-3">
      <span className="text-ok">
        <Icon name="shield-check" size={20} />
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-ok-ink">No warnings</span>
        <span className="text-xs text-ok-ink-2">Clef found nothing unusual in this request</span>
      </div>
    </section>
  );
}

export function Acknowledge({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="m-0 size-5 flex-none accent-danger" />
      <span>I understand I may lose these funds</span>
    </label>
  );
}

export function IncompleteNotice({ dependentSteps }: { dependentSteps: number[] }) {
  return (
    <section role="note" aria-label="Incomplete simulation" className="flex flex-col gap-1 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-xs leading-[1.45] text-warn-ink">
      <span className="font-semibold">Combined view is incomplete</span>
      <span>
        {dependentSteps.length
          ? `Your RPC simulated each transaction alone, so ${listSteps(dependentSteps)} (which use accounts changed by earlier ones) are left out of the totals.`
          : 'Your RPC simulated each transaction alone, so the totals may not match what happens in order.'}
      </span>
      <span>Use an RPC that supports simulateBundle (Settings · Network &amp; RPC) to simulate them in order.</span>
    </section>
  );
}

export function TxTabs({ titles, value, onChange }: { titles: string[]; value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [{ id: 'all', label: `All ${titles.length} · combined` }, ...titles.map((t, i) => ({ id: i, label: `${i + 1} · ${t}` }))];
  return (
    <div role="tablist" aria-label="Transactions in this request" className="flex flex-wrap items-center gap-1.5">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={String(t.id)}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`flex h-[34px] items-center gap-1.5 rounded-[9px] px-3 text-xs font-semibold ${on ? 'bg-ink text-white' : 'border border-line-strong bg-surface text-ink'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Deltas({ changes, fee }: { changes: ChangeView[] | null; fee?: string | null }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm tabular-nums">
      {changes === null ? (
        <span className="text-warn">balance changes unknown</span>
      ) : (
        changes.map((c, i) => (
          <span key={i} className={direction(c.amount) === 'out' ? 'text-danger-text' : direction(c.amount) === 'in' ? 'text-ok' : 'text-muted'}>
            {displayAmount(c.amount)} {c.asset}
          </span>
        ))
      )}
      {fee && <span className="text-muted">fee {fee}</span>}
    </div>
  );
}

export const UNKNOWN_CHANGES = 'Balance changes could not be simulated. Clef cannot tell what this request moves.';
