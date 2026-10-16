import type { RelationEdge } from '@clef/explain';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { shortAddress } from '../../../lib/format';
import { edgeKey } from './model';
import { Pubkey } from '../../../components';

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

type Pos = { x: number; y: number };

/** Routed by where the nodes are (they can be dragged), not by their layout column. */
export function edgePath(a: Pos, b: Pos): { d: string; lx: number; ly: number } {
  const { nodeW, nodeH } = GRAPH;
  const ay = a.y + nodeH / 2;
  const by = b.y + nodeH / 2;
  if (Math.abs(a.x - b.x) < nodeW) {
    const x = Math.max(a.x, b.x) + nodeW;
    return { d: `M${a.x + nodeW} ${ay} C${x + 30} ${ay} ${x + 30} ${by} ${b.x + nodeW} ${by}`, lx: x + 14, ly: (ay + by) / 2 };
  }
  const [l, r, ly0, ry] = a.x < b.x ? [a, b, ay, by] : [b, a, by, ay];
  const x1 = l.x + nodeW;
  const x2 = r.x;
  const mx = (x1 + x2) / 2;
  if (ly0 === ry) return { d: `M${x1} ${ly0} H${x2}`, lx: mx - 16, ly: ly0 - 8 };
  return { d: `M${x1} ${ly0} C${mx} ${ly0} ${mx} ${ry} ${x2} ${ry}`, lx: mx - 16, ly: (ly0 + ry) / 2 };
}

/** Moves each label off the ones already placed (alternating down/up a line at a time) so none overlap. */
export function placeLabels(labels: { x: number; y: number; text: string }[]): { x: number; y: number }[] {
  const LINE = 14;
  const boxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
  return labels.map(({ x, y, text }) => {
    const w = text.length * 6.5 + 6;
    const box = (dy: number) => ({ x1: x - 3, x2: x - 3 + w, y1: y + dy - 11, y2: y + dy + 3 });
    let dy = 0;
    for (let i = 1; i < 12 && boxes.some((b) => { const c = box(dy); return c.x1 < b.x2 && b.x1 < c.x2 && c.y1 < b.y2 && b.y1 < c.y2; }); i++) {
      dy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * LINE;
    }
    boxes.push(box(dy));
    return { x, y: y + dy };
  });
}

const ZOOM = { min: 0.3, max: 2, step: 0.2 } as const;
const clampZoom = (z: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 100) / 100));

const STATUS_OK: Record<RelationEdge['status'], string> = { verified: '✓', mismatch: '✗ mismatch', unverified: '? unverified' };

export function RelationsGraph({ input, tab, batchSize }: { input: GraphInput; tab: 'all' | number; batchSize: number }) {
  const [showExternal, setShowExternal] = useState(false);
  const { nodes, height } = useMemo(() => layoutGraph(input, showExternal), [input, showExternal]);
  const [picked, setPicked] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ address: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const placedNodes = nodes.map((n) => (moved[n.address] ? { ...n, ...moved[n.address] } : n));
  const byAddress = new Map(placedNodes.map((n) => [n.address, n]));
  const contentW = Math.max(GRAPH.width, ...placedNodes.map((n) => n.x + GRAPH.nodeW + 16));
  const contentH = Math.max(height, ...placedNodes.map((n) => n.y + GRAPH.nodeH + 16));
  const selected = (picked && byAddress.get(picked)) || nodes.find((n) => n.col === 1) || nodes[0];
  const label = (a: string) => input.labels.get(a) ?? shortAddress(a);
  const dim = (n: GraphNode) => tab !== 'all' && !n.external && !input.inRequest.get(n.address)?.has(tab);

  const drawn = [...input.edges, ...(showExternal ? input.external : [])].filter((e) => byAddress.has(e.from) && byAddress.has(e.to));
  const paths = drawn.map((e) => edgePath(byAddress.get(e.from)!, byAddress.get(e.to)!));
  const labelText = (e: RelationEdge) => (e.kind === 'pda' ? 'seeds' : e.label);
  const labelAt = placeLabels(drawn.map((e, i) => ({ x: paths[i]!.lx, y: paths[i]!.ly, text: labelText(e) })));

  const fit = () => {
    const w = viewport.current?.clientWidth ?? contentW;
    setZoom(clampZoom(Math.min(1, (w - 2) / contentW)));
  };
  // Native and non-passive: React's wheel listener is passive, so it could not stop the page zoom/scroll.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [nodes.length === 0]);
  const onPointerDown = (n: GraphNode) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { address: n.address, px: e.clientX, py: e.clientY, ox: n.x, oy: n.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / zoom;
    const dy = (e.clientY - d.py) / zoom;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    setMoved((m) => ({ ...m, [d.address]: { x: Math.max(0, d.ox + dx), y: Math.max(28, d.oy + dy) } }));
  };
  const onPointerUp = () => {
    justDragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };
  const rows = (edges: RelationEdge[]) =>
    selected
      ? edges
          .filter((e) => e.from === selected.address || e.to === selected.address)
          .map((e) => (e.from === selected.address ? { k: e.label, v: label(e.to), address: e.to, ok: STATUS_OK[e.status] } : { k: `${e.label} of`, v: label(e.from), address: e.from, ok: STATUS_OK[e.status] }))
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
        <div className="relative">
          <div role="group" aria-label="Graph view" className="absolute top-2 right-2 z-[3] flex gap-1 rounded-lg border border-line bg-surface p-0.5 shadow-sm">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - ZOOM.step))} className="h-7 w-7 rounded-md border-0 bg-transparent text-sm text-ink hover:bg-surface-2">−</button>
            <span className="flex w-11 items-center justify-center text-xs tabular-nums text-muted" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + ZOOM.step))} className="h-7 w-7 rounded-md border-0 bg-transparent text-sm text-ink hover:bg-surface-2">+</button>
            <button type="button" onClick={fit} className="h-7 rounded-md border-0 bg-transparent px-2 text-xs text-ink hover:bg-surface-2">Fit</button>
            {Object.keys(moved).length > 0 && (
              <button type="button" onClick={() => setMoved({})} className="h-7 rounded-md border-0 bg-transparent px-2 text-xs text-ink hover:bg-surface-2">Reset layout</button>
            )}
          </div>
          {/* Scrolls both ways; Ctrl/⌘ + wheel zooms. Nodes can be dragged to untangle edges. */}
          <div ref={viewport} className="overflow-auto rounded-xl border border-line bg-surface" style={{ height: Math.min(contentH * zoom, 620) + 2 }}>
            <div className="relative" style={{ width: contentW * zoom, height: contentH * zoom }}>
              <div className="absolute top-0 left-0 origin-top-left" style={{ width: contentW, height: contentH, transform: `scale(${zoom})` }}>
                <svg aria-hidden="true" width={contentW} height={contentH} viewBox={`0 0 ${contentW} ${contentH}`} className="absolute inset-0">
                  {drawn.map((e, i) => {
                    const p = paths[i]!;
                    const stroke = e.status === 'mismatch' ? '#C8402A' : e.external ? '#CBD0DA' : e.kind === 'pda' ? '#0F7A62' : '#9AA1AE';
                    const dash = e.external ? '3 4' : e.kind === 'pda' ? '5 4' : undefined;
                    return <path key={edgeKey(e)} d={p.d} stroke={stroke} strokeWidth={1.5} fill="none" strokeDasharray={dash} />;
                  })}
                  {/* Labels after every edge, with a halo, so no line runs through a label. */}
                  {drawn.map((e, i) => (
                    <text
                      key={`l-${edgeKey(e)}`}
                      x={labelAt[i]!.x}
                      y={labelAt[i]!.y}
                      fontSize={12}
                      fill={e.kind === 'pda' && !e.external ? '#0F7A62' : '#5C6475'}
                      stroke="#FFFFFF"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {labelText(e)}
                    </text>
                  ))}
                </svg>
                {placedNodes.map((n) => {
                  const on = n.address === selected?.address;
                  const mine = n.col === 0;
                  const program = input.programs.has(n.address);
                  return (
                    <button
                      key={n.address}
                      type="button"
                      aria-pressed={on}
                      onPointerDown={onPointerDown(n)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onClick={() => {
                        if (justDragged.current) {
                          justDragged.current = false;
                          return;
                        }
                        setPicked(n.address);
                      }}
                      style={{ left: n.x, top: n.y, width: GRAPH.nodeW, height: GRAPH.nodeH, opacity: dim(n) ? 0.35 : 1, touchAction: 'none', zIndex: moved[n.address] ? 2 : 1 }}
                      className={`absolute box-border flex cursor-grab flex-col items-start justify-center rounded-[10px] px-2.5 py-1.5 text-left text-ink active:cursor-grabbing ${
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
                      <span className="w-full truncate text-xs text-muted"><Pubkey value={n.address} prefix={input.programs.has(n.address) ? 'program · ' : pdaChild(input, n.address) ? 'PDA · ' : undefined} /></span>
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

function RelationRows({ title, rows }: { title: string; rows: { k: string; v: string; address: string; ok: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{title}</span>
      {rows.length === 0 && <span className="text-xs text-muted">none</span>}
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 text-xs">
          <span className="w-[92px] flex-none truncate font-mono text-muted">{r.k}</span>
          <span className="min-w-0 flex-1 truncate">{r.v === shortAddress(r.address) ? <Pubkey value={r.address} /> : <>{r.v} <Pubkey value={r.address} className="text-muted" /></>}</span>
          <span className={r.ok.startsWith('✓') ? 'text-ok' : r.ok.startsWith('✗') ? 'text-danger-text' : 'text-warn'}>{r.ok}</span>
        </div>
      ))}
    </div>
  );
}
