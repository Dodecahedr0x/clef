import type { AccountFactView, RelationEdge, TransferView } from '@clef/explain';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { shortAddress } from '../../../lib/format';
import { layered, type Pos } from './graph-layout';
import { SeedPanel } from './SeedPanel';
import { Pubkey } from '../../../components';

export const GRAPH = { width: 672, minHeight: 240, nodeW: 136, nodeH: 64, gapX: 150, gapY: 22, top: 44, left: 8 } as const;

export type GraphInput = {
  /** Edges between accounts of the request, tagged with the 0-based steps that contain them. */
  edges: (RelationEdge & { steps: number[] })[];
  external: (RelationEdge & { steps: number[] })[];
  /** Addresses -> 0-based steps whose transaction uses them. */
  inRequest: Map<string, Set<number>>;
  mine: Set<string>;
  programs: Set<string>;
  labels: Map<string, string>;
  /** The account's name in the instruction's IDL (e.g. 'globalConfig'), for accounts with no trusted label. */
  idlNames?: Map<string, string>;
  /** Per account, what each step that uses it says of it. */
  facts?: Map<string, (AccountFactView & { step: number })[]>;
  /** Null when no step's transfers are known. */
  transfers?: (TransferView & { step: number })[] | null;
  /** Some step's transfers miss what the programs it called moved. */
  transfersPartial?: boolean;
};

/** The account as the selected tab sees it: one step's fact, or (all steps) before from the first and after from the last. */
export function factFor(g: GraphInput, address: string, tab: 'all' | number): (AccountFactView & { step: number }) | null {
  const list = g.facts?.get(address) ?? [];
  if (tab !== 'all') return list.find((f) => f.step === tab) ?? null;
  if (list.length <= 1) return list[0] ?? null;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const lifecycle = first.lifecycle === 'missing' && last.lifecycle !== 'missing' ? 'created' : last.lifecycle === 'closed' ? 'closed' : first.lifecycle;
  // Deltas don't add up as strings: across steps only before and after are shown.
  return {
    ...last,
    lifecycle,
    lamports: { before: first.lamports.before, after: last.lamports.after, delta: null },
    ...(last.token && { token: { ...last.token, before: first.token?.mint === last.token.mint ? first.token.before : null, delta: null } }),
  };
}

/** Owner line of a node: Clef's name for the program, else its short address. */
export const ownerText = (f: AccountFactView | null) => (f?.owner ? (f.ownerName ?? shortAddress(f.owner)) : null);

export type GraphNode = { address: string; x: number; y: number; title: string; external: boolean; isolated: boolean };

/** One drawn line: every relation (or every transfer) between the same two accounts, in the same direction. */
export type GraphEdge = {
  id: string;
  kind: 'relation' | 'transfer';
  from: string;
  to: string;
  /** Labels of the bundled facts, joined. */
  label: string;
  relations: RelationEdge[];
  transfers: TransferView[];
};

export type GraphLayout = { nodes: GraphNode[]; edges: GraphEdge[]; routes: Map<string, Pos[]>; width: number; height: number; isolatedTop: number | null };

/** has_one edges link the holder and the account its field names: the field ("admin") says it all. */
const relationLabel = (e: RelationEdge) => (e.kind === 'pda' ? 'seeds' : e.kind === 'has_one' ? (e.label.split('.').pop() ?? e.label) : e.label);
const transferLabel = (t: TransferView) => (t.kind === 'create' ? `funds ${t.amount}` : t.kind === 'mint' ? `mints ${t.amount}` : t.kind === 'burn' ? `burns ${t.amount}` : t.amount);
const unique = (xs: string[]) => [...new Set(xs)];

/** The edges to draw: relations (and outside ones when shown), and the selected step's transfers when shown. */
export function graphEdges(g: GraphInput, opts: { showExternal: boolean; showTransfers: boolean; tab: 'all' | number }): GraphEdge[] {
  const groups = new Map<string, GraphEdge>();
  const add = (kind: GraphEdge['kind'], from: string, to: string, r?: RelationEdge, t?: TransferView) => {
    if (from === to) return;
    // Relations have no direction on screen: one line per pair (a has_one and the stored field it checks merge).
    if (kind === 'relation' && to < from) [from, to] = [to, from];
    const id = `${kind}|${from}|${to}`;
    const e = groups.get(id) ?? { id, kind, from, to, label: '', relations: [], transfers: [] };
    if (r) e.relations.push(r);
    if (t) e.transfers.push(t);
    groups.set(id, e);
  };
  for (const e of [...g.edges, ...(opts.showExternal ? g.external : [])]) add('relation', e.from, e.to, e);
  if (opts.showTransfers) {
    for (const t of g.transfers ?? []) if (opts.tab === 'all' || t.step === opts.tab) add('transfer', t.from, t.to, undefined, t);
  }
  return [...groups.values()].map((e) => ({
    ...e,
    label: unique(e.kind === 'relation' ? e.relations.map(relationLabel) : e.transfers.map(transferLabel)).join(' · '),
  }));
}

/** Accounts as nodes of a layered layout: yours first, accounts with no drawn link in a strip below. */
export function layoutGraph(g: GraphInput, opts: { showExternal: boolean; showTransfers: boolean; tab: 'all' | number }): GraphLayout {
  const order: string[] = [];
  const add = (a: string) => {
    if (!order.includes(a)) order.push(a);
  };
  for (const a of g.mine) if (g.inRequest.has(a)) add(a);
  for (const e of g.edges) (add(e.from), add(e.to));
  // Every account of the request is drawn, linked or not: a missing node would hide what the transaction touches.
  for (const a of g.inRequest.keys()) add(a);
  if (opts.showExternal) for (const e of g.external) (add(e.from), add(e.to));
  const edges = graphEdges(g, opts);
  const l = layered(order, edges, { nodeW: GRAPH.nodeW, nodeH: GRAPH.nodeH, gapX: GRAPH.gapX, gapY: GRAPH.gapY, margin: { top: GRAPH.top, left: GRAPH.left } });
  const isolated = new Set(l.isolated);
  const nodes = order.map((address) => {
    const { x, y } = l.pos.get(address)!;
    return { address, x, y, title: g.labels.get(address) ?? g.idlNames?.get(address) ?? shortAddress(address), external: !g.inRequest.has(address), isolated: isolated.has(address) };
  });
  return { nodes, edges, routes: l.routes, width: Math.max(GRAPH.width, l.width), height: Math.max(GRAPH.minHeight, l.height), isolatedTop: l.isolatedTop };
}

const pdaChild = (g: GraphInput, a: string) => g.edges.some((e) => e.kind === 'pda' && e.from === a);

type Side = 'left' | 'right';
export type EdgeGeometry = { d: string; label: Pos };

/**
 * Each edge leaves and enters a node on the side facing the other end. Ends sharing a node side are spread over
 * its height in the order of where they go, so lines fan out instead of meeting at one point.
 */
export function edgeGeometry(edges: readonly GraphEdge[], at: Map<string, Pos>, routes: Map<string, Pos[]>): EdgeGeometry[] {
  const { nodeW, nodeH } = GRAPH;
  const centre = (p: Pos) => ({ x: p.x + nodeW / 2, y: p.y + nodeH / 2 });
  const plans = edges.map((e) => {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const bends = routes.get(e.id) ?? [];
    const stacked = Math.abs(a.x - b.x) < nodeW && !bends.length;
    const next = bends[0] ?? centre(b);
    const prev = bends[bends.length - 1] ?? centre(a);
    const out: Side = stacked || next.x >= a.x + nodeW / 2 ? 'right' : 'left';
    const into: Side = stacked || prev.x > b.x + nodeW / 2 ? 'right' : 'left';
    return { a, b, bends, stacked, out, into, towardOut: next.y, towardIn: prev.y };
  });
  const ends = new Map<string, { i: number; end: 'out' | 'in'; toward: number }[]>();
  plans.forEach((p, i) => {
    for (const [node, side, end, toward] of [[edges[i]!.from, p.out, 'out', p.towardOut], [edges[i]!.to, p.into, 'in', p.towardIn]] as const) {
      const k = `${node}|${side}`;
      ends.set(k, [...(ends.get(k) ?? []), { i, end, toward }]);
    }
  });
  const portY = new Map<string, number>();
  for (const [k, list] of ends) {
    const node = at.get(k.slice(0, k.lastIndexOf('|')))!;
    list.sort((x, y) => x.toward - y.toward || x.i - y.i);
    list.forEach((e, j) => portY.set(`${e.i}|${e.end}`, node.y + 10 + ((nodeH - 20) * (j + 1)) / (list.length + 1)));
  }
  return plans.map((p, i) => {
    const s = { x: p.out === 'right' ? p.a.x + nodeW : p.a.x, y: portY.get(`${i}|out`)! };
    const t = { x: p.into === 'right' ? p.b.x + nodeW : p.b.x, y: portY.get(`${i}|in`)! };
    if (p.stacked) {
      const x = Math.max(s.x, t.x) + 36;
      return { d: `M${s.x} ${s.y} C${x} ${s.y} ${x} ${t.y} ${t.x} ${t.y}`, label: { x: x - 6, y: (s.y + t.y) / 2 } };
    }
    const pts = [s, ...p.bends, t];
    let d = `M${s.x} ${s.y}`;
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1]!;
      const b = pts[j]!;
      const mx = (a.x + b.x) / 2;
      d += ` C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
    }
    const first = pts[1]!;
    return { d, label: { x: (s.x + first.x) / 2, y: (s.y + first.y) / 2 } };
  });
}

/** Labels fit the gap between columns; the full text is in the edge's tooltip. */
export const LABEL_MAX = Math.floor((GRAPH.gapX - 12) / 6.5);
export const fitLabel = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}\u2026` : text);

/** Moves each label (centred on x) off the ones already placed, a line at a time down then up, so none overlap. */
export function placeLabels(labels: { x: number; y: number; text: string }[]): { x: number; y: number }[] {
  const LINE = 14;
  const boxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
  return labels.map(({ x, y, text }) => {
    const w = text.length * 6.5 + 6;
    const box = (dy: number) => ({ x1: x - w / 2, x2: x + w / 2, y1: y + dy - 11, y2: y + dy + 3 });
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

const TRANSFER_STROKE = '#2F6FDB';

/** Mismatch red over PDA green over grey; outside the request lighter and dashed; by a called program dotted. */
function edgeStyle(e: GraphEdge): { stroke: string; dash?: string; text: string; weight?: number } {
  if (e.kind === 'transfer') return { stroke: TRANSFER_STROKE, text: TRANSFER_STROKE, weight: 600, ...(e.transfers.every((t) => t.inner) && { dash: '1 3' }) };
  if (e.relations.some((r) => r.status === 'mismatch')) return { stroke: '#C8402A', text: '#B03A26' };
  if (e.relations.every((r) => r.external)) return { stroke: '#CBD0DA', dash: '3 4', text: '#5C6475' };
  if (e.relations.every((r) => r.kind === 'pda')) return { stroke: '#0F7A62', dash: '5 4', text: '#0F7A62' };
  return { stroke: '#9AA1AE', text: '#5C6475' };
}

const STATUS_OK: Record<RelationEdge['status'], string> = { verified: '✓', mismatch: '✗ mismatch', unverified: '? unverified' };

export function RelationsGraph({ input, tab, batchSize }: { input: GraphInput; tab: 'all' | number; batchSize: number }) {
  const [showExternal, setShowExternal] = useState(false);
  const [showTransfers, setShowTransfers] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => layoutGraph(input, { showExternal, showTransfers, tab }), [input, showExternal, showTransfers, tab]);
  const { nodes, edges } = layout;
  const [picked, setPicked] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  const [zoom, setZoom] = useState(1);
  const zoomed = useRef(false);
  const drag = useRef<{ address: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const placedNodes = nodes.map((n) => (moved[n.address] ? { ...n, ...moved[n.address] } : n));
  const byAddress = new Map(placedNodes.map((n) => [n.address, n]));
  const contentW = Math.max(layout.width, ...placedNodes.map((n) => n.x + GRAPH.nodeW + 16));
  const contentH = Math.max(layout.height, ...placedNodes.map((n) => n.y + GRAPH.nodeH + 16));
  // Room under the graph, in screen pixels whatever the zoom, so the zoom controls (bottom-left) never cover a node.
  const CONTROLS_ROOM = 52;
  const selected =
    (picked && byAddress.get(picked)) || placedNodes.find((n) => !n.external && !input.mine.has(n.address) && !input.programs.has(n.address)) || placedNodes[0];
  const label = (a: string) => input.labels.get(a) ?? input.idlNames?.get(a) ?? shortAddress(a);
  const dim = (n: GraphNode) => tab !== 'all' && !n.external && !input.inRequest.get(n.address)?.has(tab);

  const transfers = (input.transfers ?? []).filter((t) => (tab === 'all' || t.step === tab) && t.from !== t.to);
  // A dragged node keeps its links but drops the bends laid out for where it was.
  const routes = new Map([...layout.routes].filter(([id]) => {
    const e = edges.find((x) => x.id === id);
    return !e || (!moved[e.from] && !moved[e.to]);
  }));
  const geometry = edgeGeometry(edges, new Map(placedNodes.map((n) => [n.address, n])), routes);
  const labelAt = placeLabels(edges.map((e, i) => ({ ...geometry[i]!.label, text: fitLabel(e.label) })));
  const hovered = hover && !drag.current ? byAddress.get(hover) : undefined;
  const faded = (e: GraphEdge) => !!hovered && e.from !== hovered.address && e.to !== hovered.address;

  const fit = () => {
    const w = viewport.current?.clientWidth ?? contentW;
    setZoom(clampZoom(Math.min(1, (w - 2) / contentW)));
  };
  // Starts fitted to the width, until the user zooms.
  useEffect(() => {
    if (!zoomed.current) fit();
  }, [layout.width]);
  const zoomBy = (f: (z: number) => number) => {
    zoomed.current = true;
    setZoom((z) => clampZoom(f(z)));
  };
  // Native and non-passive: React's wheel listener is passive, so it could not stop the page zoom/scroll.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy((z) => z * (e.deltaY > 0 ? 0.9 : 1.1));
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
          <div role="group" aria-label="Graph view" className="absolute bottom-3 left-2 z-[3] flex gap-1 rounded-lg border border-line bg-surface p-0.5 shadow-sm">
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy((z) => z - ZOOM.step)} className="h-7 w-7 rounded-md border-0 bg-transparent text-sm text-ink hover:bg-surface-2">−</button>
            <span className="flex w-11 items-center justify-center text-xs tabular-nums text-muted" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy((z) => z + ZOOM.step)} className="h-7 w-7 rounded-md border-0 bg-transparent text-sm text-ink hover:bg-surface-2">+</button>
            <button type="button" onClick={() => ((zoomed.current = true), fit())} className="h-7 rounded-md border-0 bg-transparent px-2 text-xs text-ink hover:bg-surface-2">Fit</button>
            {Object.keys(moved).length > 0 && (
              <button type="button" onClick={() => setMoved({})} className="h-7 rounded-md border-0 bg-transparent px-2 text-xs text-ink hover:bg-surface-2">Reset layout</button>
            )}
          </div>
          {/* Scrolls both ways; Ctrl/⌘ + wheel zooms. Nodes can be dragged to untangle edges. */}
          <div ref={viewport} className="overflow-auto rounded-xl border border-line bg-surface" style={{ height: Math.min(contentH * zoom + CONTROLS_ROOM, 620) + 2 }}>
            <div className="relative" style={{ width: contentW * zoom, height: contentH * zoom + CONTROLS_ROOM }}>
              <div className="absolute top-0 left-0 origin-top-left" style={{ width: contentW, height: contentH, transform: `scale(${zoom})` }}>
                <svg aria-hidden="true" width={contentW} height={contentH} viewBox={`0 0 ${contentW} ${contentH}`} className="absolute inset-0">
                  <defs>
                    <marker id="clef-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0 0 L10 5 L0 10 z" fill={TRANSFER_STROKE} />
                    </marker>
                  </defs>
                  {edges.map((e, i) => {
                    const st = edgeStyle(e);
                    return (
                      <path
                        key={e.id}
                        data-edge={e.kind}
                        {...(e.kind === 'transfer' && { 'data-transfer': e.transfers.map((t) => t.kind).join(' ') })}
                        d={geometry[i]!.d}
                        stroke={st.stroke}
                        strokeWidth={e.kind === 'transfer' ? 1.75 : 1.5}
                        strokeLinecap="round"
                        fill="none"
                        strokeDasharray={st.dash}
                        opacity={faded(e) ? 0.12 : 1}
                        {...(e.kind === 'transfer' && { markerEnd: 'url(#clef-flow-arrow)' })}
                      />
                    );
                  })}
                  {/* Labels after every edge, with a halo, so no line runs through a label. */}
                  {edges.map((e, i) => {
                    const st = edgeStyle(e);
                    return (
                      <text
                        key={`l-${e.id}`}
                        x={labelAt[i]!.x}
                        y={labelAt[i]!.y}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={st.weight}
                        fill={st.text}
                        stroke="#FFFFFF"
                        strokeWidth={4}
                        strokeLinejoin="round"
                        paintOrder="stroke"
                        opacity={faded(e) ? 0.15 : 1}
                      >
                        <title>{e.label}</title>
                        {fitLabel(e.label)}
                      </text>
                    );
                  })}
                </svg>
                {layout.isolatedTop !== null && (
                  <span className="absolute text-xs font-semibold tracking-[0.06em] text-muted uppercase" style={{ left: GRAPH.left, top: layout.isolatedTop - 22 }}>
                    No drawn link
                  </span>
                )}
                {placedNodes.map((n) => {
                  const on = n.address === selected?.address;
                  const mine = input.mine.has(n.address);
                  const program = input.programs.has(n.address);
                  const named = n.title !== shortAddress(n.address);
                  // Names from an IDL are the program describing itself: set apart from Clef's trusted labels.
                  const fromIdl = !input.labels.has(n.address) && !!input.idlNames?.has(n.address);
                  const kind = program ? 'program' : pdaChild(input, n.address) ? 'PDA' : null;
                  const fact = factFor(input, n.address, tab);
                  const owner = ownerText(fact);
                  const badge = fact?.lifecycle === 'created' ? 'new' : fact?.lifecycle === 'closed' ? 'closed' : null;
                  return (
                    <button
                      key={n.address}
                      type="button"
                      aria-pressed={on}
                      onPointerDown={onPointerDown(n)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerEnter={() => setHover(n.address)}
                      onPointerLeave={() => setHover((h) => (h === n.address ? null : h))}
                      onFocus={() => setHover(n.address)}
                      onBlur={() => setHover((h) => (h === n.address ? null : h))}
                      aria-describedby={hovered?.address === n.address ? 'clef-graph-card' : undefined}
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
                      {badge && (
                        <span className={`absolute -top-2 right-2 rounded-full px-1.5 text-[10px] leading-4 font-semibold uppercase ${badge === 'new' ? 'bg-ok text-white' : 'bg-danger-text text-white'}`}>{badge}</span>
                      )}
                      {/* Unnamed accounts are titled by their key, not repeated below. A click selects the node (its key
                          is copyable in the panel below): at small zoom a copy target here would swallow the clicks. */}
                      {named ? (
                        <>
                          <span className={`w-full truncate text-xs font-semibold ${fromIdl ? 'font-mono' : ''}`} {...(fromIdl && { title: 'Name from the program’s IDL' })}>{n.title}</span>
                          <span className="w-full truncate font-mono text-xs text-muted">{kind ? `${kind} · ` : ''}{shortAddress(n.address)}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-full truncate font-mono text-xs font-semibold">{shortAddress(n.address)}</span>
                          {kind && <span className="w-full truncate text-xs text-muted">{kind}</span>}
                        </>
                      )}
                      {owner && !program && <span className="w-full truncate text-[11px] text-muted">owner · {owner}</span>}
                    </button>
                  );
                })}
                <div className="absolute top-3 left-3.5 flex gap-3.5 text-xs text-muted">
                  <span>— in the request</span>
                  <span className="text-ok">- - PDA seeds</span>
                  <span>··· outside the request</span>
                  {transfers.length > 0 && <span style={{ color: TRANSFER_STROKE }}>→ transfer (dotted: by a called program)</span>}
                </div>
              </div>
            </div>
          </div>
          {hovered && (
            <div
              id="clef-graph-card"
              role="tooltip"
              className="pointer-events-none absolute z-[4] w-[260px] rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg"
              style={cardPosition(hovered, zoom, viewport.current)}
            >
              <AccountCard title={hovered.title} address={hovered.address} fact={factFor(input, hovered.address, tab)} transfers={transfers} label={label} program={input.programs.has(hovered.address)} compact />
            </div>
          )}
        </div>
      )}
      {transfers.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 self-start text-xs">
          <input type="checkbox" role="switch" checked={showTransfers} aria-checked={showTransfers} onChange={() => setShowTransfers(!showTransfers)} className="m-0 size-[18px] accent-primary" />
          Show SOL and token transfers ({transfers.length})
        </label>
      )}
      {input.transfersPartial && <span className="text-xs text-muted">The RPC didn't report what the called programs moved: only transfers the instructions make themselves are drawn.</span>}
      {selected && (
        <section role="group" aria-label="Selected account details" className="rounded-xl border border-line bg-surface px-3.5 py-3">
          <AccountCard title={selected.title} address={selected.address} fact={factFor(input, selected.address, tab)} transfers={transfers} label={label} program={input.programs.has(selected.address)} />
        </section>
      )}
      {selected && <SeedPanel account={selected.address} edges={input.edges} label={label} />}
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

/** Next to the node, inside the visible part of the viewport. */
function cardPosition(n: GraphNode, zoom: number, viewport: HTMLDivElement | null): { left: number; top: number } {
  const sl = viewport?.scrollLeft ?? 0;
  const st = viewport?.scrollTop ?? 0;
  const vw = viewport?.clientWidth ?? 672;
  const right = (n.x + GRAPH.nodeW) * zoom - sl + 8;
  const left = right + 260 > vw ? Math.max(4, n.x * zoom - sl - 268) : right;
  return { left, top: Math.max(4, n.y * zoom - st) };
}

const LIFECYCLE: Record<AccountFactView['lifecycle'], string | null> = {
  created: 'Created by this transaction',
  closed: 'Closed by this transaction',
  missing: "Doesn't exist before or after this transaction",
  existing: null,
};

/** What Clef knows of an account: owner, size, lamports and token balance before and after, and what moves through it. */
export function AccountCard({ title, address, fact, transfers, label, program, compact = false }: {
  title: string;
  address: string;
  fact: AccountFactView | null;
  transfers: TransferView[];
  label: (a: string) => string;
  program: boolean;
  compact?: boolean;
}) {
  const life = fact ? LIFECYCLE[fact.lifecycle] : null;
  const moves = transfers.filter((t) => t.from === address || t.to === address);
  const shown = compact ? moves.slice(0, 6) : moves;
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-2 text-xs">
      <span className="w-[72px] flex-none text-muted">{k}</span>
      <span className="min-w-0 flex-1 break-words">{v}</span>
    </div>
  );
  const change = (before: string | null, after: string | null, delta: string | null) =>
    before === after || after === null ? (
      <span className="font-mono">{before ?? 'unknown'}{after === null && before !== null ? ' (after: unknown)' : ''}</span>
    ) : (
      <span className="font-mono">
        {before ?? '?'} → {after}
        {delta && <span className={delta.startsWith('-') ? ' text-danger-text' : ' text-ok'}> ({delta})</span>}
      </span>
    );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {title !== shortAddress(address) && <span className="truncate text-xs font-semibold">{title}</span>}
      {!compact ? <Pubkey value={address} className="self-start text-xs text-muted" /> : <span className="font-mono text-xs text-muted">{shortAddress(address)}</span>}
      {life && <span className={`text-xs font-semibold ${fact?.lifecycle === 'closed' ? 'text-danger-text' : fact?.lifecycle === 'created' ? 'text-ok' : 'text-muted'}`}>{life}</span>}
      {!fact && <span className="text-xs text-muted">{program ? 'Program' : 'No state known for this account.'}</span>}
      {fact && (
        <>
          {!fact.owner && !program && row('Owner', <span className="text-muted">unknown (account not read)</span>)}
          {fact.owner && row(fact.executable ? 'Loader' : 'Owner', <>{fact.ownerName ?? label(fact.owner)}{!compact && fact.ownerName && <> <Pubkey value={fact.owner} className="text-muted" /></>}{fact.ownerNow && <span className="text-muted"> (today)</span>}</>)}
          {fact.executable && row('Kind', 'Program (executable)')}
          {fact.dataLength !== null && row('Data', `${fact.dataLength.toLocaleString('en-US')} bytes`)}
          {row('Lamports', change(fact.lamports.before, fact.lamports.after, fact.lamports.delta))}
          {fact.token && (
            <>
              {row('Token', <>{fact.token.symbol} · held by {label(fact.token.holder)}</>)}
              {row('Balance', change(fact.token.before, fact.token.after, fact.token.delta))}
            </>
          )}
        </>
      )}
      {shown.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Transfers</span>
          {shown.map((t, i) => {
            const out = t.from === address;
            const other = out ? t.to : t.from;
            const verb = t.kind === 'create' ? (out ? 'funds new' : 'funded by') : t.kind === 'mint' ? (out ? 'mints to' : 'minted from') : t.kind === 'burn' ? (out ? 'burns at' : 'burned from') : out ? 'to' : 'from';
            return (
              <span key={i} className="text-xs">
                <span className={out ? 'text-danger-text' : 'text-ok'}>{out ? '−' : '+'}{t.amount}</span> {verb} {label(other)}
                {t.kind === 'create' && t.ownerName && <span className="text-muted"> (owner {t.ownerName}{t.space !== undefined ? `, ${t.space} bytes` : ''})</span>}
                {t.inner && <span className="text-muted"> · via CPI in #{t.instructionIndex + 1}</span>}
              </span>
            );
          })}
          {moves.length > shown.length && <span className="text-xs text-muted">+{moves.length - shown.length} more (select the account)</span>}
        </div>
      )}
    </div>
  );
}
