/**
 * Layered ("Sugiyama") layout: every edge goes between neighbouring columns, edges spanning several columns
 * bend through reserved slots in the columns between, so no edge runs under a node. Columns are ordered to
 * reduce crossings. Pure and deterministic: same input, same picture.
 */

export type Pos = { x: number; y: number };
export type LayoutEdge = { id: string; from: string; to: string };
export type LayoutOptions = { nodeW: number; nodeH: number; gapX: number; gapY: number; margin: { top: number; left: number } };
export type Layout = {
  /** Top-left corner of each node. */
  pos: Map<string, Pos>;
  /** Bend points of each edge, in from -> to order (empty between neighbouring columns). */
  routes: Map<string, Pos[]>;
  /** Nodes with no edge, laid out in a strip under the graph. */
  isolated: string[];
  /** Top of that strip, when there is one. */
  isolatedTop: number | null;
  width: number;
  height: number;
};

type Item = { id: string; dummy: boolean };
const DUMMY_H = 8;
const DUMMY_GAP = 10;

export function layered(nodes: readonly string[], edges: readonly LayoutEdge[], o: LayoutOptions): Layout {
  const known = new Set(nodes);
  const valid = edges.filter((e) => e.from !== e.to && known.has(e.from) && known.has(e.to));
  const linked = new Set(valid.flatMap((e) => [e.from, e.to]));
  const graphNodes = nodes.filter((n) => linked.has(n));
  const isolated = nodes.filter((n) => !linked.has(n));

  // 1. Break cycles: an edge back to a node on the DFS stack is laid out reversed.
  const out = new Map<string, LayoutEdge[]>(graphNodes.map((n) => [n, []]));
  for (const e of valid) out.get(e.from)!.push(e);
  const reversed = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    state.set(n, 1);
    for (const e of out.get(n)!) {
      const s = state.get(e.to);
      if (s === 1) reversed.add(e.id);
      else if (s === undefined) visit(e.to);
    }
    state.set(n, 2);
  };
  for (const n of graphNodes) if (!state.has(n)) visit(n);
  // Laid-out direction: u -> v puts u one or more columns right of v.
  const dag = valid.map((e) => (reversed.has(e.id) ? { id: e.id, u: e.to, v: e.from } : { id: e.id, u: e.from, v: e.to }));

  // 2. Columns: longest path from the sinks (column 0, left), then each node pulled next to its closest predecessor.
  const succ = new Map<string, string[]>(graphNodes.map((n) => [n, []]));
  const pred = new Map<string, string[]>(graphNodes.map((n) => [n, []]));
  for (const { u, v } of dag) {
    succ.get(u)!.push(v);
    pred.get(v)!.push(u);
  }
  const layer = new Map<string, number>();
  const depth = (n: string): number => {
    const known = layer.get(n);
    if (known !== undefined) return known;
    layer.set(n, 0);
    const d = Math.max(-1, ...succ.get(n)!.map(depth)) + 1;
    layer.set(n, d);
    return d;
  };
  for (const n of graphNodes) depth(n);
  for (const n of [...graphNodes].sort((a, b) => layer.get(b)! - layer.get(a)!)) {
    const p = pred.get(n)!;
    if (p.length) layer.set(n, Math.max(layer.get(n)!, Math.min(...p.map((x) => layer.get(x)!)) - 1));
  }
  const layers = Math.max(0, ...graphNodes.map((n) => layer.get(n)!)) + 1;

  // 3. Edges spanning several columns get one slot ("dummy") per column they cross.
  const columns: Item[][] = Array.from({ length: graphNodes.length ? layers : 0 }, () => []);
  for (const n of graphNodes) columns[layer.get(n)!]!.push({ id: n, dummy: false });
  const segments: [string, string][] = [];
  const chains = new Map<string, string[]>();
  const dummyFrom = new Map<string, string>();
  for (const { id, u, v } of dag) {
    const chain = [u];
    for (let l = layer.get(u)! - 1; l > layer.get(v)!; l--) {
      const d = `\u0000${id}\u0000${l}`;
      columns[l]!.push({ id: d, dummy: true });
      layer.set(d, l);
      dummyFrom.set(d, u);
      chain.push(d);
    }
    chain.push(v);
    for (let i = 0; i + 1 < chain.length; i++) segments.push([chain[i]!, chain[i + 1]!]);
    chains.set(id, chain);
  }
  const neighbours = new Map<string, { left: string[]; right: string[] }>();
  const nb = (n: string) => neighbours.get(n) ?? (neighbours.set(n, { left: [], right: [] }), neighbours.get(n)!);
  for (const [a, b] of segments) {
    // a is one column right of b.
    nb(a).left.push(b);
    nb(b).right.push(a);
  }

  // 4. Order each column to minimise crossings: barycenter sweeps, then swapping neighbours while it helps
  // ("transpose"), from two starting orders (input order, and depth-first from the first nodes); the best wins.
  const index = new Map<string, number>();
  const reindex = () => columns.forEach((c) => c.forEach((it, i) => index.set(it.id, i)));
  // Segments between column l (their first end) and column l - 1.
  const segsAt: [string, string][][] = columns.map(() => []);
  for (const seg of segments) segsAt[layer.get(seg[0])!]!.push(seg);
  const crossingsAt = (l: number) => {
    if (l < 1 || l >= columns.length) return 0;
    const segs = segsAt[l]!.map(([a, b]) => [index.get(a)!, index.get(b)!] as const);
    let count = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) if ((segs[i]![0] - segs[j]![0]) * (segs[i]![1] - segs[j]![1]) < 0) count++;
    }
    return count;
  };
  const crossings = () => columns.reduce((sum, _, l) => sum + crossingsAt(l), 0);
  const sortBy = (col: Item[], side: 'left' | 'right') => {
    const key = new Map(col.map((it, i) => {
      const ns = nb(it.id)[side];
      return [it.id, ns.length ? ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length : i] as const;
    }));
    col.sort((a, b) => key.get(a.id)! - key.get(b.id)!);
  };
  const transpose = () => {
    for (let pass = 0, improved = true; improved && pass < 20; pass++) {
      improved = false;
      for (let l = 0; l < columns.length; l++) {
        const col = columns[l]!;
        for (let i = 0; i + 1 < col.length; i++) {
          const before = crossingsAt(l) + crossingsAt(l + 1);
          [col[i], col[i + 1]] = [col[i + 1]!, col[i]!];
          reindex();
          if (crossingsAt(l) + crossingsAt(l + 1) < before) improved = true;
          else {
            [col[i], col[i + 1]] = [col[i + 1]!, col[i]!];
            reindex();
          }
        }
      }
    }
  };
  const optimise = (swaps: boolean) => {
    let best = columns.map((c) => [...c]);
    let bestCount = crossings();
    for (let iter = 0; iter < (swaps ? 24 : 8) && bestCount > 0; iter++) {
      if (iter % 2 === 0) for (let l = 1; l < columns.length; l++) (sortBy(columns[l]!, 'left'), reindex());
      else for (let l = columns.length - 2; l >= 0; l--) (sortBy(columns[l]!, 'right'), reindex());
      if (swaps) transpose();
      const c = crossings();
      if (c < bestCount) {
        bestCount = c;
        best = columns.map((col) => [...col]);
      }
    }
    return { best, bestCount };
  };
  const starts: string[][] = [graphNodes];
  const seen = new Set<string>();
  const dfs: string[] = [];
  const walk = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    dfs.push(n);
    for (const m of [...nb(n).left, ...nb(n).right]) walk(m);
  };
  for (const n of graphNodes) walk(n);
  starts.push(dfs);
  let winner: { best: Item[][]; bestCount: number } | null = null;
  // Candidates: plain sweeps from the order the columns were built in (the swaps can settle in a worse local
  // optimum), and sweeps with swaps from each start.
  const built = columns.map((c) => [...c]);
  const candidates: [string[] | null, boolean][] = [[null, false], ...starts.map((st) => [st, true] as [string[], boolean])];
  for (const [start, swaps] of candidates) {
    built.forEach((c, l) => (columns[l] = [...c]));
    if (start) {
      const rank = new Map(start.map((n, i) => [n, i]));
      // Dummies follow the node their edge starts from.
      const at = (id: string) => rank.get(id) ?? rank.get(dummyFrom.get(id) ?? '') ?? 0;
      for (const col of columns) col.sort((a, b) => at(a.id) - at(b.id));
    }
    reindex();
    const result = optimise(swaps);
    if (!winner || result.bestCount < winner.bestCount) winner = result;
  }
  if (winner) winner.best.forEach((c, l) => (columns[l] = c));
  reindex();

  // 5. Heights: stack each column, then pull every item toward its neighbours' centre without overlapping.
  const h = (it: Item) => (it.dummy ? DUMMY_H : o.nodeH);
  const gap = (a: Item, b: Item) => (a.dummy && b.dummy ? DUMMY_GAP : o.gapY);
  const y = new Map<string, number>();
  for (const col of columns) {
    let at = 0;
    col.forEach((it, i) => {
      if (i) at += gap(col[i - 1]!, it);
      y.set(it.id, at);
      at += h(it);
    });
  }
  const centre = (id: string) => y.get(id)! + (id.startsWith('\u0000') ? DUMMY_H : o.nodeH) / 2;
  for (let iter = 0; iter < 6; iter++) {
    const order = iter % 2 === 0 ? columns.map((_, l) => l) : columns.map((_, l) => columns.length - 1 - l);
    for (const l of order) {
      const col = columns[l]!;
      const want = col.map((it) => {
        const ns = [...nb(it.id).left, ...nb(it.id).right];
        return ns.length ? ns.reduce((s, n) => s + centre(n), 0) / ns.length - h(it) / 2 : y.get(it.id)!;
      });
      // Down then up: as close to the wanted height as the order and spacing allow.
      const placed = want.map((w) => w);
      for (let i = 1; i < col.length; i++) placed[i] = Math.max(placed[i]!, placed[i - 1]! + h(col[i - 1]!) + gap(col[i - 1]!, col[i]!));
      for (let i = col.length - 2; i >= 0; i--) {
        placed[i] = Math.min(placed[i]!, placed[i + 1]! - h(col[i]!) - gap(col[i]!, col[i + 1]!));
      }
      for (let i = 1; i < col.length; i++) placed[i] = Math.max(placed[i]!, placed[i - 1]! + h(col[i - 1]!) + gap(col[i - 1]!, col[i]!));
      col.forEach((it, i) => y.set(it.id, placed[i]!));
    }
  }
  const minY = y.size ? Math.min(...y.values()) : 0;
  const top = o.margin.top - minY;
  const x = (l: number) => o.margin.left + l * (o.nodeW + o.gapX);

  const pos = new Map<string, Pos>();
  for (const n of graphNodes) pos.set(n, { x: x(layer.get(n)!), y: y.get(n)! + top });
  const routes = new Map<string, Pos[]>();
  for (const e of valid) {
    const chain = chains.get(e.id)!;
    const bends = chain.slice(1, -1).map((d) => ({ x: x(layer.get(d)!) + o.nodeW / 2, y: y.get(d)! + top + DUMMY_H / 2 }));
    routes.set(e.id, reversed.has(e.id) ? bends.reverse() : bends);
  }

  const graphW = graphNodes.length ? x(layers - 1) + o.nodeW : 0;
  const graphH = graphNodes.length ? Math.max(...[...y.entries()].map(([id, v]) => v + top + (id.startsWith('\u0000') ? DUMMY_H : o.nodeH))) : o.margin.top;
  // Unlinked accounts: a grid under the graph, as wide as the graph (at least three across).
  const perRow = Math.max(3, Math.floor((graphW - o.margin.left + o.gapY) / (o.nodeW + o.gapY)));
  const isolatedTop = isolated.length ? graphH + (graphNodes.length ? 48 : 0) : null;
  isolated.forEach((n, i) => {
    pos.set(n, { x: o.margin.left + (i % perRow) * (o.nodeW + o.gapY), y: isolatedTop! + Math.floor(i / perRow) * (o.nodeH + o.gapY) });
  });
  const isolatedW = isolated.length ? o.margin.left + Math.min(perRow, isolated.length) * (o.nodeW + o.gapY) - o.gapY : 0;
  const height = isolated.length ? isolatedTop! + Math.ceil(isolated.length / perRow) * (o.nodeH + o.gapY) : graphH;
  return { pos, routes, isolated, isolatedTop, width: Math.max(graphW, isolatedW) + o.margin.left, height: height + 16 };
}
