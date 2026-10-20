import type { ChangeView, Warning } from '@clef/explain';
import type { PhishingHit } from '@clef/wallet-core';
import { Icon, Pubkey } from '../../../components';
import { depositNote, direction, displayAmount, groupNumbers, listSteps, ruleTitle, type Tab } from './model';
import { useState } from 'react';
import { useAddressBook, useIdlAdder, useOnChain } from './source';

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
export function Summary({ text, className, plain = false }: { text: string; className: string; plain?: boolean }) {
  const [head, ...rest] = splitSummary(groupNumbers(plain ? plainNames(text) : text));
  if (useOnChain()) return <p className="m-0 text-xs leading-normal text-muted [overflow-wrap:anywhere]">{[head, ...rest].join('. ')}</p>;
  return (
    <div className="flex flex-col gap-1">
      <h1 className={`${className} [overflow-wrap:anywhere]`}>{head}</h1>
      {rest.map((line, i) => (
        <p key={i} className="m-0 text-sm leading-snug font-medium text-danger-ink-2 [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The engine's one-line summary ("Send 1 SOL -- lets X spend ...") as a headline and the lines under it. */
export function splitSummary(text: string): string[] {
  return text.split(' -- ').map((part, i) => (i ? part.charAt(0).toUpperCase() + part.slice(1) : part));
}

/**
 * Basic: names without the IDL trust tier and address ("Foo (authority IDL, 9Wfh…Kz2r)"). A name a program gave
 * itself stays marked as unverified, so a self-described "System Program" can't pass for the real one.
 */
export function plainNames(text: string): string {
  return text
    .replace(/ \(curated IDL, [^)]*\)/g, '')
    .replace(/ \(user IDL, [^)]*\)/g, ' (your IDL)')
    .replace(/ \((?:authority|unknown) IDL, [^)]*\)/g, ' (unverified name)')
    .replace(/ \(address book, [^)]*\)/g, ' (your contact)');
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

const UNREADABLE = new Set(['could-not-explain', 'unexplained-step', 'internal-error']);

/** What the checkbox makes the user acknowledge, from the dangers on screen (`rule` or `rule\u0000message` keys). */
export function acknowledgeLabel(dangers: readonly string[]): string {
  const rules = new Set(dangers.map((k) => k.split('\u0000')[0]!));
  const phishing = rules.delete('phishing');
  const unreadable = [...rules].every((r) => UNREADABLE.has(r)) && rules.size > 0;
  if (phishing && rules.size === 0) return 'I understand this site is on a phishing list';
  if (phishing) return 'I understand this site is on a phishing list and I may lose funds';
  if (unreadable) return "I understand Clef can't show what this does";
  return 'I understand I may lose these funds';
}

export function Acknowledge({ checked, onChange, dangers = [] }: { checked: boolean; onChange: (v: boolean) => void; dangers?: readonly string[] }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="m-0 size-5 flex-none accent-danger" />
      <span>{acknowledgeLabel(dangers)}</span>
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

export function Deltas({ changes, fee, deposits }: { changes: ChangeView[] | null; fee?: string | null; deposits?: { amount: string; count: number } | null }) {
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
      {deposits && (
        <span className="text-muted" title={depositNote(deposits.count)}>
          account deposit {deposits.amount}
        </span>
      )}
    </div>
  );
}

/** Who a plain send pays, so the address can be checked against the one the user was given. */
export function Recipient({ address }: { address: string }) {
  const known = useAddressBook()(address);
  const onChain = useOnChain();
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
      <span>To</span>
      {known && <span className="font-medium text-ink">{known.name}</span>}
      <Pubkey value={address} className={known ? 'text-xs' : 'text-ink'} />
      <span className="text-xs">
        {known
          ? known.kind === 'account'
            ? '· one of your accounts'
            : '· in your address book'
          : onChain
            ? '· not in your address book'
            : '· not in your address book. Check it matches the address you were given.'}
      </span>
    </p>
  );
}

export const UNKNOWN_CHANGES = 'Balance changes could not be simulated. Clef cannot tell what this request moves.';
