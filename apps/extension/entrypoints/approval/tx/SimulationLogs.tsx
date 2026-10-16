import type { LogLineView } from '@clef/explain';
import { useState, type ReactNode } from 'react';
import { useOnChain } from './source';

type Filter = 'all' | 'program' | 'compute';
type Group = { index: number; title: string; computeUnits: string | null; failed: boolean; logs: LogLineView[] | null };

const KIND_TONE: Record<string, string> = { invoke: 'text-info', success: 'text-ok', failed: 'text-danger-text', consumed: 'text-muted', other: 'text-muted' };
const KEEP: Record<Filter, (l: LogLineView) => boolean> = {
  all: () => true,
  program: (l) => l.kind === 'log' || l.kind === 'data' || l.kind === 'return',
  compute: (l) => l.kind === 'consumed',
};

export function SimulationLogs({ groups, separators, meta }: { groups: Group[]; separators: boolean; meta: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const onChain = useOnChain();
  const failed = groups.some((g) => g.failed || g.logs?.some((l) => l.kind === 'failed'));
  const simulated = groups.some((g) => g.logs !== null);
  const status = failed ? { text: 'Failed', cls: 'bg-danger-bg text-danger-ink-2' } : simulated ? { text: 'Succeeded', cls: 'bg-ok-bg text-ok-ink' } : { text: onChain ? 'No logs' : 'Not simulated', cls: 'bg-warn-bg text-warn-ink' };

  const copy = () => {
    const text = groups.flatMap((g) => [...(separators ? [`# Transaction ${g.index + 1} · ${g.title}`] : []), ...(g.logs ?? []).map((l) => l.text)]).join('\n');
    void navigator.clipboard?.writeText(text);
  };

  let n = 0;
  const rows: ReactNode[] = [];
  for (const g of groups) {
    if (separators) {
      rows.push(
        <li key={`sep-${g.index}`} className="grid grid-cols-[40px_minmax(0,1fr)_96px] bg-surface-2 pr-3.5 font-semibold">
          <span />
          <span className="text-ink">
            Transaction {g.index + 1} · {g.title}
          </span>
          <span className="text-right text-muted">{g.computeUnits ? `${g.computeUnits} CU` : ''}</span>
        </li>,
      );
    }
    if (g.logs === null) {
      rows.push(
        <li key={`none-${g.index}`} className="grid grid-cols-[40px_minmax(0,1fr)_96px] pr-3.5">
          <span />
          <span className="font-sans text-muted">{onChain ? 'No logs recorded' : 'No logs: not simulated'}</span>
          <span />
        </li>,
      );
      continue;
    }
    for (const l of g.logs) {
      n++;
      if (!KEEP[filter](l)) continue;
      rows.push(
        <li key={`${g.index}-${n}`} className="grid grid-cols-[40px_minmax(0,1fr)_96px] pr-3.5">
          <span className="pr-3 text-right text-faint">{n}</span>
          <span className={`truncate ${KIND_TONE[l.kind] ?? 'text-ink'}`} style={{ paddingLeft: l.depth * 18 }} title={l.text}>
            {l.text}
            {l.kind === 'invoke' && l.program && <span className="font-sans text-muted"> · {l.program}</span>}
          </span>
          <span className="text-right text-muted">{l.computeUnits ? `${l.computeUnits} CU` : ''}</span>
        </li>,
      );
    }
  }

  const chip = (f: Filter, label: string) => (
    <button
      type="button"
      aria-pressed={filter === f}
      onClick={() => setFilter(f)}
      className={`h-[30px] rounded-lg px-2.5 text-xs ${filter === f ? 'bg-ink font-semibold text-white' : 'border border-line bg-surface text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <section id="exp-logs" aria-label={onChain ? 'Transaction logs' : 'Simulation logs'} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 className="m-0 text-lg font-semibold">{onChain ? 'Transaction logs' : 'Simulation logs'}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.text}</span>
        <div role="group" aria-label="Log filter" className="ml-auto flex gap-1">
          {chip('all', 'All')}
          {chip('program', 'Program logs')}
          {chip('compute', 'Compute')}
          <button type="button" onClick={copy} className="h-[30px] rounded-lg border border-line bg-surface px-2.5 text-xs text-ink">
            Copy
          </button>
        </div>
      </div>
      <span className="font-mono text-xs text-muted">{meta}</span>
      <ol className="m-0 list-none overflow-hidden rounded-xl border border-line bg-surface p-0 py-1.5 font-mono text-xs leading-[22px]">{rows}</ol>
    </section>
  );
}
