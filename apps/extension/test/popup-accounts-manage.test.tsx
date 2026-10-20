import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAIN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TRADING = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const IMPORTED = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const LEDGER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const KEYSTONE = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const VAULT = 'So11111111111111111111111111111111111111112';
const MS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const WATCH = 'Stake11111111111111111111111111111111111111';
const OTHER1 = 'Vote111111111111111111111111111111111111111';
const OTHER2 = 'Config1111111111111111111111111111111111111';

const h = vi.hoisted(() => ({
  call: vi.fn(),
  nav: { route: { name: 'accounts' } as Record<string, string>, go: vi.fn(), back: vi.fn(), replace: vi.fn(), reset: vi.fn() },
  state: null as unknown,
  refresh: vi.fn(),
  getBalance: vi.fn(),
  getLatestBlockhash: vi.fn(),
  loadPortfolio: vi.fn(),
  fetchMultisig: vi.fn(),
  listProposals: vi.fn(),
  buildVoteTransaction: vi.fn(),
  buildExecuteTransaction: vi.fn(),
  vaultPda: vi.fn(),
  tabsCreate: vi.fn(),
  chain: { tag: 'chain' },
  clients: null as unknown,
}));
h.clients = { chain: h.chain, portfolio: { getBalance: h.getBalance, getLatestBlockhash: h.getLatestBlockhash }, jupiter: { tag: 'jup' } };

vi.mock('../lib/api', () => ({ call: h.call }));
const flags = vi.hoisted(() => ({ HARDWARE_ENABLED: true }));
vi.mock('../lib/features', () => flags);
vi.mock('../lib/nav', () => ({ useNav: () => h.nav }));
vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ state: h.state, error: null, refresh: h.refresh }),
  useClients: () => h.clients,
}));
vi.mock('@clef/portfolio', () => ({ loadPortfolio: h.loadPortfolio }));
vi.mock('@clef/squads', () => ({
  fetchMultisig: h.fetchMultisig,
  listProposals: h.listProposals,
  buildVoteTransaction: h.buildVoteTransaction,
  buildExecuteTransaction: h.buildExecuteTransaction,
  vaultPda: h.vaultPda,
}));
vi.mock('wxt/browser', () => ({
  browser: { tabs: { create: h.tabsCreate }, runtime: { getURL: (p: string) => `chrome-extension://id${p}` } },
}));

import { AccountsScreen } from '../entrypoints/popup/screens/Accounts';
import { AddAccountScreen } from '../entrypoints/popup/screens/AddAccount';
import { ProposalsScreen } from '../entrypoints/popup/screens/Proposals';
import { SquadsAddScreen } from '../entrypoints/popup/screens/SquadsAdd';

const USD: Record<string, number | null> = { [MAIN]: 1284.52, [TRADING]: 56.64, [IMPORTED]: null, [LEDGER]: 410, [KEYSTONE]: 0, [VAULT]: 1154.94, [WATCH]: 9820 };
const member = (key: string, vote = true) => ({ key, initiate: true, vote, execute: true });
const MULTISIG = { address: MS, threshold: 2, members: [member(LEDGER), member(OTHER1), member(OTHER2)], transactionIndex: 15n, staleTransactionIndex: 0n, timeLock: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  h.nav.route = { name: 'accounts' };
  h.state = {
    hasVault: true,
    unlocked: true,
    activeAccount: MAIN,
    errorReportsAvailable: false,
    permissions: [],
    settings: { network: 'mainnet', rpcUrl: 'http://rpc.test', hideSpam: true, jupiterApiKey: null },
    accounts: [
      { kind: 'hd', address: MAIN, label: 'Main', index: 0 },
      { kind: 'hd', address: TRADING, label: 'Trading', index: 1 },
      { kind: 'imported', address: IMPORTED, label: 'Imported 1' },
      { kind: 'ledger', address: LEDGER, label: 'Ledger 1', path: "44'/501'/0'" },
      { kind: 'keystone', address: KEYSTONE, label: 'Cold vault', path: "m/44'/501'/0'", xfp: 'f23a9fd2' },
      { kind: 'squads', address: VAULT, label: 'Treasury', multisig: MS, vaultIndex: 0, member: LEDGER },
      { kind: 'watch', address: WATCH, label: 'Grant wallet' },
    ],
  };
  h.loadPortfolio.mockImplementation(async (_deps: unknown, owner: string) => ({ owner, totalUsd: USD[owner] ?? null, holdings: [] }));
  h.fetchMultisig.mockResolvedValue(MULTISIG);
  h.vaultPda.mockResolvedValue(VAULT);
  h.getBalance.mockResolvedValue(5_000_000_000n);
  h.getLatestBlockhash.mockResolvedValue({ blockhash: 'BH', lastValidBlockHeight: 10n });
  h.call.mockResolvedValue({});
});
afterEach(cleanup);

describe('Accounts', () => {
  it('groups accounts by kind with a total that excludes watch-only, and switches on click', async () => {
    const user = userEvent.setup();
    render(<AccountsScreen />);
    for (const g of ['Recovery phrase', 'Imported', 'Hardware', 'Multisig', 'Watch-only']) expect(screen.getByRole('heading', { name: g })).toBeTruthy();
    expect(await screen.findByText('Total $2,906.10')).toBeTruthy();
    expect(h.loadPortfolio).toHaveBeenCalledWith(expect.objectContaining({ chain: h.chain }), MAIN, { hideSpam: true });

    const main = screen.getByRole('button', { name: /^Main/ });
    expect(main.getAttribute('aria-current')).toBe('true');
    expect(within(main).getByText('✓ selected')).toBeTruthy();
    expect(within(main).getByText('$1,284.52')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Trading/ }).textContent).toContain('#1');
    expect(screen.getByRole('button', { name: /^Ledger 1/ }).textContent).toContain('Ledger');
    expect(screen.getByRole('button', { name: /^Cold vault/ }).textContent).toContain('Keystone');
    expect(screen.getByRole('button', { name: /^Grant wallet/ }).textContent).toContain('view only');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Treasury/ }).textContent).toContain('2 of 3 · via Ledger 1'));
    expect(screen.getByRole('button', { name: /^Imported 1/ }).textContent).toContain('—');

    await user.click(screen.getByRole('button', { name: /^Trading/ }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:select', address: TRADING }));
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });

    await user.click(screen.getByRole('button', { name: 'Proposals for Treasury' }));
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'proposals', multisig: MS });
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'accounts/add' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.nav.back).toHaveBeenCalled();
  });

  it('renames and removes an account from its options, saying what removing costs', async () => {
    const user = userEvent.setup();
    render(<AccountsScreen />);
    await user.click(screen.getByRole('button', { name: 'Options for Trading' }));
    const options = screen.getByRole('group', { name: 'Options for Trading' });
    expect(within(options).getByRole('button', { name: 'Copy address' })).toBeTruthy();
    const name = within(options).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Daily');
    await user.click(within(options).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:rename', address: TRADING, label: 'Daily' }));

    await user.click(screen.getByRole('button', { name: 'Options for Imported 1' }));
    const imported = screen.getByRole('group', { name: 'Options for Imported 1' });
    await user.click(within(imported).getByRole('button', { name: 'Remove account…' }));
    expect(within(imported).getByRole('alert').textContent).toMatch(/private key is deleted from Clef/);
    expect(h.call).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'accounts:remove' }));
    await user.click(within(imported).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'accounts:remove' })));
  });
});

describe('AddAccount', () => {
  it('routes every option', async () => {
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    await user.click(screen.getByRole('button', { name: /New account/ }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive' }));
    expect(h.nav.back).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Import/ }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'import' });
    await user.click(screen.getByRole('button', { name: /Ledger/ }));
    expect(h.tabsCreate).toHaveBeenLastCalledWith({ url: 'chrome-extension://id/hardware.html?kind=ledger' });
    await user.click(screen.getByRole('button', { name: /Keystone/ }));
    expect(h.tabsCreate).toHaveBeenLastCalledWith({ url: 'chrome-extension://id/hardware.html?kind=keystone' });
    await user.click(screen.getByRole('button', { name: /Squads multisig/ }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'accounts/squads' });
    await user.click(screen.getByRole('button', { name: /Watch an address/ }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'import', tab: 'watch' });
  });

  it('hides Ledger and Keystone while hardware is disabled', () => {
    flags.HARDWARE_ENABLED = false;
    try {
      render(<AddAccountScreen />);
      expect(screen.queryByRole('button', { name: /Ledger|Keystone/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Squads multisig/ })).toBeTruthy();
    } finally {
      flags.HARDWARE_ENABLED = true;
    }
  });

  it('shows why a new account could not be derived', async () => {
    const user = userEvent.setup();
    h.call.mockRejectedValueOnce(new Error('No recovery phrase in this wallet'));
    render(<AddAccountScreen />);
    await user.click(screen.getByRole('button', { name: /New account/ }));
    expect(await screen.findByText('No recovery phrase in this wallet')).toBeTruthy();
    expect(h.nav.back).not.toHaveBeenCalled();
  });
});

describe('no recovery phrase (started from a private key or watch-only)', () => {
  it('New account first creates a phrase, shown and checked', async () => {
    (h.state as { phrases?: number }).phrases = 0;
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    const news = screen.getAllByRole('button', { name: /New account/ });
    expect(news).toHaveLength(1);
    expect(news[0]!.textContent).toContain('Create a recovery phrase for new accounts');
    await user.click(news[0]!);
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'accounts/new-phrase' });
    expect(h.call).not.toHaveBeenCalled();
  });
});

describe('several recovery phrases', () => {
  const ZOO0 = 'Sysvar1111111111111111111111111111111111111';
  beforeEach(() => {
    const st = h.state as { phrases?: number; accounts: { kind: string; phrase?: number }[] };
    st.phrases = 2;
    st.accounts = st.accounts.map((a) => (a.kind === 'hd' ? { ...a, phrase: 1 } : a));
    st.accounts.splice(2, 0, { kind: 'hd', address: ZOO0, label: 'Savings', index: 0, phrase: 2 } as never);
  });

  it('Accounts groups HD accounts by phrase', () => {
    render(<AccountsScreen />);
    const one = screen.getByRole('heading', { name: 'Recovery phrase 1' }).closest('section')!;
    const two = screen.getByRole('heading', { name: 'Recovery phrase 2' }).closest('section')!;
    expect(within(one).getAllByRole('button').filter((b) => !b.getAttribute('aria-label')).map((b) => b.textContent)).toEqual([expect.stringContaining('Main'), expect.stringContaining('Trading')]);
    expect(within(two).getByRole('button', { name: /^Savings/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recovery phrase' })).toBeNull();
  });

  it('AddAccount offers a new account per phrase', async () => {
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    const news = screen.getAllByRole('button', { name: /New account/ });
    expect(news.map((b) => b.textContent)).toEqual([expect.stringContaining('Recovery phrase 1'), expect.stringContaining('Recovery phrase 2')]);
    await user.click(news[1]!);
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive', phrase: 2 }));
    expect(h.nav.back).toHaveBeenCalled();
    expect(screen.queryByRole('radiogroup', { name: 'Derivation path' })).toBeNull();
  });

  it('asks for the path when the phrase has legacy accounts, defaulting to the most recent one', async () => {
    const st = h.state as { accounts: unknown[] };
    st.accounts.push({ kind: 'hd', address: OTHER1, label: 'Old', index: 0, phrase: 2, scheme: 'legacy' });
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    await user.click(screen.getAllByRole('button', { name: /New account/ })[1]!);
    const path = screen.getByRole('radiogroup', { name: 'Derivation path' });
    expect(within(path).getByRole('radio', { name: /Legacy \(older wallets\)/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(path).getByRole('radio', { name: /Standard \(Phantom, Solflare\)/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText("m/44'/501'/n'")).toBeTruthy();
    expect(h.call).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'accounts:derive' }));

    await user.click(within(path).getByRole('radio', { name: /Standard/ }));
    expect(screen.getByText("m/44'/501'/n'/0'")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add account on this path' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive', phrase: 2, scheme: 'standard' }));
    expect(h.nav.back).toHaveBeenCalled();
  });

  it('defaults to Standard when the most recent account of the phrase is standard, even with older legacy ones', async () => {
    const st = h.state as { accounts: unknown[] };
    st.accounts.push(
      { kind: 'hd', address: OTHER1, label: 'Old', index: 0, phrase: 2, scheme: 'legacy' },
      { kind: 'hd', address: OTHER2, label: 'Newer', index: 1, phrase: 2 },
    );
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    await user.click(screen.getAllByRole('button', { name: /New account/ })[1]!);
    const path = screen.getByRole('radiogroup', { name: 'Derivation path' });
    expect(within(path).getByRole('radio', { name: /Standard \(Phantom, Solflare\)/ }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Add account on this path' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive', phrase: 2, scheme: 'standard' }));
  });

  it('phrase 1 with only standard accounts adds directly even when another phrase has legacy ones', async () => {
    const st = h.state as { accounts: unknown[] };
    st.accounts.push({ kind: 'hd', address: OTHER1, label: 'Old', index: 0, phrase: 2, scheme: 'legacy' });
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    await user.click(screen.getAllByRole('button', { name: /New account/ })[0]!);
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive', phrase: 1 }));
    expect(screen.queryByRole('radiogroup', { name: 'Derivation path' })).toBeNull();
  });
});

describe('one recovery phrase with legacy accounts', () => {
  it('asks for the path and sends the chosen one', async () => {
    const st = h.state as { phrases?: number; accounts: { kind: string }[] };
    st.phrases = 1;
    st.accounts = st.accounts.map((a) => (a.kind === 'hd' ? { ...a, phrase: 1, scheme: 'legacy' } : a));
    const user = userEvent.setup();
    render(<AddAccountScreen />);
    await user.click(screen.getByRole('button', { name: /New account/ }));
    await user.click(screen.getByRole('button', { name: 'Add account on this path' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:derive', scheme: 'legacy' }));
  });
});

describe('SquadsAdd', () => {
  it('rejects addresses that are not a multisig', async () => {
    const user = userEvent.setup();
    h.fetchMultisig.mockResolvedValue(null);
    render(<SquadsAddScreen />);
    await user.type(screen.getByLabelText('Multisig address'), 'nope');
    expect(screen.getByText('Not a Solana address')).toBeTruthy();
    await user.clear(screen.getByLabelText('Multisig address'));
    await user.type(screen.getByLabelText('Multisig address'), OTHER1);
    expect(await screen.findByText('Not a Squads v4 multisig')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add multisig' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('detects the multisig, offers only member accounts and adds it', async () => {
    const user = userEvent.setup();
    render(<SquadsAddScreen />);
    await user.type(screen.getByLabelText('Multisig address'), MS);
    expect(await screen.findByText('✓ verified program account')).toBeTruthy();
    expect(h.fetchMultisig).toHaveBeenCalledWith(h.chain, MS);
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(await screen.findByText('5.00 SOL')).toBeTruthy();
    expect(h.vaultPda).toHaveBeenCalledWith(MS, 0);

    const radios = within(screen.getByRole('group', { name: 'Vote with' })).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(5);
    const ledger = screen.getByRole('radio', { name: /Ledger 1/ }) as HTMLInputElement;
    expect(ledger.disabled).toBe(false);
    expect(ledger.checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Main/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText('not a member')).toHaveLength(4);
    expect(screen.queryByRole('radio', { name: /^Grant wallet/ })).toBeNull();

    await user.type(screen.getByLabelText('Name'), 'Treasury');
    await user.click(screen.getByRole('button', { name: 'Add multisig' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:addSquads', multisig: MS, vaultIndex: 0, member: LEDGER, label: 'Treasury' }));
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'accounts' });
  });

  it('says so when none of the accounts can vote', async () => {
    const user = userEvent.setup();
    h.fetchMultisig.mockResolvedValue({ ...MULTISIG, members: [member(OTHER1), member(OTHER2), member(LEDGER, false)] });
    render(<SquadsAddScreen />);
    await user.type(screen.getByLabelText('Multisig address'), MS);
    expect(await screen.findByText('None of your accounts can vote in this multisig')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add multisig' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Proposals', () => {
  const proposal = (index: bigint, status: string, approved: string[] = []) => ({ index, status, approved, rejected: [], cancelled: [], transaction: OTHER2, innerMessage: null });

  beforeEach(() => {
    h.nav.route = { name: 'proposals', multisig: MS };
    h.listProposals.mockResolvedValue([
      proposal(15n, 'active'),
      proposal(14n, 'active', [LEDGER]),
      proposal(13n, 'approved', [LEDGER, OTHER1]),
      proposal(12n, 'executed', [LEDGER, OTHER1]),
    ]);
    h.buildVoteTransaction.mockResolvedValue(new Uint8Array([1, 2, 3]));
    h.buildExecuteTransaction.mockResolvedValue(new Uint8Array([4, 5, 6]));
  });

  it('lists active and executed proposals', async () => {
    const user = userEvent.setup();
    render(<ProposalsScreen />);
    expect(screen.getByRole('heading', { name: 'Treasury' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Active · 3' })).toBeTruthy();
    expect(screen.getByText('Squads 2 of 3')).toBeTruthy();
    expect(h.listProposals).toHaveBeenCalledWith(h.chain, MS, { limit: 20 });
    expect(screen.getByText('0 of 2 · needs your vote')).toBeTruthy();
    expect(screen.getByText(/1 of 2 · you approved/)).toBeTruthy();
    expect(screen.getByText('2 of 2 · ready')).toBeTruthy();
    expect(screen.queryByText('#12')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Executed' }));
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.queryByText('#15')).toBeNull();
  });

  it('votes and executes through wallet:submit', async () => {
    const user = userEvent.setup();
    render(<ProposalsScreen />);
    const p15 = (await screen.findByText('#15')).closest('article')!;
    await user.click(within(p15).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(h.buildVoteTransaction).toHaveBeenCalledWith({ multisig: MS, member: LEDGER, transactionIndex: 15n, vote: 'reject', blockhash: 'BH' }),
    );
    expect(h.call).toHaveBeenCalledWith({ type: 'wallet:submit', account: LEDGER, transactions: ['AQID'], send: true, purpose: 'squads-vote' });
    await waitFor(() => expect(h.listProposals).toHaveBeenCalledTimes(2));

    await user.click(within(screen.getByText('#15').closest('article')!).getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(h.buildVoteTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ transactionIndex: 15n, vote: 'approve' })));

    await user.click(within(screen.getByText('#13').closest('article')!).getByRole('button', { name: 'Execute' }));
    await waitFor(() =>
      expect(h.buildExecuteTransaction).toHaveBeenCalledWith(h.chain, { multisig: MS, member: LEDGER, transactionIndex: 13n, blockhash: 'BH' }),
    );
    expect(h.call).toHaveBeenCalledWith({ type: 'wallet:submit', account: LEDGER, transactions: ['BAUG'], send: true, purpose: 'squads-execute' });
  });

  it('shows a rejection from the approval window', async () => {
    const user = userEvent.setup();
    h.call.mockRejectedValueOnce(new Error('User rejected the request'));
    render(<ProposalsScreen />);
    const p15 = (await screen.findByText('#15')).closest('article')!;
    await user.click(within(p15).getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('User rejected the request')).toBeTruthy();
  });
});
