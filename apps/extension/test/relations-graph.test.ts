import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphInput } from '../entrypoints/approval/tx/RelationsGraph';

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
