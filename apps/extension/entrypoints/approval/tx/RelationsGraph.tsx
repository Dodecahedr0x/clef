import type { RelationEdge } from '@clef/explain';
import { useMemo, useState } from 'react';
import { shortAddress } from '../../../lib/format';
import { edgeKey } from './model';

export const GRAPH = { width: 672, nodeW: 136, nodeH: 52, colX: [8, 184, 360, 536], top: 40, rowH: 110 } as const;

export type GraphInput = {
  /** Edges between accounts of the request, tagged with the 0-based steps that contain them. */
  edges: (RelationEdge & { steps: number[] })[];
  external: (RelationEdge & { steps: number[] })[];
  /** Addresses -> 0-based steps whose transaction uses them. */
  inRequest: Map<string, Set<number>>;
  mine: Set<string>;
  programs: Set<string>;
  labels: Map<string, string>;
};

export type GraphNode = { address: string; col: 0 | 1 | 2 | 3; x: number; y: number; title: string; sub: string; external: boolean };

const MINT_KINDS = new Set(['token-mint']);

/** Deterministic columns: you / your accounts, accounts, mints and programs, outside the request. */
export function layoutGraph(g: GraphInput, showExternal: boolean): { nodes: GraphNode[]; height: number } {
  const order: string[] = [];
  const add = (a: string) => {
    if (!order.includes(a)) order.push(a);
  };
  for (const e of g.edges) {
    add(e.from);
    add(e.to);
  }
  for (const a of g.mine) if (g.inRequest.has(a)) add(a);
  // Every account of the request is drawn, linked or not: a missing node would hide what the transaction touches.
  for (const a of g.inRequest.keys()) add(a);
  if (showExternal) {
    for (const e of g.external) {
      add(e.from);
      add(e.to);
    }
  }
  const mintTargets = new Set<string>(g.edges.filter((e) => MINT_KINDS.has(e.kind)).map((e) => e.to));
  const pdaPrograms = new Set<string>(g.edges.filter((e) => e.kind === 'pda').map((e) => e.to));
  const colOf = (a: string): GraphNode['col'] => {
    if (g.mine.has(a)) return 0;
    if (!g.inRequest.has(a)) return 3;
    if (g.programs.has(a) || mintTargets.has(a) || pdaPrograms.has(a)) return 2;
    return 1;
  };
  const rows = [0, 0, 0, 0];
  const nodes = order.map((address) => {
    const col = colOf(address);
    const row = rows[col]!++;
    const title = g.labels.get(address) ?? shortAddress(address);
    const sub = g.programs.has(address) ? 'program' : pdaChild(g, address) ? `PDA · ${shortAddress(address)}` : shortAddress(address);
    return { address, col, x: GRAPH.colX[col], y: GRAPH.top + row * GRAPH.rowH, title, sub, external: col === 3 };
  });
  const height = Math.max(440, GRAPH.top + Math.max(...rows) * GRAPH.rowH);
  return { nodes, height };
}

const pdaChild = (g: GraphInput, a: string) => g.edges.some((e) => e.kind === 'pda' && e.from === a);

function edgePath(a: GraphNode, b: GraphNode): { d: string; lx: number; ly: number } {
  const { nodeW, nodeH } = GRAPH;
  const ay = a.y + nodeH / 2;
  const by = b.y + nodeH / 2;
  if (a.col === b.col) {
    const x = a.x + nodeW;
    return { d: `M${x} ${ay} C${x + 30} ${ay} ${x + 30} ${by} ${x} ${by}`, lx: x + 14, ly: (ay + by) / 2 };
  }
  const [l, r, ly0, ry] = a.col < b.col ? [a, b, ay, by] : [b, a, by, ay];
  const x1 = l.x + nodeW;
  const x2 = r.x;
  const mx = (x1 + x2) / 2;
  if (ly0 === ry) return { d: `M${x1} ${ly0} H${x2}`, lx: x1 + 6, ly: ly0 - 8 };
  return { d: `M${x1} ${ly0} C${mx} ${ly0} ${mx} ${ry} ${x2} ${ry}`, lx: mx - 16, ly: (ly0 + ry) / 2 };
}

const STATUS_OK: Record<RelationEdge['status'], string> = { verified: '✓', mismatch: '✗ mismatch', unverified: '? unverified' };

export function RelationsGraph({ input, tab, batchSize }: { input: GraphInput; tab: 'all' | number; batchSize: number }) {
  const [showExternal, setShowExternal] = useState(false);
  const { nodes, height } = useMemo(() => layoutGraph(input, showExternal), [input, showExternal]);
  const [picked, setPicked] = useState<string | null>(null);
  const byAddress = new Map(nodes.map((n) => [n.address, n]));
  const selected = (picked && byAddress.get(picked)) || nodes.find((n) => n.col === 1) || nodes[0];
  const label = (a: string) => input.labels.get(a) ?? shortAddress(a);
  const dim = (n: GraphNode) => tab !== 'all' && !n.external && !input.inRequest.get(n.address)?.has(tab);

  const drawn = [...input.edges, ...(showExternal ? input.external : [])].filter((e) => byAddress.has(e.from) && byAddress.has(e.to));
  const rows = (edges: RelationEdge[]) =>
    selected
      ? edges
          .filter((e) => e.from === selected.address || e.to === selected.address)
          .map((e) => (e.from === selected.address ? { k: e.label, v: label(e.to), ok: STATUS_OK[e.status] } : { k: `${e.label} of`, v: label(e.from), ok: STATUS_OK[e.status] }))
      : [];
  const inRows = rows(input.edges);
  const outRows = rows(input.external);
  const note = tab === 'all' ? (batchSize > 1 ? `Accounts used by any of the ${batchSize} transactions.` : 'Accounts used by this transaction and how Clef verified their links.') : `Faded accounts are in the request but not in transaction ${tab + 1}.`;

  return (
    <section id="exp-rel" aria-label="Account relationships" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 className="m-0 flex-1 text-lg font-semibold">Account relationships</h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" role="switch" checked={showExternal} aria-checked={showExternal} onChange={() => setShowExternal(!showExternal)} className="m-0 size-[18px] accent-primary" />
          Show accounts outside the request
        </label>
      </div>
      <span className="text-xs text-muted">{note}</span>
      {nodes.length === 0 ? (
        <p className="m-0 rounded-xl border border-line bg-surface px-3.5 py-3 text-xs text-muted">No relationships between accounts in this request.</p>
      ) : (
        <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-surface" style={{ height }}>
          {/* Sized to the layout so a narrow view (popup, side panel) scrolls sideways instead of clipping. */}
          <div className="relative" style={{ width: GRAPH.width, height }}>
          <svg aria-hidden="true" width={GRAPH.width} height={height} viewBox={`0 0 ${GRAPH.width} ${height}`} className="absolute inset-0">
            {drawn.map((e) => {
              const p = edgePath(byAddress.get(e.from)!, byAddress.get(e.to)!);
              const stroke = e.status === 'mismatch' ? '#C8402A' : e.external ? '#CBD0DA' : e.kind === 'pda' ? '#0F7A62' : '#9AA1AE';
              const dash = e.external ? '3 4' : e.kind === 'pda' ? '5 4' : undefined;
              return (
                <g key={edgeKey(e)}>
                  <path d={p.d} stroke={stroke} strokeWidth={1.5} fill="none" strokeDasharray={dash} />
                  <text x={p.lx} y={p.ly} fontSize={12} fill={e.kind === 'pda' && !e.external ? '#0F7A62' : '#5C6475'}>
                    {e.kind === 'pda' ? 'seeds' : e.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {nodes.map((n) => {
            const on = n.address === selected?.address;
            const mine = n.col === 0;
            const program = input.programs.has(n.address);
            return (
              <button
                key={n.address}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(n.address)}
                style={{ left: n.x, top: n.y, width: GRAPH.nodeW, height: GRAPH.nodeH, opacity: dim(n) ? 0.35 : 1 }}
                className={`absolute box-border flex flex-col items-start justify-center rounded-[10px] px-2.5 py-1.5 text-left text-ink ${
                  on
                    ? 'border-2 border-primary'
                    : n.external
                      ? 'border border-dashed border-line-strong'
                      : mine
                        ? 'border border-info-dot'
                        : program
                          ? 'border border-primary-line'
                          : 'border border-line'
                } ${n.external ? 'bg-surface-4' : mine ? 'bg-info-tint' : program ? 'bg-primary-bg' : 'bg-surface'}`}
              >
                <span className="w-full truncate text-xs font-semibold">{n.title}</span>
                <span className="w-full truncate font-mono text-xs text-muted">{n.sub}</span>
              </button>
            );
          })}
          <div className="absolute top-3 left-3.5 flex gap-3.5 text-xs text-muted">
            <span>— in the request</span>
            <span className="text-ok">- - PDA seeds</span>
            <span>··· outside the request</span>
          </div>
          </div>
        </div>
      )}
      {selected && (
        <section role="group" aria-label="Selected account" className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface px-3.5 py-3">
          <RelationRows title={`${selected.title} · in the request`} rows={inRows} />
          <RelationRows title="Outside the request" rows={outRows} />
        </section>
      )}
    </section>
  );
}

function RelationRows({ title, rows }: { title: string; rows: { k: string; v: string; ok: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{title}</span>
      {rows.length === 0 && <span className="text-xs text-muted">none</span>}
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 text-xs">
          <span className="w-[92px] flex-none truncate font-mono text-muted">{r.k}</span>
          <span className="min-w-0 flex-1 truncate">{r.v}</span>
          <span className={r.ok.startsWith('✓') ? 'text-ok' : r.ok.startsWith('✗') ? 'text-danger-text' : 'text-warn'}>{r.ok}</span>
        </div>
      ))}
    </div>
  );
}
