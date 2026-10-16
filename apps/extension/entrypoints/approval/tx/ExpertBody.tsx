import type { BatchView, ExplainedBatch, ExpertView, RelationEdge, Warning } from '@clef/explain';
import { useMemo, useState, type MouseEvent } from 'react';
import { Icon, Tooltip, type IconName } from '../../../components';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { edgeKey, expertSteps, networkName, UNEXPLAINED_RULE, type Tab } from './model';
import { DangerCards, Deltas, TxTabs, WarnCards } from './parts';
import { ExpertInstructions } from './ExpertInstructions';
import { RelationsGraph, type GraphInput } from './RelationsGraph';
import { SimulationLogs } from './SimulationLogs';
import { StateChanges } from './StateChanges';

type Section = 'changes' | 'rel' | 'instr' | 'logs' | 'details';
const RAIL: { id: Section; icon: IconName; tip: string }[] = [
  { id: 'changes', icon: 'changes', tip: 'State changes' },
  { id: 'rel', icon: 'relations', tip: 'Account relationships' },
  { id: 'instr', icon: 'instructions', tip: 'Instructions' },
  { id: 'logs', icon: 'logs', tip: 'Simulation logs' },
  { id: 'details', icon: 'details', tip: 'Transaction details' },
];

function graphInput(view: BatchView<'expert'>, state: FullState): GraphInput {
  const edges = new Map<string, RelationEdge & { steps: number[] }>();
  const external = new Map<string, RelationEdge & { steps: number[] }>();
  const inRequest = new Map<string, Set<number>>();
  const programs = new Set<string>();
  const labels = new Map<string, string>();
  const mine = new Set(state.accounts.map((a) => a.address as string));
  for (const a of state.accounts) labels.set(a.address, `You · ${a.label}`);
  const use = (a: string, step: number) => {
    const s = inRequest.get(a) ?? new Set<number>();
    s.add(step);
    inRequest.set(a, s);
  };
  const tag = (into: Map<string, RelationEdge & { steps: number[] }>, e: RelationEdge, step: number) => {
    const k = edgeKey(e);
    const found = into.get(k);
    if (found) found.steps.push(step);
    else into.set(k, { ...e, steps: [step] });
  };
  for (const s of view.steps) {
    const v = s.view as ExpertView | null;
    if (!v) continue;
    for (const ix of v.instructions) {
      programs.add(ix.programId);
      use(ix.programId, s.index);
      if (!labels.has(ix.programId)) labels.set(ix.programId, ix.program);
      for (const a of ix.accounts) {
        use(a.address, s.index);
        if (a.label && !labels.has(a.address)) labels.set(a.address, a.label);
      }
    }
    for (const d of v.accountDiffs ?? []) if (!labels.has(d.address)) labels.set(d.address, d.title);
    for (const e of v.relations) if (!e.external) tag(edges, e, s.index);
    for (const e of v.externalRelations) tag(external, e, s.index);
  }
  return { edges: [...edges.values()], external: [...external.values()], inRequest, mine, programs, labels };
}

function uniqueAccounts(v: ExpertView): number {
  return new Set(v.instructions.flatMap((ix) => [ix.programId, ...ix.accounts.map((a) => a.address)])).size;
}

function detailRows(view: BatchView<'expert'>, tab: Tab, state: FullState): { k: string; v: string }[] {
  const mine = (a: string) => state.accounts.some((x) => x.address === a);
  const payer = (a: string) => `${shortAddress(a)}${mine(a) ? ' (you)' : ''}`;
  const n = view.steps.length;
  const steps = view.steps.map((s) => s.view as ExpertView | null);
  if (tab === 'all' && n > 1) {
    const first = steps.find((s) => s);
    const hashes = new Set(steps.filter((s): s is ExpertView => !!s).map((s) => s.recentBlockhash));
    const c = view.combined;
    return [
      { k: 'Transactions', v: `${n} · signed together, sent in order` },
      ...(first ? [{ k: 'Fee payer', v: payer(first.feePayer) }] : []),
      { k: 'Total fees', v: c.fee ?? 'unknown' },
      { k: 'Total compute', v: c.computeUnits ? `${c.computeUnits} CU` : 'unknown' },
      {
        k: 'Simulation',
        v: view.mode === 'sequential' ? 'sequential, one fork, from the current state' : `each alone${view.dependentSteps.length ? ` · ${view.dependentSteps.length} depend on earlier ones` : ''}`,
      },
      { k: 'Assumes', v: 'nothing else touches these accounts in between' },
      ...(first ? [{ k: 'Blockhash', v: `${shortAddress(first.recentBlockhash)}${hashes.size === 1 ? ' · shared' : ` · ${hashes.size} different`}` }] : []),
    ];
  }
  const v = steps[tab === 'all' ? 0 : tab];
  if (!v) return [{ k: 'Status', v: 'Clef could not explain this transaction' }];
  const version = v.version === 'legacy' ? 'legacy' : `v${v.version}`;
  const lookups = new Set(v.instructions.flatMap((ix) => ix.accounts.flatMap((a) => (a.lookupTable ? [a.lookupTable] : []))));
  const fromAlt = new Set(v.instructions.flatMap((ix) => ix.accounts.flatMap((a) => (a.lookupTable ? [a.address] : [])))).size;
  const compute = v.computeUnits ?? '?';
  const idls = [...new Map(v.instructions.filter((ix) => ix.idl).map((ix) => [ix.programId, `${ix.program} ${ix.idl!.trust}`])).values()];
  return [
    { k: 'Version', v: lookups.size ? `${version} · ${lookups.size} lookup table${lookups.size === 1 ? '' : 's'}` : version },
    { k: 'Fee payer', v: payer(v.feePayer) },
    { k: 'Compute', v: v.computeUnitLimit !== undefined ? `${compute} / ${v.computeUnitLimit.toLocaleString('en-US')} CU` : `${compute} CU` },
    { k: 'Fees', v: v.fee ?? 'unknown' },
    ...(v.computeUnitPrice ? [{ k: 'Priority', v: `${Number(v.computeUnitPrice).toLocaleString('en-US')} µ◎/CU` }] : []),
    ...(v.priorityFeeLamports ? [{ k: 'Priority fee', v: `${v.priorityFeeLamports} lamports` }] : []),
    { k: 'Accounts', v: fromAlt ? `${uniqueAccounts(v)} · ${fromAlt} from lookup tables` : String(uniqueAccounts(v)) },
    ...(idls.length ? [{ k: 'IDLs', v: idls.join(' · ') }] : []),
    { k: 'Blockhash', v: shortAddress(v.recentBlockhash) },
  ];
}

export function ExpertBody(p: {
  view: BatchView<'expert'>;
  batch: ExplainedBatch;
  tab: Tab;
  onTab: (t: Tab) => void;
  state: FullState;
  chain: string;
  warnings: Warning[];
  onResimulate: () => void;
}) {
  const { view, tab, state } = p;
  const [active, setActive] = useState<Section>('changes');
  const n = view.steps.length;
  const isAll = tab === 'all' || n === 1;
  const steps = expertSteps(view, n === 1 ? 'all' : tab);
  const sv = !isAll ? (steps[0]?.view ?? null) : n === 1 ? (steps[0]?.view ?? null) : null;
  const graph = useMemo(() => graphInput(view, state), [view, state]);

  const diffs = isAll && n > 1 ? view.combined.accountDiffs : sv ? sv.accountDiffs : null;
  const changeCount = diffs?.length ?? 0;
  const ownerOf = (address: string) => {
    for (const s of p.batch.steps) {
      const d = s.explained?.accountDiffs?.find((x) => x.address === address);
      if (d) return d.owner.after ?? d.owner.before;
    }
    return null;
  };

  const shownWarnings = sv ? [...p.warnings.filter((w) => w.rule === UNEXPLAINED_RULE), ...sv.warnings] : p.warnings;
  const dangers = shownWarnings.filter((w) => w.severity === 'danger');
  const others = shownWarnings.filter((w) => w.severity !== 'danger');
  const title = sv?.summary ?? view.combined.summary;
  const changes = sv ? sv.balanceChanges : view.combined.balanceChanges;
  const fee = sv ? sv.fee : view.combined.fee;
  const net = networkName(p.chain);
  const logMeta =
    isAll && n > 1
      ? `${net} · ${n} transactions ${view.mode === 'sequential' ? 'in sequence' : 'simulated one by one'}${view.combined.computeUnits ? ` · ${view.combined.computeUnits} CU` : ''}`
      : `${net}${sv?.computeUnits ? ` · ${sv.computeUnits} CU` : ''}`;

  const go = (id: Section) => (e: MouseEvent) => {
    e.preventDefault();
    setActive(id);
    document.getElementById(`exp-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-line-soft bg-surface px-5 pt-1 pb-3.5">
        {n > 1 && (
          <div className="flex items-center gap-1.5">
            <TxTabs titles={view.steps.map((s) => s.title)} value={tab} onChange={p.onTab} />
            <span className="ml-auto text-xs text-muted">Signed together · sent in order</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3.5 tabular-nums">
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
            <span className={`ml-auto text-xs ${dangers.length ? 'text-danger-text' : others.length ? 'text-warn' : 'text-ok'}`}>
              {shownWarnings.length ? `${shownWarnings.length} warning${shownWarnings.length === 1 ? '' : 's'}` : 'No warnings'}
            </span>
          </div>
          <Deltas changes={changes} fee={fee} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Transaction sections" className="relative z-[2] box-border flex w-14 flex-none flex-col items-center gap-1.5 border-r border-line-soft bg-surface px-2 py-3">
          {RAIL.map((r) => {
            const tip = r.id === 'changes' ? `State changes · ${changeCount}` : r.tip;
            const on = active === r.id;
            return (
              <Tooltip key={r.id} tip={tip}>
                <a
                  href={`#exp-${r.id}`}
                  aria-label={tip}
                  aria-current={on ? 'location' : undefined}
                  onClick={go(r.id)}
                  className={`relative flex size-10 items-center justify-center rounded-[10px] no-underline ${on ? 'bg-primary-bg text-primary' : 'bg-transparent text-muted'}`}
                >
                  <Icon name={r.icon} size={20} />
                  {r.id === 'changes' && (
                    <span aria-hidden="true" className="absolute -top-1 -right-1.5 box-border h-4 min-w-4 rounded-lg bg-warn px-1 text-center text-xs leading-4 text-white">
                      {changeCount}
                    </span>
                  )}
                </a>
              </Tooltip>
            );
          })}
        </nav>

        <main className="box-border flex min-w-0 flex-1 flex-col gap-8 overflow-y-auto px-5 pt-4 pb-6">
          {(dangers.length > 0 || others.length > 0) && (
            <div className="flex flex-col gap-3">
              <DangerCards warnings={dangers} />
              <WarnCards warnings={others} />
            </div>
          )}
          <StateChanges diffs={diffs} isAll={isAll} batchSize={n} ownerOf={ownerOf} network={state.settings.network} onResimulate={p.onResimulate} />
          <RelationsGraph input={graph} tab={isAll ? 'all' : (tab as number)} batchSize={n} />
          <ExpertInstructions steps={steps} />
          <SimulationLogs
            groups={steps.map((s) => ({ index: s.index, title: s.title, computeUnits: s.view.computeUnits, failed: view.steps[s.index]?.status === 'failed', logs: s.view.logs }))}
            separators={isAll && n > 1}
            meta={logMeta}
          />
          <section id="exp-details" aria-label="Transaction details" className="flex scroll-mt-4 flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">{isAll && n > 1 ? 'Request details' : n > 1 ? `Transaction ${(tab as number) + 1} details` : 'Transaction details'}</h2>
            <dl className="m-0 grid grid-cols-[150px_minmax(0,1fr)] rounded-xl border border-line bg-surface px-3.5 py-1.5 font-mono text-xs">
              {detailRows(view, isAll ? 'all' : tab, state).map((r, i) => (
                <div key={r.k} className="contents">
                  <dt className={`py-[9px] font-sans text-muted ${i ? 'border-t border-line-soft' : ''}`}>{r.k}</dt>
                  <dd className={`m-0 py-[9px] break-all ${i ? 'border-t border-line-soft' : ''}`}>{r.v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}
