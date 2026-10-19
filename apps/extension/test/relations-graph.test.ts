import { describe, expect, it } from 'vitest';
import { edgeGeometry, fitLabel, GRAPH, graphEdges, LABEL_MAX, layoutGraph, placeLabels, type GraphInput } from '../entrypoints/approval/tx/RelationsGraph';
import { layered, type LayoutEdge } from '../entrypoints/approval/tx/graph-layout';
import { shortAddress } from '../lib/format';

const rel = (from: string, to: string, label = 'owner', over: Partial<GraphInput['edges'][number]> = {}): GraphInput['edges'][number] =>
  ({ kind: 'token-owner', from, to, label, status: 'verified', external: false, steps: [0], ...over }) as GraphInput['edges'][number];

const input = (over: Partial<GraphInput> = {}): GraphInput => ({
  edges: [],
  external: [],
  inRequest: new Map(['ME', 'RECIPIENT', 'SESSION', 'PROGRAM'].map((a) => [a, new Set([0])])),
  mine: new Set(['ME']),
  programs: new Set(['PROGRAM']),
  labels: new Map(),
  ...over,
});
const OPTS = { showExternal: false, showTransfers: true, tab: 'all' as const };
const LO = { nodeW: GRAPH.nodeW, nodeH: GRAPH.nodeH, gapX: GRAPH.gapX, gapY: GRAPH.gapY, margin: { top: GRAPH.top, left: GRAPH.left } };
const STEP = GRAPH.nodeW + GRAPH.gapX;

/** A busy transaction: hubs, a long edge, a cycle. */
const BUSY: LayoutEdge[] = [
  ['ta1', 'wallet'], ['ta2', 'wallet'], ['ta1', 'mint'], ['ta2', 'mint'], ['pda1', 'program'], ['pda2', 'program'],
  ['pda1', 'ta1'], ['state', 'pda1'], ['state', 'mint'], ['state', 'program'], ['pda2', 'state'], ['ta3', 'pda2'], ['ta3', 'mint'],
].map(([from, to]) => ({ id: `${from}>${to}`, from: from!, to: to! }));

describe('layered layout', () => {
  const nodes = [...new Set(BUSY.flatMap((e) => [e.from, e.to]))];

  it('puts every edge between neighbouring columns, long ones bending through slots in the columns between', () => {
    const l = layered(nodes, BUSY, LO);
    for (const e of BUSY) {
      const a = l.pos.get(e.from)!;
      const b = l.pos.get(e.to)!;
      const xs = [a.x + GRAPH.nodeW / 2, ...l.routes.get(e.id)!.map((p) => p.x), b.x + GRAPH.nodeW / 2];
      for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - xs[i - 1]!), e.id).toBe(STEP);
    }
    expect([...l.routes.values()].some((r) => r.length > 0)).toBe(true);
  });

  it('never puts a bend inside a node, nor two nodes on top of each other', () => {
    const l = layered(nodes, BUSY, LO);
    const boxes = nodes.map((n) => l.pos.get(n)!);
    for (const r of l.routes.values()) {
      for (const p of r) for (const b of boxes) expect(p.x > b.x && p.x < b.x + GRAPH.nodeW && p.y > b.y && p.y < b.y + GRAPH.nodeH).toBe(false);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        expect(a.x === b.x && Math.abs(a.y - b.y) < GRAPH.nodeH + GRAPH.gapY, `${nodes[i]} / ${nodes[j]}`).toBe(false);
      }
    }
  });

  it('untangles crossings', () => {
    // a-c and b-d cross in input order (c before d is reversed); the layout swaps them.
    const edges: LayoutEdge[] = [{ id: '1', from: 'a', to: 'd' }, { id: '2', from: 'b', to: 'c' }];
    const l = layered(['a', 'b', 'c', 'd'], edges, LO);
    const above = (x: string, y: string) => l.pos.get(x)!.y < l.pos.get(y)!.y;
    expect(above('a', 'b')).toBe(above('d', 'c'));
  });

  it('finds an order with no crossing when one exists, whatever the input order', () => {
    // A ladder: hubs on the left, each linked to two neighbours on the right; listed in a scrambled order.
    const pairs = [['r4', 'h1'], ['r1', 'h3'], ['r3', 'h2'], ['r2', 'h1'], ['r3', 'h3'], ['r2', 'h2'], ['r5', 'h4'], ['r4', 'h4'], ['r1', 'h0'], ['r0', 'h0']];
    const edges = pairs.map(([from, to]) => ({ id: `${from}>${to}`, from: from!, to: to! }));
    const nodes = ['h2', 'r0', 'h4', 'r3', 'h0', 'r5', 'h1', 'r2', 'h3', 'r1', 'r4'];
    const l = layered(nodes, edges, LO);
    const y = (n: string) => l.pos.get(n)!.y;
    let crossings = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [a, b] = [edges[i]!, edges[j]!];
        if ((y(a.from) - y(b.from)) * (y(a.to) - y(b.to)) < 0) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it('keeps crossings low on random graphs (27% fewer than barycenter sweeps alone, never more)', () => {
    // Crossings between segments spanning the same pair of columns (node centres and bends).
    const count = (l: ReturnType<typeof layered>, edges: LayoutEdge[]) => {
      const segs: { x: number; y1: number; y2: number }[] = [];
      for (const e of edges) {
        const a = l.pos.get(e.from)!;
        const b = l.pos.get(e.to)!;
        const pts = [{ x: a.x, y: a.y }, ...l.routes.get(e.id)!.map((p) => ({ x: p.x - GRAPH.nodeW / 2, y: p.y })), { x: b.x, y: b.y }].sort((p, q) => p.x - q.x);
        for (let i = 1; i < pts.length; i++) segs.push({ x: pts[i - 1]!.x, y1: pts[i - 1]!.y, y2: pts[i]!.y });
      }
      let c = 0;
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
        const [p, q] = [segs[i]!, segs[j]!];
        if (p.x === q.x && (p.y1 - q.y1) * (p.y2 - q.y2) < 0) c++;
      }
      return c;
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let total = 0;
    for (let g = 0; g < 200; g++) {
      const k = 8 + Math.floor(rnd() * 20);
      const nodes = Array.from({ length: k }, (_, i) => `n${i}`);
      const edges = Array.from({ length: Math.floor(k * (1 + rnd())) }, (_, i) => ({ id: `e${i}`, from: `n${Math.floor(rnd() * k)}`, to: `n${Math.floor(rnd() * k)}` })).filter((e) => e.from !== e.to);
      total += count(layered(nodes, edges, LO), edges);
    }
    // Barycenter sweeps alone (the previous layout) gave 1481 on these graphs.
    expect(total).toBeLessThanOrEqual(1100);
  });

  it('lays out a large transaction quickly', () => {
    const n = 64;
    const nodes = Array.from({ length: n }, (_, i) => `a${i}`);
    const edges = Array.from({ length: 160 }, (_, i) => ({ id: `e${i}`, from: `a${(i * 7) % n}`, to: `a${(i * 13 + 5) % n}` }));
    const t = performance.now();
    layered(nodes, edges, LO);
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('lays out cycles, and puts accounts with no edge in a strip below', () => {
    const l = layered(['a', 'b', 'lonely'], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'a' }], LO);
    expect(l.pos.get('a')!.x).not.toBe(l.pos.get('b')!.x);
    expect(l.isolated).toEqual(['lonely']);
    expect(l.pos.get('lonely')!.y).toBeGreaterThanOrEqual(l.isolatedTop!);
    expect(l.isolatedTop!).toBeGreaterThan(Math.max(l.pos.get('a')!.y, l.pos.get('b')!.y) + GRAPH.nodeH);
  });

  it('is deterministic', () => {
    expect(layered(nodes, BUSY, LO)).toEqual(layered(nodes, BUSY, LO));
  });
});

describe('graph edges', () => {
  it('bundles every relation between the same two accounts into one line', () => {
    const g = input({ edges: [rel('SESSION', 'PROGRAM', 'owned by'), rel('SESSION', 'PROGRAM', 'x', { kind: 'pda' }), rel('SESSION', 'PROGRAM', 'owned by')] });
    const edges = graphEdges(g, OPTS);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.label).toBe('owned by · seeds');
    expect(edges[0]!.relations).toHaveLength(3);
  });

  it('names a has_one line by its field, and merges it with the stored field it checks (either direction)', () => {
    const g = input({ edges: [rel('SESSION', 'RECIPIENT', 'pool.admin', { kind: 'has_one' }), rel('RECIPIENT', 'SESSION', 'admin', { kind: 'data-ref' })] });
    const edges = graphEdges(g, OPTS);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.label).toBe('admin');
  });

  it('draws the selected step’s transfers, and none when hidden', () => {
    const t = (step: number) => ({ kind: 'sol' as const, from: 'ME', to: 'RECIPIENT', amount: `${step} SOL`, instructionIndex: 0, inner: false, step });
    const g = input({ transfers: [t(0), t(1)] });
    expect(graphEdges(g, OPTS).find((e) => e.kind === 'transfer')!.label).toBe('0 SOL · 1 SOL');
    expect(graphEdges(g, { ...OPTS, tab: 1 }).find((e) => e.kind === 'transfer')!.label).toBe('1 SOL');
    expect(graphEdges(g, { ...OPTS, showTransfers: false }).some((e) => e.kind === 'transfer')).toBe(false);
  });

  it('adds accounts outside the request only when asked', () => {
    const external = [{ ...rel('SESSION', 'OUTSIDE'), kind: 'program-owner', external: true }] as GraphInput['external'];
    expect(layoutGraph(input({ external }), OPTS).nodes.some((n) => n.address === 'OUTSIDE')).toBe(false);
    expect(layoutGraph(input({ external }), { ...OPTS, showExternal: true }).nodes.find((n) => n.address === 'OUTSIDE')?.external).toBe(true);
  });

  it('titles an account with no trusted label by its IDL name', () => {
    const g = input({ labels: new Map([['ME', 'You · Main']]), idlNames: new Map([['SESSION', 'globalConfig'], ['ME', 'authority']]) });
    const title = (a: string) => layoutGraph(g, OPTS).nodes.find((n) => n.address === a)!.title;
    expect(title('SESSION')).toBe('globalConfig');
    expect(title('ME')).toBe('You · Main');
    // No label, no IDL name: its short key.
    expect(title('RECIPIENT')).toBe(shortAddress('RECIPIENT'));
  });

  it('draws every account of the request, linked or not', () => {
    const { nodes } = layoutGraph(input({ edges: [rel('SESSION', 'ME')] }), OPTS);
    expect(nodes.map((n) => n.address).sort()).toEqual(['ME', 'PROGRAM', 'RECIPIENT', 'SESSION']);
    expect(nodes.filter((n) => n.isolated).map((n) => n.address).sort()).toEqual(['PROGRAM', 'RECIPIENT']);
  });
});

describe('edge geometry and labels', () => {
  it('spreads the ends sharing a node side, in the order of where they go', () => {
    const g = input({ edges: [rel('SESSION', 'ME'), rel('RECIPIENT', 'ME'), rel('PROGRAM', 'ME')] });
    const l = layoutGraph(g, OPTS);
    const at = new Map(l.nodes.map((n) => [n.address, n]));
    const geo = edgeGeometry(l.edges, at, l.routes);
    const me = at.get('ME')!;
    // The end of each line on ME's node (its first or last point), and where the line's other end is.
    const ends = geo.map((x, i) => {
      const nums = x.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const first = { x: nums[0]!, y: nums[1]! };
      const last = { x: nums[nums.length - 2]!, y: nums[nums.length - 1]! };
      const onMe = (p: { x: number; y: number }) => (p.x === me.x || p.x === me.x + GRAPH.nodeW) && p.y > me.y && p.y < me.y + GRAPH.nodeH;
      const e = l.edges[i]!;
      const other = at.get(e.from === 'ME' ? e.to : e.from)!;
      return { y: (onMe(first) ? first : last).y, other: other.y };
    });
    expect(new Set(ends.map((e) => e.y)).size).toBe(3);
    const rank = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length);
    expect(rank(ends.map((e) => e.y))).toEqual(rank(ends.map((e) => e.other)));
  });

  it('moves overlapping labels apart so each stays readable', () => {
    const at = placeLabels([
      { x: 100, y: 50, text: 'owner' },
      { x: 100, y: 50, text: 'ATA of' },
      { x: 102, y: 52, text: 'mint' },
      { x: 400, y: 50, text: 'seeds' },
    ]);
    const ys = at.slice(0, 3).map((p) => p.y);
    expect(new Set(ys).size).toBe(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.abs(ys[i]! - ys[j]!)).toBeGreaterThanOrEqual(14);
    expect(at[3]).toEqual({ x: 400, y: 50 });
  });

  it('shortens labels to the gap between columns', () => {
    expect(fitLabel('owner')).toBe('owner');
    const long = fitLabel('owned by · seeds · stores · authority');
    expect(long).toHaveLength(LABEL_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
});
