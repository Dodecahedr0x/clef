import type { ChangeView, Warning } from '@clef/explain';
import type { PhishingHit } from '@clef/wallet-core';
import { Icon } from '../../../components';
import { direction, displayAmount, listSteps, ruleTitle, type Tab } from './model';

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

export function DangerCards({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <section aria-label="Danger" className="flex flex-col gap-3 rounded-[14px] border border-danger-line bg-danger-bg p-3.5">
      {warnings.map((w, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold tracking-[0.04em] text-white">DANGER</span>
            <span className="text-sm font-semibold text-danger-ink-2">{ruleTitle(w.rule)}</span>
          </div>
          <p className="m-0 text-sm leading-normal text-danger-ink [overflow-wrap:anywhere]">{w.message}</p>
        </div>
      ))}
    </section>
  );
}

export function WarnCards({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  return (
    <section aria-label="Warnings" className="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-bg px-3.5 py-3 text-xs text-warn-ink">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`flex-none rounded-full px-[7px] py-px text-xs font-semibold text-white ${w.severity === 'info' ? 'bg-info' : 'bg-warn'}`}>{w.severity === 'info' ? 'INFO' : 'WARN'}</span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{w.message}</span>
        </div>
      ))}
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
