import type { BatchView, InstructionView, IntermediateView, Warning } from '@clef/explain';
import { useState } from 'react';
import { Icon, Pill } from '../../../components';
import { shortAddress } from '../../../lib/format';
import { stepStatusLabel, TRUST_LABEL, type Tab } from './model';
import { AllClear, DangerCards, Deltas, TxTabs, UNKNOWN_CHANGES, WarnCards } from './parts';

const SHOWN_ACCOUNTS = 5;

/** 'ATA ✓' -> ['✓ ATA', tone]. */
export function badgeParts(badge: string): { text: string; tone: string } {
  const m = /^(.*) (✓|✗|\?)$/.exec(badge);
  if (!m) return { text: badge, tone: 'text-muted' };
  const tone = m[2] === '✓' ? 'text-ok' : m[2] === '✗' ? 'text-danger-text' : 'text-warn';
  return { text: `${m[2]} ${m[1]}`, tone };
}

function InstructionCard({ ix }: { ix: InstructionView }) {
  const [all, setAll] = useState(false);
  const args = Object.entries(ix.args);
  const name = `${ix.program} · ${ix.name}`;
  if (!args.length && !ix.accounts.length) {
    return (
      <article aria-label={name} className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3">
        <span className="font-mono text-xs text-muted">{ix.index + 1}</span>
        <span className="text-sm">
          <span className="text-muted">{ix.program} ·</span> {ix.name}
        </span>
        {ix.trust && (
          <span className="ml-auto">
            <Pill tone="primary">{TRUST_LABEL[ix.trust] ?? ix.trust}</Pill>
          </span>
        )}
      </article>
    );
  }
  const accounts = all ? ix.accounts : ix.accounts.slice(0, SHOWN_ACCOUNTS);
  return (
    <article aria-label={name} className="overflow-hidden rounded-xl border border-line-strong bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft p-3">
        <span className="font-mono text-xs text-muted">{ix.index + 1}</span>
        <span className="text-sm font-semibold">
          <span className="font-normal text-muted">{ix.program} ·</span> {ix.name}
        </span>
        <span className="ml-auto">{ix.trust ? <Pill tone="primary">{TRUST_LABEL[ix.trust] ?? ix.trust}</Pill> : <Pill tone="warn">No IDL</Pill>}</span>
      </div>
      {args.length > 0 && (
        <dl className={`m-0 grid grid-cols-[136px_minmax(0,1fr)] gap-x-2 gap-y-2 px-3 py-2.5 text-xs ${ix.accounts.length ? 'border-b border-line-soft' : ''}`}>
          {args.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono break-all text-muted">{k}</dt>
              <dd className="m-0 break-all tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {ix.accounts.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0 py-1">
          {accounts.map((a, i) => (
            <li key={i} className={`flex flex-col gap-[3px] px-3 py-2 ${i ? 'border-t border-line-soft' : ''}`}>
              <span className="font-mono text-xs text-muted">{a.name}</span>
              <div className="flex items-center gap-1.5 text-sm">
                <span>{a.label ?? shortAddress(a.address)}</span>
                <span className="ml-auto flex gap-2 text-xs">
                  {a.badges.map((b, j) => {
                    const p = badgeParts(b);
                    return (
                      <span key={j} className={p.tone}>
                        {p.text}
                      </span>
                    );
                  })}
                </span>
              </div>
            </li>
          ))}
          {ix.accounts.length > SHOWN_ACCOUNTS && (
            <li className="border-t border-line-soft">
              <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="flex min-h-10 w-full items-center bg-transparent px-3 text-left text-xs text-muted">
                <span>{all ? 'Show fewer accounts' : `+ ${ix.accounts.length - SHOWN_ACCOUNTS} more accounts`}</span>
                <span className="ml-auto">
                  <Icon name={all ? 'chevron-up' : 'chevron-down'} size={14} />
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </article>
  );
}

function StepDetail({ view }: { view: IntermediateView }) {
  const n = view.instructions.length;
  return (
    <>
      <h2 className="m-0 mx-1 mt-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
        {n} instruction{n === 1 ? '' : 's'}
      </h2>
      {view.instructions.map((ix) => (
        <InstructionCard key={ix.index} ix={ix} />
      ))}
    </>
  );
}

function StepList({ view, onPick }: { view: BatchView<'intermediate'>; onPick: (t: Tab) => void }) {
  const n = view.steps.length;
  const c = view.combined;
  return (
    <>
      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex border-b border-line-soft bg-surface-3 px-3 py-2 text-xs text-muted">
          <span className="font-semibold tracking-[0.06em] uppercase">All {n} together</span>
          <span className="ml-auto">{view.mode === 'sequential' ? 'Simulated in order' : 'Simulated one by one'}</span>
        </div>
        {c.balanceChanges === null ? (
          <p className="m-0 px-3 py-2.5 text-sm text-warn-ink">{UNKNOWN_CHANGES}</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 px-3 py-2.5 text-sm tabular-nums">
            {c.balanceChanges.length === 0 && <span className="text-muted">None of your balances change</span>}
            {c.balanceChanges.map((b, i) => (
              <div key={i} className="contents">
                <span>{b.asset}</span>
                <span className={`text-right ${b.amount.startsWith('-') ? 'text-danger-text' : 'text-ok'}`}>
                  {b.amount.startsWith('-') ? `−${b.amount.slice(1)}` : b.amount} {b.asset}
                </span>
              </div>
            ))}
            {c.fee && (
              <div className="contents text-muted">
                <span className="text-xs">Network fees</span>
                <span className="text-right text-xs">{c.fee}</span>
              </div>
            )}
          </div>
        )}
      </section>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {view.steps.map((s) => {
          const st = stepStatusLabel[s.status] ?? { text: s.status, tone: 'muted' };
          return (
            <li key={s.index}>
              <button type="button" onClick={() => onPick(s.index)} className="flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left">
                <span className="flex size-[22px] flex-none items-center justify-center rounded-full bg-surface-2 font-mono text-xs">{s.index + 1}</span>
                <span className="flex-1 text-sm">{s.title}</span>
                <span className={`text-xs ${st.tone === 'ok' ? 'text-ok' : st.tone === 'warn' ? 'text-warn' : st.tone === 'danger' ? 'text-danger-text' : 'text-muted'}`}>{st.text}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      <section className="flex items-start gap-2.5 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-xs leading-[1.45] text-warn-ink">
        <span className="rounded-full bg-warn px-[7px] py-px text-xs font-semibold text-white">INFO</span>
        <span>All {n === 2 ? 'both' : n} are signed together. If one fails on-chain, the dApp decides what happens to the others.</span>
      </section>
    </>
  );
}

export function IntermediateBody({ view, tab, onTab, warnings }: { view: BatchView<'intermediate'>; tab: Tab; onTab: (t: Tab) => void; warnings: Warning[] }) {
  const single = view.steps.length === 1;
  const step = tab === 'all' ? (single ? view.steps[0] : undefined) : view.steps[tab];
  const sv = step?.view as IntermediateView | null | undefined;
  const summary = sv?.summary ?? view.combined.summary;
  const changes = sv ? sv.balanceChanges : view.combined.balanceChanges;
  const fee = sv ? (sv.fee ?? (single ? view.combined.fee : null)) : view.combined.fee;
  const shown = sv ? sv.warnings : warnings;
  const dangers = shown.filter((w) => w.severity === 'danger');
  const others = shown.filter((w) => w.severity !== 'danger');

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-[18px]">
      {!single && <TxTabs titles={view.steps.map((s) => s.title)} value={tab} onChange={onTab} />}
      <section className="flex flex-col gap-1 px-1">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.02em]">{summary}</h1>
        <Deltas changes={changes} fee={fee} />
      </section>
      <DangerCards warnings={dangers} />
      {others.length ? <WarnCards warnings={others} /> : dangers.length ? null : <AllClear compact />}
      {step && !sv && <p className="m-0 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-xs text-warn-ink">Clef could not explain this transaction.</p>}
      {sv ? <StepDetail view={sv} /> : !step && <StepList view={view} onPick={onTab} />}
    </div>
  );
}
