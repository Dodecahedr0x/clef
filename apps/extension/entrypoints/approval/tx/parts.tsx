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

/** Dangers are never folded away: each is one compact line, title then message. */
export function DangerCards({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <section aria-label="Danger" className="flex flex-col gap-1.5 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2">
      {warnings.map((w, i) => (
        <p key={i} className="m-0 flex items-baseline gap-2 text-xs leading-[1.45] text-danger-ink">
          <span className="flex-none rounded-full bg-danger px-1.5 text-[10px] leading-4 font-semibold tracking-[0.04em] text-white">DANGER</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <strong className="font-semibold text-danger-ink-2">{ruleTitle(w.rule)}.</strong> {w.message}
          </span>
        </p>
      ))}
    </section>
  );
}

/** Warnings beyond this many are behind "Show N more". */
export const WARN_VISIBLE = 3;

export function WarnCards({ warnings }: { warnings: Warning[] }) {
  const addIdl = useIdlAdder();
  const [all, setAll] = useState(false);
  if (!warnings.length) return null;
  // Warnings before infos, so folding hides the least important.
  const sorted = [...warnings.filter((w) => w.severity !== 'info'), ...warnings.filter((w) => w.severity === 'info')];
  const shown = all ? sorted : sorted.slice(0, WARN_VISIBLE);
  return (
    <section aria-label="Warnings" className="flex flex-col gap-1 rounded-[10px] border border-warn-line bg-warn-bg px-3 py-2 text-xs leading-[1.45] text-warn-ink">
      {shown.map((w, i) => (
        <div key={i} className="flex flex-col">
          <div className="flex items-baseline gap-2">
            <span className={`flex-none rounded-full px-1.5 text-[10px] leading-4 font-semibold text-white ${w.severity === 'info' ? 'bg-info' : 'bg-warn'}`}>{w.severity === 'info' ? 'INFO' : 'WARN'}</span>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {w.message}
              {w.details && w.details.length > 0 && (
                <details className="inline [&[open]]:block">
                  <summary className="ml-1 inline cursor-pointer font-semibold underline">Why?</summary>
                  <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4 [overflow-wrap:anywhere]">
                    {w.details.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
            </span>
            {w.programId && addIdl && (
              <button type="button" onClick={() => addIdl(w.programId!)} className="ml-auto flex-none border-0 bg-transparent p-0 text-xs font-semibold whitespace-nowrap text-info underline">
                Add IDL
              </button>
            )}
          </div>
        </div>
      ))}
      {sorted.length > WARN_VISIBLE && (
        <button type="button" onClick={() => setAll(!all)} className="self-start border-0 bg-transparent p-0 text-xs font-semibold text-warn-ink underline">
          {all ? 'Show fewer' : `Show ${sorted.length - WARN_VISIBLE} more`}
        </button>
      )}
    </section>
  );
}

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
