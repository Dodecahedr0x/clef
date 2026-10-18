import type { AccountFactView, TransferView } from '@clef/explain';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { factFor, RelationsGraph, type GraphInput } from '../entrypoints/approval/tx/RelationsGraph';

const ME = '5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a';
const NEW = 'GdxfTLbLv7wPJmBq3FfS3bUkMSWPdmDbcn3PzVgYGtAs';
const TOKEN = '9j8y2g8Cr6hp2SAP7P9prRQ1jSidJeyV6BnCE85VUkpj';
const PROGRAM = 'EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy';
const SYSTEM = '11111111111111111111111111111111';
afterEach(cleanup);

const fact = (over: Partial<AccountFactView> & { address: string; step?: number }): AccountFactView & { step: number } => ({
  owner: SYSTEM, ownerName: 'System Program', executable: false, dataLength: 0, lifecycle: 'existing',
  lamports: { before: '1 SOL', after: '1 SOL', delta: '0 SOL' }, step: 0, ...over,
});

const transfers: (TransferView & { step: number })[] = [
  { kind: 'create', from: ME, to: NEW, amount: '0.00203928 SOL', instructionIndex: 0, inner: false, owner: PROGRAM, space: 165, step: 0 },
  { kind: 'token', from: NEW, to: TOKEN, amount: '15.5 USDC', instructionIndex: 1, inner: true, step: 0 },
];

const input = (over: Partial<GraphInput> = {}): GraphInput => ({
  edges: [],
  external: [],
  inRequest: new Map([ME, NEW, TOKEN, PROGRAM].map((a) => [a, new Set([0])])),
  mine: new Set([ME]),
  programs: new Set([PROGRAM]),
  labels: new Map([[ME, 'You · Main'], [TOKEN, 'Your USDC token account']]),
  facts: new Map([
    [ME, [fact({ address: ME, lamports: { before: '1 SOL', after: '0.99796072 SOL', delta: '-0.00203928 SOL' } })]],
    [NEW, [fact({ address: NEW, owner: PROGRAM, ownerName: undefined, dataLength: 165, lifecycle: 'created', lamports: { before: '0 SOL', after: '0.00203928 SOL', delta: '+0.00203928 SOL' } })]],
    [TOKEN, [fact({
      address: TOKEN, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', ownerName: 'Token Program', ownerNow: true, dataLength: 165,
      token: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', holder: ME, symbol: 'USDC', before: '3 USDC', after: '18.5 USDC', delta: '+15.5 USDC' },
    })]],
  ]),
  transfers,
  ...over,
});

const node = (name: RegExp) => screen.getAllByRole('button', { pressed: false }).concat(screen.getAllByRole('button', { pressed: true })).find((b) => name.test(b.textContent ?? ''))!;

describe('relations graph account facts', () => {
  it('marks created accounts, names each owner, and draws transfers as arrows with their amount', () => {
    const { container } = render(<RelationsGraph input={input()} tab="all" batchSize={1} />);
    const created = node(/GdxfTL|Gdxf…/);
    expect(within(created).getByText('new')).toBeTruthy();
    expect(created.textContent).toContain('owner · EMBE…M5qy');
    expect(node(/You · Main/).textContent).toContain('owner · System Program');
    expect(container.querySelectorAll('path[data-transfer]')).toHaveLength(2);
    expect(container.querySelector('path[data-transfer="create"]')?.getAttribute('marker-end')).toContain('clef-flow-arrow');
    const labels = [...container.querySelectorAll('svg text')].map((t) => t.lastChild?.textContent);
    expect(labels).toContain('funds 0.00203928 SOL');
    expect(labels).toContain('15.5 USDC');

    fireEvent.click(screen.getByRole('switch', { name: /Show SOL and token transfers \(2\)/ }));
    expect(container.querySelectorAll('path[data-transfer]')).toHaveLength(0);
  });

  it('shows lamports, token balance, owner and transfers when hovering an account', () => {
    render(<RelationsGraph input={input()} tab="all" batchSize={1} />);
    fireEvent.pointerEnter(node(/Your USDC token account/));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).toContain('Token Program');
    expect(card.textContent).toContain('(today)');
    expect(card.textContent).toContain('165 bytes');
    expect(card.textContent).toContain('3 USDC → 18.5 USDC (+15.5 USDC)');
    expect(card.textContent).toContain('+15.5 USDC from');
    expect(card.textContent).toContain('via CPI in #2');

    fireEvent.pointerEnter(node(/Gdxf/));
    const created = screen.getByRole('tooltip');
    expect(created.textContent).toContain('Created by this transaction');
    expect(created.textContent).toContain('0 SOL → 0.00203928 SOL (+0.00203928 SOL)');
    expect(created.textContent).toContain('+0.00203928 SOL funded by You · Main');
    fireEvent.pointerLeave(node(/Gdxf/));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the selected account the same way, for touch and keyboard', () => {
    render(<RelationsGraph input={input()} tab="all" batchSize={1} />);
    fireEvent.click(node(/You · Main/));
    const details = screen.getByRole('group', { name: 'Selected account details' });
    expect(details.textContent).toContain('1 SOL → 0.99796072 SOL (-0.00203928 SOL)');
    expect(details.textContent).toContain('−0.00203928 SOL funds new');
  });

  it('notes when called programs’ transfers are unknown', () => {
    render(<RelationsGraph input={input({ transfersPartial: true })} tab="all" batchSize={1} />);
    expect(screen.getByText(/only transfers the instructions make themselves are drawn/)).toBeTruthy();
  });

  it('across steps, keeps before from the first and after from the last', () => {
    const g = input({
      facts: new Map([[NEW, [
        fact({ address: NEW, lifecycle: 'missing', lamports: { before: '0 SOL', after: '0 SOL', delta: '0 SOL' } }),
        fact({ address: NEW, lifecycle: 'existing', step: 1, lamports: { before: '0.5 SOL', after: '0.7 SOL', delta: '+0.2 SOL' } }),
      ]]]),
    });
    expect(factFor(g, NEW, 'all')).toMatchObject({ lifecycle: 'created', lamports: { before: '0 SOL', after: '0.7 SOL', delta: null } });
    expect(factFor(g, NEW, 1)!.lamports.delta).toBe('+0.2 SOL');
  });
});

describe('relations graph node text', () => {
  it('shows an unnamed account’s key once (as its title), and a named one’s key under its name', () => {
    render(<RelationsGraph input={input()} tab="all" batchSize={1} />);
    const unnamed = node(/Gdxf/);
    expect(within(unnamed).getAllByRole('button', { name: `Copy ${NEW}` })).toHaveLength(1);
    expect(unnamed.textContent?.match(/Gdxf…/g)).toHaveLength(1);
    const named = node(/Your USDC token account/);
    expect(within(named).getByRole('button', { name: `Copy ${TOKEN}` })).toBeTruthy();
  });

  it('says when an account’s owner is unknown', () => {
    const g = input();
    g.facts!.set(NEW, [fact({ address: NEW, owner: null, ownerName: undefined, dataLength: null })]);
    render(<RelationsGraph input={g} tab="all" batchSize={1} />);
    fireEvent.pointerEnter(node(/Gdxf/));
    expect(screen.getByRole('tooltip').textContent).toContain('unknown (account not read)');
  });
});
