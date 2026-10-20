// @vitest-environment jsdom
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ useExplainBatch: vi.fn() }));
const api = vi.hoisted(() => ({ call: vi.fn(async () => ({})) }));
const windows = vi.hoisted(() => ({ getCurrent: vi.fn(async () => ({ id: 7 })), update: vi.fn(async () => ({})) }));

vi.mock('../lib/hooks', async (importOriginal) => ({ ...(await importOriginal<object>()), useExplainBatch: hooks.useExplainBatch }));
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), call: api.call }));
vi.mock('wxt/browser', () => ({ browser: { windows, runtime: { getURL: (p: string) => p, sendMessage: vi.fn() }, storage: { onChanged: { addListener() {}, removeListener() {} } } } }));

import { TxApproval } from '../entrypoints/approval/tx/TxApproval';

const ME = '7xKpWm5c9tZ3EGr2cTyhLh8kq4sUXcMcz1p4UhRf3fQa';
const WSOL_ATA = '4fYNw3dojWmQ4dXtSGE9epjRGy9pFSx62YypT7avPYvA';
const USDC_ATA = 'BtLeD8Lp3QpR3kNo9g2CwFcz9jzW3n8Tx1Vy7mSgK9mHv';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EVENT_AUTH = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MINT_AUTH = 'BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG';
const RAY_POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
const RAY_PROG = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const ALT = 'AL7ttE5rQm6z6Ge7h5y7xD8fT9zW4m2CkqHn3Z9vLtAb';

const settings = { network: 'mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com', customCluster: 'mainnet', autoLockMinutes: 15, detailLevel: 'basic', hideSpam: true, networkSwitchInHeader: true, devnetTint: true, jupiterApiKey: null, errorReports: false };
function makeState(detailLevel: 'basic' | 'intermediate' | 'expert') {
  return {
    initialized: true,
    unlocked: true,
    accounts: [{ kind: 'hd', address: ME, label: 'Main', index: 0 }],
    permissions: [],
    settings: { ...settings, detailLevel },
    activeAccount: ME,
    errorReportsAvailable: false,
  } as any;
}

const wires = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
function makeRequest(over: Record<string, unknown> = {}) {
  return { kind: 'signTransactions', origin: 'https://jup.ag', phishing: null, account: ME, chain: 'solana:mainnet', transactions: wires, send: false, signer: { kind: 'software' }, ...over } as any;
}

const swapIx = {
  index: 2,
  program: 'Jupiter v6',
  name: 'route',
  trust: 'curated',
  args: { in_amount: '1.5 SOL', slippage_bps: '50' },
  accounts: [
    { name: 'user_transfer_authority', address: ME, label: 'You · Main', badges: ['signer ✓'] },
    { name: 'user_destination_token_account', address: USDC_ATA, label: 'Your USDC account', badges: ['ATA ✓'] },
    { name: 'destination_mint', address: USDC_MINT, label: 'USDC mint', badges: [] },
    { name: 'event_authority', address: EVENT_AUTH, badges: ['event_authority ✓'] },
  ],
};
const swapExpertIx = {
  ...swapIx,
  programId: JUP,
  idl: { source: 'bundled', trust: 'curated', hash: 'ab' },
  dataHex: 'e517cb977ae3ad2a0100000011',
  accounts: [
    { ...swapIx.accounts[0], signer: true, writable: true },
    { ...swapIx.accounts[1], signer: false, writable: true },
    { ...swapIx.accounts[2], signer: false, writable: false, lookupTable: ALT },
    { ...swapIx.accounts[3], signer: false, writable: false, lookupTable: ALT },
  ],
};
const relations = [
  { kind: 'token-owner', from: USDC_ATA, to: ME, label: 'owner', status: 'verified', external: false, instructionIndex: 2 },
  { kind: 'token-mint', from: USDC_ATA, to: USDC_MINT, label: 'mint', status: 'verified', external: false, instructionIndex: 2 },
  { kind: 'pda', from: EVENT_AUTH, to: JUP, label: 'event_authority', status: 'verified', external: false, instructionIndex: 2, seeds: [{ kind: 'const', display: 'b"__event_authority"' }], bump: 255 },
];
const externalRelations = [
  { kind: 'program-owner', from: USDC_ATA, to: TOKEN_PROG, label: 'program', status: 'verified', external: true },
  { kind: 'mint-authority', from: USDC_MINT, to: MINT_AUTH, label: 'mint authority', status: 'verified', external: true },
];
const meDiff = { address: ME, title: 'You · Main', type: 'System account', tag: 'modified', lines: [{ sign: '-', key: 'lamports', value: '6_210_400_000', note: '6.2104 SOL' }, { sign: '+', key: 'lamports', value: '4_710_285_000', note: 'after tx 3' }] };
const tempDiff = { address: WSOL_ATA, title: 'Your wSOL account', type: 'Created & closed', tag: 'temp', lines: [{ sign: ' ', key: 'net', value: 'no account after the batch' }] };
const rawDiff = {
  address: RAY_POOL, title: 'Raydium SOL/USDC pool', type: 'Raydium AMM', tag: 'modified', lines: [], lastChangedBy: 1,
  undecoded: { reason: 'no IDL for owner program 675k…Mp8', summary: '16 bytes changed at 2 offsets', lines: [{ sign: '-', offset: '0x00c0', bytes: '00 2f 68 59' }, { sign: '+', offset: '0x00c0', bytes: '00 a4 3f 5e' }] },
};

const titles = ['Wrap 1.5 SOL', 'Swap 1.5 wSOL → ~212.4 USDC', 'Close wSOL account'];
const combined = {
  summary: 'Swap 1.5 SOL → ~212.4 USDC',
  balanceChanges: [{ owner: ME, asset: 'SOL', amount: '-1.5001' }, { owner: ME, asset: 'USDC', amount: '+212.4' }],
  warnings: [] as any[],
  fee: '0.000115 SOL',
  computeUnits: '201,429',
  accountDiffs: [meDiff, tempDiff, rawDiff],
  incomplete: false,
};

function stepView(level: string, i: number) {
  const base = { summary: titles[i], balanceChanges: [{ owner: ME, asset: 'USDC', amount: `+${i}` }], warnings: [] };
  if (level === 'basic') return { level, ...base };
  const otherIx = { index: 0, program: 'Token', name: i === 0 ? 'SyncNative' : 'CloseAccount', args: {}, accounts: [] };
  if (level === 'intermediate') return { level, ...base, instructions: i === 1 ? [swapIx] : [otherIx] };
  return {
    level, ...base, fee: '0.000005 SOL', version: i === 1 ? '0' : 'legacy', feePayer: ME, recentBlockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xpR7k', computeUnitLimit: 200000,
    instructions: i === 1 ? [swapExpertIx] : [{ ...otherIx, programId: TOKEN_PROG, dataHex: '11', accounts: [] }],
    relations: i === 1 ? relations : [], externalRelations: i === 1 ? externalRelations : [], issues: [], stateChanges: [],
    accountDiffs: i === 1 ? [rawDiff] : [meDiff], computeUnits: ['16,101', '182,412', '2,916'][i],
    logs: i === 1
      ? [{ depth: 0, kind: 'invoke', text: `Program ${JUP} invoke [1]`, program: 'Jupiter v6' }, { depth: 1, kind: 'log', text: 'Program log: Instruction: Route' }, { depth: 1, kind: 'consumed', text: `Program ${JUP} consumed 168213 of 395512`, computeUnits: '168,213' }, { depth: 0, kind: 'success', text: `Program ${JUP} success` }]
      : [{ depth: 0, kind: 'invoke', text: `Program ${TOKEN_PROG} invoke [1]`, program: 'Token' }, { depth: 0, kind: 'success', text: `Program ${TOKEN_PROG} success` }],
  };
}

function batchView(level: string, n = 3, over: Record<string, unknown> = {}) {
  return {
    level, mode: 'sequential', dependentSteps: [],
    combined: { ...combined, ...over },
    steps: Array.from({ length: n }, (_, i) => ({ index: i, status: 'simulated', title: titles[i], view: stepView(level, i) })),
  };
}
const rawBatch = { mode: 'sequential', steps: [0, 1, 2].map((i) => ({ index: i, status: 'simulated', explained: { accountDiffs: i === 1 ? [{ address: RAY_POOL, owner: { before: RAY_PROG, after: RAY_PROG } }] : [] } })), combined: {}, dependentSteps: [], issues: [] };

function explainWith(viewFor: (level: string) => unknown) {
  hooks.useExplainBatch.mockImplementation((_w: unknown, level: string) => ({ status: 'ok', batch: rawBatch, view: viewFor(level) }));
}

function setup(level: 'basic' | 'intermediate' | 'expert', requestOver: Record<string, unknown> = {}, onSign?: (p: Uint8Array[]) => Promise<Uint8Array[]>) {
  const onDecide = vi.fn();
  const request = makeRequest(requestOver);
  const user = userEvent.setup();
  render(<TxApproval request={request} state={makeState(level)} onDecide={onDecide} {...(onSign && { onSign })} />);
  return { onDecide, request, user };
}

beforeEach(() => {
  explainWith((level) => batchView(level));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Basic', () => {
  it('shows the combined summary, simulated balance changes, fee and an all-clear panel, without a batch switcher', async () => {
    const { onDecide, user } = setup('basic');
    expect(screen.getByText('You are about to')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: combined.summary })).toBeTruthy();
    const changes = screen.getByRole('region', { name: 'Balance changes' });
    expect(within(changes).getByText('\u22121.5001 SOL')).toBeTruthy();
    expect(within(changes).getByText('+212.4 USDC')).toBeTruthy();
    expect(within(changes).getByText('Network fee')).toBeTruthy();
    expect(within(changes).getByText('0.000115 SOL')).toBeTruthy();
    expect(screen.getByText('No warnings')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText(/Requests 3 signatures · Main/)).toBeTruthy();
    expect(hooks.useExplainBatch).toHaveBeenLastCalledWith(expect.any(Array), 'basic');
    await user.click(screen.getByRole('button', { name: 'Sign all 3' }));
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ approved: true, log: expect.objectContaining({ summary: combined.summary, dangerRules: [] }) }));
  });

  it('lists warnings in the panel and says when balance changes are unknown', () => {
    explainWith((level) => batchView(level, 1, { balanceChanges: null, warnings: [{ rule: 'unknown-program', severity: 'warn', message: 'Unknown program 9Wfh…Kz2r · no IDL found' }] }));
    setup('basic', { transactions: [wires[0]] });
    expect(screen.getByText('WARN')).toBeTruthy();
    expect(screen.getByText('Unknown program 9Wfh…Kz2r · no IDL found')).toBeTruthy();
    expect(screen.getByText(/could not be simulated/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign' })).toBeTruthy();
  });

  it('switching the detail level persists it and resizes the window', async () => {
    const { user } = setup('basic');
    await user.click(screen.getByRole('radio', { name: /Expert/ }));
    expect(api.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { detailLevel: 'expert' } });
    await waitFor(() => expect(windows.update).toHaveBeenLastCalledWith(7, { width: 760 }));
    expect(hooks.useExplainBatch).toHaveBeenLastCalledWith(expect.any(Array), 'expert');
  });
});

describe('Intermediate', () => {
  it('All tab: combined changes and the step list; a step tab: instruction cards with trust pill, args and verified badges', async () => {
    const { user } = setup('intermediate');
    const tabs = screen.getByRole('tablist', { name: 'Transactions in this request' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 3 · combined', '1 · Wrap 1.5 SOL', `2 · ${titles[1]}`, '3 · Close wSOL account']);
    expect(screen.getByText('All 3 together')).toBeTruthy();
    expect(screen.getAllByText('✓ simulated')).toHaveLength(3);
    expect(screen.getByText(/All 3 are signed together/)).toBeTruthy();

    await user.click(within(tabs).getByRole('tab', { name: `2 · ${titles[1]}` }));
    expect(within(tabs).getByRole('tab', { name: `2 · ${titles[1]}` }).getAttribute('aria-selected')).toBe('true');
    const card = screen.getByRole('article', { name: /Jupiter v6 · route/ });
    expect(within(card).getByText('Curated IDL')).toBeTruthy();
    expect(within(card).getByText('in_amount')).toBeTruthy();
    expect(within(card).getByText('1.5 SOL')).toBeTruthy();
    expect(within(card).getByText('user_destination_token_account')).toBeTruthy();
    expect(within(card).getByText('Your USDC account')).toBeTruthy();
    expect(within(card).getByText('✓ ATA')).toBeTruthy();
    expect(screen.getByText('1 instruction')).toBeTruthy();
  });

  it('never switches networks inside an approval; Expert names the request network read-only', () => {
    for (const level of ['basic', 'intermediate', 'expert'] as const) {
      setup(level, { chain: 'solana:devnet' });
      expect(screen.queryByRole('radiogroup', { name: 'Network' })).toBeNull();
      expect(screen.queryByLabelText('Network: Devnet') !== null).toBe(level === 'expert');
      cleanup();
    }
    setup('expert');
    expect(screen.getByLabelText('Network: Mainnet')).toBeTruthy();
  });

  it('a single transaction has no switcher', () => {
    explainWith((level) => batchView(level, 1));
    setup('intermediate', { transactions: [wires[0]] });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('article', { name: /Token · SyncNative/ })).toBeTruthy();
  });
});

describe('Expert', () => {
  it('rail anchors with tooltips and a change count; window is 760 wide', async () => {
    setup('expert');
    await waitFor(() => expect(windows.update).toHaveBeenCalledWith(7, { width: 760 }));
    const rail = screen.getByRole('navigation', { name: 'Transaction sections' });
    const links = within(rail).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#exp-summary', '#exp-changes', '#exp-rel', '#exp-instr', '#exp-logs', '#exp-details']);
    expect(links[1]!.getAttribute('aria-label')).toBe('State changes · 3');
    expect(within(links[1]!).getByText('3')).toBeTruthy();
    for (const tip of ['Summary', 'Account relationships', 'Instructions', 'Simulation logs', 'Transaction details']) expect(within(rail).getByRole('link', { name: tip })).toBeTruthy();
    expect(within(rail).getAllByRole('tooltip').map((t) => t.textContent)).toEqual(['Summary', 'State changes · 3', 'Account relationships', 'Instructions', 'Simulation logs', 'Transaction details']);
    for (const id of ['exp-summary', 'exp-changes', 'exp-rel', 'exp-instr', 'exp-logs', 'exp-details']) expect(document.getElementById(id)).toBeTruthy();
  });

  it('state changes: +/- diff lines, temp tag, and the Not decoded byte diff with Add IDL', async () => {
    const { user } = setup('expert');
    const section = screen.getByRole('region', { name: 'State changes' });
    expect(within(section).getByText(/Net effect of all 3/)).toBeTruthy();
    const me = within(section).getByRole('article', { name: /You · Main/ });
    expect(within(me).getByText('−')).toBeTruthy();
    expect(within(me).getByText('+')).toBeTruthy();
    expect(within(me).getByText('6_210_400_000')).toBeTruthy();
    expect(within(me).getByText('after tx 3')).toBeTruthy();
    const raw = within(section).getByRole('article', { name: /Raydium SOL\/USDC pool/ });
    expect(within(raw).getByText('Not decoded')).toBeTruthy();
    expect(within(raw).getByText(/no IDL for owner program/)).toBeTruthy();
    expect(within(raw).getByText(/Changed in tx 2/)).toBeTruthy();
    expect(within(raw).getByText('00 2f 68 59')).toBeTruthy();
    expect(within(raw).getByText('16 bytes changed at 2 offsets')).toBeTruthy();
    const file = new File(['{"address":"x"}'], 'raydium.json', { type: 'application/json' });
    await user.click(within(raw).getByRole('button', { name: 'Add IDL' }));
    await user.upload(within(raw).getByLabelText(`IDL file for ${RAY_PROG}`), file);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith({ type: 'idls:add', programId: RAY_PROG, network: 'mainnet', json: '{"address":"x"}' }));
    expect(await within(raw).findByText(/IDL added/)).toBeTruthy();
  });

  it('relations graph: nodes in the request, outside toggle, selected-account panel', async () => {
    const { user } = setup('expert');
    const section = screen.getByRole('region', { name: 'Account relationships' });
    expect(within(section).getByRole('button', { name: /Your USDC account/ })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /BJE5…5ruG/ })).toBeNull();
    await user.click(within(section).getByRole('switch', { name: 'Show accounts outside the request' }));
    expect(within(section).getByRole('button', { name: /BJE5…5ruG/ })).toBeTruthy();
    await user.click(within(section).getByRole('button', { name: /Your USDC account/ }));
    expect(within(section).getByRole('button', { name: /Your USDC account/ }).getAttribute('aria-pressed')).toBe('true');
    const panel = within(section).getByRole('group', { name: 'Selected account' });
    expect(within(panel).getByText('Your USDC account · in the request')).toBeTruthy();
    expect(within(panel).getByText('USDC mint')).toBeTruthy();
    expect(within(panel).getByText('Outside the request')).toBeTruthy();
    expect(within(panel).getByText('program')).toBeTruthy();
  });

  it('instructions grouped per transaction with the account meta table, PDA seeds and data', async () => {
    const { user } = setup('expert');
    const section = screen.getByRole('region', { name: 'Instructions' });
    expect(within(section).getByText('Transaction 1 · Wrap 1.5 SOL')).toBeTruthy();
    expect(within(section).getByText(`Transaction 2 · ${titles[1]}`)).toBeTruthy();
    expect(within(section).getByText('Transaction 3 · Close wSOL account')).toBeTruthy();
    await user.click(within(section).getByRole('button', { name: /Jupiter v6 · route/ }));
    const table = within(section).getByRole('table', { name: /Tx 2 · Jupiter v6 · route · accounts/ });
    const rows = within(table).getAllByRole('row');
    expect(rows[0]!.textContent).toContain('Flags');
    expect(within(table).getByText('S W')).toBeTruthy();
    expect(within(table).getByText('user_destination_token_account')).toBeTruthy();
    expect(within(table).getAllByText(/ALT AL7t/)).toHaveLength(2);
    expect(within(section).getByText('b"__event_authority"')).toBeTruthy();
    expect(within(section).getByText(/Instruction data · 13 bytes/)).toBeTruthy();
  });

  it('simulation logs with per-step separators, filters and details; tabs narrow every section', async () => {
    const { user } = setup('expert');
    const logs = screen.getByRole('region', { name: 'Simulation logs' });
    expect(within(logs).getByText('Succeeded')).toBeTruthy();
    expect(within(logs).getByText('Transaction 1 · Wrap 1.5 SOL')).toBeTruthy();
    expect(within(logs).getByText('182,412 CU')).toBeTruthy();
    expect(within(logs).getByText('Program log: Instruction: Route')).toBeTruthy();
    expect(within(logs).getByText('168,213 CU')).toBeTruthy();
    await user.click(within(logs).getByRole('button', { name: 'Compute' }));
    expect(within(logs).queryByText('Program log: Instruction: Route')).toBeNull();
    const details = screen.getByRole('region', { name: 'Transaction details' });
    expect(within(details).getByText('Request details')).toBeTruthy();
    expect(within(details).getByText('3 · signed together, sent in order')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: `2 · ${titles[1]}` }));
    expect(within(details).getByText('Transaction 2 details')).toBeTruthy();
    expect(within(details).getByText(/^v0 · 1 lookup table/)).toBeTruthy();
    expect(within(details).getByText('182,412 / 200,000 CU')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'State changes' })).queryByText(/Net effect/)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Instructions' })).queryByText('Transaction 1 · Wrap 1.5 SOL')).toBeNull();
    expect(within(logs).queryByText('Transaction 1 · Wrap 1.5 SOL')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign all 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject all' })).toBeTruthy();
  });
});

describe('Danger', () => {
  it('phishing banner, DANGER and WARN cards, Sign disabled until acknowledged, Reject primary', async () => {
    explainWith((level) => batchView(level, 1, {
      summary: 'Give away control of your USDC account',
      balanceChanges: [],
      fee: '0.000005 SOL',
      warnings: [
        { rule: 'owner-change', severity: 'danger', message: 'SetAuthority makes 5Qz8…uN4d the owner of your USDC account.' },
        { rule: 'unknown-program', severity: 'warn', message: 'Unknown program 9Wfh…Kz2r · no IDL found' },
      ],
    }));
    const { onDecide, user } = setup('basic', { origin: 'https://airdrop-claim.example', transactions: [wires[0]], phishing: { reason: 'blocklist', match: 'airdrop-claim.example' } });
    expect(screen.getByText('This site is on a phishing list')).toBeTruthy();
    // One compact table: dangers first (tinted, titled), then warnings.
    const danger = screen.getByRole('region', { name: 'Danger and warnings' });
    expect(within(danger).getByText('DANGER')).toBeTruthy();
    expect(within(danger).getByText('Owner change.')).toBeTruthy();
    expect(danger.textContent).toContain('SetAuthority makes 5Qz8…uN4d the owner of your USDC account.');
    expect(within(danger).getByText('WARN')).toBeTruthy();
    const rows = within(danger).getAllByRole('row');
    expect(rows[0]!.textContent).toMatch(/^DANGER/);
    expect(rows.at(-1)!.textContent).toMatch(/^WARN/);
    expect(screen.getByText(/none now · fee 0.000005 SOL/)).toBeTruthy();
    const sign = screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    const reject = screen.getByRole('button', { name: 'Reject' });
    expect(reject.compareDocumentPosition(sign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reject.getAttribute('data-variant') ?? reject.className).toMatch(/primary/);
    await user.click(screen.getByRole('checkbox', { name: 'I understand I may lose these funds' }));
    expect(sign.disabled).toBe(false);
    await user.click(reject);
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ approved: false, log: expect.objectContaining({ dangerRules: ['phishing', 'owner-change'] }) }));
  });

  it('an explanation failure fails closed', async () => {
    hooks.useExplainBatch.mockImplementation(() => ({ status: 'failed', error: 'rpc down' }));
    setup('intermediate', { transactions: [wires[0]] });
    expect(screen.getByText('DANGER')).toBeTruthy();
    expect(screen.getByText(/rpc down/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement).disabled).toBe(true);
  });

  for (const level of ['basic', 'intermediate', 'expert'] as const) {
    it(`${level}: steps without a view or not simulated are danger even with no engine warning`, async () => {
      explainWith((l) => {
        const v = batchView(l);
        v.steps[1] = { ...v.steps[1]!, status: 'failed', view: null as any };
        v.steps[2] = { ...v.steps[2]!, status: 'not-simulated' };
        return v;
      });
      const { onDecide, user } = setup(level);
      const danger = screen.getAllByRole('region', { name: /^Danger/ })[0]!;
      expect(within(danger).getByText(/Clef could not explain transaction 2/)).toBeTruthy();
      expect(within(danger).getByText(/Clef could not explain transaction 3/)).toBeTruthy();
      const sign = screen.getByRole('button', { name: 'Sign all 3 anyway' }) as HTMLButtonElement;
      expect(sign.disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Reject all' }).className).toMatch(/bg-primary/);
      await user.click(screen.getByRole('checkbox', { name: 'I understand I may lose these funds' }));
      expect(sign.disabled).toBe(false);
      await user.click(sign);
      expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ approved: true, log: expect.objectContaining({ dangerRules: ['unexplained-step'] }) }));
    });
  }

  it('a new danger after re-explaining needs a new acknowledgement', async () => {
    const dangerA = { rule: 'owner-change', severity: 'danger', message: 'Makes 5Qz8…uN4d the owner of your USDC account.' };
    const dangerB = { rule: 'sweep', severity: 'danger', message: 'Sends everything in your wallet to 5Qz8…uN4d.' };
    explainWith((level) => batchView(level, 1, { warnings: [dangerA] }));
    const user = userEvent.setup();
    const props = { request: makeRequest({ transactions: [wires[0]] }), state: makeState('basic'), onDecide: vi.fn() };
    const { rerender } = render(<TxApproval {...props} />);
    await user.click(screen.getByRole('checkbox', { name: 'I understand I may lose these funds' }));
    expect((screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement).disabled).toBe(false);
    explainWith((level) => batchView(level, 1, { warnings: [dangerA, dangerB] }));
    rerender(<TxApproval {...props} />);
    expect((screen.getByRole('checkbox', { name: 'I understand I may lose these funds' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement).disabled).toBe(true);
    // The same dangers again (e.g. Re-simulate with nothing new) keep the tick.
    await user.click(screen.getByRole('checkbox', { name: 'I understand I may lose these funds' }));
    rerender(<TxApproval {...props} />);
    expect((screen.getByRole('button', { name: 'Sign anyway' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add IDL on a warning: hidden at Basic, asks for confirmation before the file picker elsewhere', async () => {
    const unknown = { rule: 'unknown-program', severity: 'warn', message: "Can't decode instruction #1 (program 675k…Mp8).", programId: RAY_PROG };
    // One transaction: the step carries the warning, the combined view repeats it.
    explainWith((level) => {
      const v = batchView(level, 1, { warnings: [unknown] });
      (v.steps[0]!.view as any).warnings = [unknown];
      return v;
    });
    setup('basic', { transactions: [wires[0]] });
    expect(screen.getByText(/Can't decode instruction #1/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add IDL' })).toBeNull();
    cleanup();

    const { user } = setup('intermediate', { transactions: [wires[0]] });
    const picker = screen.getByLabelText('IDL file') as HTMLInputElement;
    const click = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: 'Add IDL' }));
    const ask = screen.getByRole('alertdialog', { name: 'Add an IDL' });
    expect(ask.textContent).toMatch(/never one the site asking you to sign gave you/);
    expect(click).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add IDL' }));
    await user.click(screen.getByRole('button', { name: 'Choose IDL file' }));
    expect(click).toHaveBeenCalledTimes(1);
    await user.upload(picker, new File(['{"address":"x"}'], 'ray.json', { type: 'application/json' }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith({ type: 'idls:add', programId: RAY_PROG, network: 'mainnet', json: '{"address":"x"}' }));
  });

  it('nothing can be signed while the explanation loads', () => {
    hooks.useExplainBatch.mockImplementation(() => ({ status: 'loading' }));
    setup('basic');
    expect((screen.getByRole('button', { name: 'Sign all 3' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Batch simulation and hardware', () => {
  it('incomplete batch: notice names the dependent steps and nudges toward an RPC with simulateBundle', () => {
    explainWith((level) => ({ ...batchView(level, 3, { incomplete: true }), mode: 'independent', dependentSteps: [1, 2] }));
    setup('basic');
    const notice = screen.getByRole('note', { name: 'Incomplete simulation' });
    expect(within(notice).getByText(/transactions 2 and 3/)).toBeTruthy();
    expect(within(notice).getByText(/simulateBundle/)).toBeTruthy();
  });

  it('the incomplete notice is only for transactions simulated alone, and only for more than one', () => {
    explainWith((level) => batchView(level, 3, { incomplete: true }));
    setup('basic');
    expect(screen.queryByRole('note', { name: 'Incomplete simulation' })).toBeNull();
    cleanup();
    explainWith((level) => ({ ...batchView(level, 1, { incomplete: true }), mode: 'independent' }));
    setup('basic');
    expect(screen.queryByRole('note', { name: 'Incomplete simulation' })).toBeNull();
  });

  it("a failed simulation's reason from the RPC is under Why? on the danger", async () => {
    const reason = 'Your RPC answered: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.';
    explainWith((level) => {
      const v = batchView(level, 1);
      const view = v.steps[0]!.view as { warnings: unknown[] };
      v.steps[0] = { ...v.steps[0]!, status: 'failed', view: { ...view, warnings: [{ rule: 'simulation-failed', severity: 'warn', message: 'Simulation failed or unavailable: balance changes are unknown.', details: [reason] }] } as any };
      return v;
    });
    const { user } = setup('basic');
    const danger = screen.getAllByRole('region', { name: /^Danger/ })[0]!;
    expect(within(danger).getByText(/Clef could not explain transaction 1/)).toBeTruthy();
    await user.click(within(danger).getAllByText('Why?')[0]!);
    expect(within(danger).getAllByText(reason).length).toBeGreaterThan(0);
  });

  it('hardware signer: calls onSign with the wires and forwards the signatures', async () => {
    const sigs = [new Uint8Array(64).fill(1), new Uint8Array(64).fill(2), new Uint8Array(64).fill(3)];
    const onSign = vi.fn(async () => sigs);
    const { onDecide, user, request } = setup('basic', { signer: { kind: 'ledger', address: ME, path: "44'/501'/0'/0'" } }, onSign);
    await user.click(screen.getByRole('button', { name: 'Sign all 3' }));
    expect(onSign).toHaveBeenCalledWith(request.transactions);
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ approved: true, signatures: sigs })));
  });

  it('hardware signer: a cancelled device step keeps the window open with the error', async () => {
    const onSign = vi.fn(async () => {
      throw new Error('Rejected on the device');
    });
    const { onDecide, user } = setup('basic', { signer: { kind: 'ledger', address: ME, path: "44'/501'/0'/0'" } }, onSign);
    await user.click(screen.getByRole('button', { name: 'Sign all 3' }));
    expect(await screen.findByText('Rejected on the device')).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
  });
});
