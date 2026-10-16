import { describe, expect, it } from 'vitest';
import { edgePath, layoutGraph, placeLabels, type GraphInput } from '../entrypoints/approval/tx/RelationsGraph';

const input = (over: Partial<GraphInput> = {}): GraphInput => ({
  edges: [],
  external: [],
  inRequest: new Map([
    ['ME', new Set([0])],
    ['RECIPIENT', new Set([0])],
    ['SESSION', new Set([0])],
    ['PROGRAM', new Set([0])],
  ]),
  mine: new Set(['ME']),
  programs: new Set(['PROGRAM']),
  labels: new Map(),
  ...over,
});

describe('layoutGraph', () => {
  it('draws every account of the request, even with no verified link', () => {
    const { nodes } = layoutGraph(input(), false);
    expect(nodes.map((n) => n.address).sort()).toEqual(['ME', 'PROGRAM', 'RECIPIENT', 'SESSION']);
    expect(nodes.find((n) => n.address === 'ME')!.col).toBe(0);
    expect(nodes.find((n) => n.address === 'PROGRAM')!.col).toBe(2);
    expect(nodes.find((n) => n.address === 'SESSION')!.col).toBe(1);
  });

  it('adds accounts outside the request only when asked', () => {
    const external = [{ from: 'SESSION', to: 'OUTSIDE', kind: 'program-owner', label: 'owner', status: 'verified', external: true, steps: [0] }] as GraphInput['external'];
    expect(layoutGraph(input({ external }), false).nodes.some((n) => n.address === 'OUTSIDE')).toBe(false);
    expect(layoutGraph(input({ external }), true).nodes.find((n) => n.address === 'OUTSIDE')?.col).toBe(3);
  });
});

describe('edge labels and routing', () => {
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

  it('routes an edge by where its nodes are, so dragged nodes keep their links', () => {
    const left = edgePath({ x: 0, y: 0 }, { x: 400, y: 200 });
    expect(left.d.startsWith('M136 ')).toBe(true);
    const swapped = edgePath({ x: 400, y: 200 }, { x: 0, y: 0 });
    expect(swapped.d).toBe(left.d);
    const stacked = edgePath({ x: 10, y: 0 }, { x: 20, y: 300 });
    expect(stacked.d).toMatch(/^M146 26 C/);
  });
});
