// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Holding, HistoryItem, Portfolio } from '@clef/portfolio';
import type { RequestLogEntry } from '@clef/wallet-core';

const m = vi.hoisted(() => ({
  state: null as any,
  portfolio: null as any,
  history: { items: [] as any[], loading: false, error: null as string | null, loadMore: () => {}, retry: () => {}, hasMore: false },
  health: { slot: null as bigint | null, latencyMs: null as number | null },
  calls: {} as Record<string, unknown>,
  route: { name: 'home' } as any,
  go: null as any,
  back: null as any,
  reset: null as any,
  call: null as any,
  refresh: null as any,
  jupiter: null as any,
  classifyRecipient: null as any,
  buildSendTransaction: null as any,
  hasTokenAccount: null as any,
  portfolioError: null as string | null,
  confirm: null as any,
}));

vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ state: m.state, error: null, refresh: async () => {} }),
  useActiveAccount: () => m.state?.accounts.find((a: any) => a.address === m.state.activeAccount) ?? null,
  useCall: (type: string) => ({ data: (m.calls[type] ?? null) as any, error: null, loading: false, reload: () => {} }),
  usePortfolio: () => ({ data: m.portfolio, loading: false, error: m.portfolioError ?? null, refresh: m.refresh }),
  useHistory: () => m.history,
  useHealth: () => m.health,
}));
vi.mock('../lib/api', () => ({ call: (c: unknown) => m.call(c) }));

vi.mock('../lib/nav', () => ({
  useNav: () => ({ route: m.route, go: m.go, back: m.back, replace: vi.fn(), reset: m.reset }),
}));
vi.mock('../lib/clients', () => ({
  createClients: () => ({ chain: { tag: 'chain' }, portfolio: { tag: 'reader', confirm: m.confirm, getLatestBlockhash: async () => ({ lastValidBlockHeight: 99n }) }, jupiter: m.jupiter }),
}));
vi.mock('@clef/portfolio', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  classifyRecipient: (...a: unknown[]) => m.classifyRecipient(...a),
  buildSendTransaction: (...a: unknown[]) => m.buildSendTransaction(...a),
  hasTokenAccount: (...a: unknown[]) => m.hasTokenAccount(...a),
}));

import { PortfolioScreen } from '../entrypoints/popup/screens/Portfolio';
import { TokenDetailScreen, associatedTokenAddress } from '../entrypoints/popup/screens/TokenDetail';
import { SendScreen, parseAmount } from '../entrypoints/popup/screens/Send';
import { ReceiveScreen } from '../entrypoints/popup/screens/Receive';
import { SwapScreen, REFRESH_SECONDS, USDC, WSOL } from '../entrypoints/popup/screens/Swap';

/** Matches an element whose whole text is `t` (keys are their own copy buttons, so text spans elements). */
const fullText = (t: string) => (_: string, el: Element | null) => el?.textContent === t && ![...(el?.children ?? [])].some((c) => c.textContent === t);
import { HistoryScreen } from '../entrypoints/popup/screens/History';

const ME = '7xKpWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7R3fQa';
const LEDGER = 'Ct4mVq1nZr8sYw3kXe6hJp2dLb9gTf5cMa7uNo4iQ8xe';
const ALICE = '9vRtWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7Rk2Lm';
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const USDC_ATA = 'BtLeWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7R9mHv';

const settings = (p: Record<string, unknown> = {}) => ({
  network: 'mainnet',
  rpcUrl: 'https://rpc.example/key',
  customCluster: 'mainnet',
  autoLockMinutes: 15,
  detailLevel: 'intermediate',
  hideSpam: true,
  networkSwitchInHeader: true,
  devnetTint: true,
  jupiterApiKey: null,
  errorReports: false,
  ...p,
});

const holding = (p: Partial<Holding>): Holding => ({
  mint: 'SOL',
  symbol: 'SOL',
  name: 'Solana',
  decimals: 9,
  amount: 6_210_400_000n,
  uiAmount: '6.2104',
  usdPrice: 141.6,
  usdValue: 879.39,
  change24h: 2.1,
  program: 'native',
  verified: true,
  spam: false,
  ...p,
});

const SOL = holding({});
const USDC_H = holding({
  mint: USDC,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  amount: 312_400_000n,
  uiAmount: '312.40',
  usdPrice: 1,
  usdValue: 312.4,
  change24h: 0,
  program: 'token',
  tokenAccount: USDC_ATA as any,
  mintAuthority: 'BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG',
  freezeAuthority: '7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar',
  delegate: null,
});
const JUP = holding({ mint: JUP_MINT, symbol: 'JUP', name: 'Jupiter', decimals: 6, amount: 140_000_000n, uiAmount: '140.00', usdValue: 92.73, change24h: -0.8, program: 'token-2022', tokenAccount: 'H3pdWm2QdL9vHc4TrB8nYeX5uJ3kPs6AGf1zNq7Ra8Ve' as any });
const SPAM = holding({ mint: 'Spam1111111111111111111111111111111111111111', symbol: 'FREE', name: 'Free money', decimals: 6, amount: 1n, uiAmount: '0.000001', usdValue: null, change24h: null, program: 'token', spam: true, verified: false });

const portfolio = (p: Partial<Portfolio> = {}): Portfolio => ({
  owner: ME as any,
  totalUsd: 1284.52,
  change24hUsd: 18.2,
  holdings: [SOL, USDC_H, JUP],
  hiddenSpam: 4,
  source: 'rpc',
  ...p,
});

beforeEach(() => {
  m.state = {
    hasVault: true,
    unlocked: true,
    accounts: [
      { kind: 'hd', address: ME, label: 'Main', index: 0 },
      { kind: 'ledger', address: LEDGER, label: 'Ledger 1', path: "44'/501'/0'" },
      { kind: 'watch', address: 'Watch111111111111111111111111111111111111111', label: 'Whale' },
    ],
    settings: settings(),
    permissions: [{ origin: 'https://jup.ag', accounts: [ME] }],
    activeAccount: ME,
    errorReportsAvailable: false,
  };
  m.portfolio = portfolio();
  m.portfolioError = null;
  m.history = { items: [], loading: false, error: null, loadMore: vi.fn(), retry: vi.fn(), hasMore: false };
  m.health = { slot: 287_412_903n, latencyMs: 84 };
  m.calls = {};
  m.route = { name: 'home' };
  m.go = vi.fn();
  m.back = vi.fn();
  m.reset = vi.fn();
  m.refresh = vi.fn();
  m.call = vi.fn(async () => ({}));
  m.jupiter = null;
  m.classifyRecipient = vi.fn(async () => 'wallet');
  m.buildSendTransaction = vi.fn(async () => ({ wire: new Uint8Array([1, 2, 3]), createsAta: false, lastValidBlockHeight: 10n }));
  m.hasTokenAccount = vi.fn(async () => true);
  m.confirm = vi.fn(async () => 'confirmed');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Portfolio', () => {
  it('a watch-only account gets Send and Swap disabled, with the reason and a way to switch', () => {
    m.state.activeAccount = 'Watch111111111111111111111111111111111111111';
    render(<PortfolioScreen />);
    const actions = screen.getByRole('navigation', { name: 'Wallet actions' });
    for (const name of ['Send', 'Swap']) {
      const b = within(actions).getByRole('button', { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent).toMatch(/^View-only account — switch to one you can sign with\./);
    }
    expect((within(actions).getByRole('button', { name: 'Receive' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(document.getElementById('view-only-hint')!).getByRole('button', { name: 'Switch account' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'accounts' });
  });

  it('Send and Swap reached on a watch-only account say so instead of showing a form', () => {
    m.state.activeAccount = 'Watch111111111111111111111111111111111111111';
    m.route = { name: 'send' };
    render(<SendScreen />);
    expect(screen.getByText('This account is view-only')).toBeTruthy();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    cleanup();
    m.route = { name: 'swap' };
    render(<SwapScreen />);
    expect(screen.getByText('This account is view-only')).toBeTruthy();
  });

  it('a balance the RPC did not return names the RPC, offers Try again and Change RPC, and keeps the raw error behind Details', () => {
    m.portfolioError = 'HTTP error (403): Forbidden';
    render(<PortfolioScreen />);
    expect(screen.getByText(/^Couldn't reach /)).toBeTruthy();
    expect(screen.getByText(/Your funds are safe/)).toBeTruthy();
    expect(screen.getByText('HTTP error (403): Forbidden')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(m.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change RPC' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'settings/network' });
  });

  it('shows total, change, network, holdings and the spam row', async () => {
    render(<PortfolioScreen />);
    expect(screen.getByText('$1,284.52')).toBeTruthy();
    expect(screen.getByText(/\+\$18\.20 · 1\.4% today/)).toBeTruthy();
    expect(screen.getByText('Mainnet')).toBeTruthy();
    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.getByText('7xKp…3fQa')).toBeTruthy();
    expect(screen.getByText('Solana')).toBeTruthy();
    expect(screen.getByText('6.2104 SOL')).toBeTruthy();
    expect(screen.getByText('$879.39')).toBeTruthy();
    expect(screen.getByText('+2.1%')).toBeTruthy();
    expect(screen.getByText('−0.8%')).toBeTruthy();
    expect(screen.getByText('4 spam tokens hidden')).toBeTruthy();

    fireEvent.click(screen.getByText('Show'));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { hideSpam: false } }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it.each(['intermediate', 'expert'] as const)('at %s, says when Jupiter rejected the API key and links to Settings', (detailLevel) => {
    m.state.settings = settings({ detailLevel });
    m.portfolio = portfolio({ totalUsd: null, change24hUsd: null, priceError: 'invalid-key' });
    render(<PortfolioScreen />);
    expect(screen.getByText(/No prices: Jupiter rejected your API key/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix it in Settings' }));
    expect(m.go).toHaveBeenCalledWith({ name: 'settings', section: 'swaps' });
  });

  describe('free public mainnet RPC notice', () => {
    afterEach(() => localStorage.clear());

    it('offers to add a provider on the default mainnet RPC, and Not now hides it for good', () => {
      m.state.settings = settings({ network: 'mainnet', rpcUrl: 'https://solana-rpc.publicnode.com' });
      const { unmount } = render(<PortfolioScreen />);
      expect(screen.getByRole('note').textContent).toMatch(/free public RPC/);
      fireEvent.click(screen.getByRole('button', { name: 'Add a provider' }));
      expect(m.go).toHaveBeenCalledWith({ name: 'settings/network' });
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByRole('note')).toBeNull();
      unmount();
      render(<PortfolioScreen />);
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('stays hidden on a provider URL, but says so when tokens could not be listed', () => {
      render(<PortfolioScreen />);
      expect(screen.queryByRole('note')).toBeNull();
      cleanup();
      m.portfolio = portfolio({ tokensUnavailable: true });
      render(<PortfolioScreen />);
      expect(screen.getByRole('note').textContent).toMatch(/only SOL is shown/);
      expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    });
  });

  it('reveals spam holdings that the loader returned flagged', () => {
    m.portfolio = portfolio({ holdings: [SOL, SPAM], hiddenSpam: 0 });
    render(<PortfolioScreen />);
    expect(screen.queryByText('Free money')).toBeNull();
    expect(screen.getByText('1 spam token hidden')).toBeTruthy();
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('Free money')).toBeTruthy();
    expect(m.call).not.toHaveBeenCalled();
  });

  it('navigates from actions, token rows and the signing detail footer', () => {
    render(<PortfolioScreen />);
    const actions = screen.getByRole('navigation', { name: 'Wallet actions' });
    for (const [label, name] of [['Send', 'send'], ['Receive', 'receive'], ['Swap', 'swap'], ['History', 'history']]) {
      fireEvent.click(within(actions).getByText(label!));
      expect(m.go).toHaveBeenLastCalledWith({ name });
    }
    fireEvent.click(screen.getByText('USD Coin'));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'token', mint: USDC });
    expect(screen.getByText('Signing detail')).toBeTruthy();
    expect(screen.getByText('Intermediate')).toBeTruthy();
    fireEvent.click(screen.getByText('Signing detail'));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'settings' });
  });

  it('expert variant: Main/Dev switch, RPC strip, token accounts, footer, ⌥N', async () => {
    m.state.settings = settings({ detailLevel: 'expert' });
    m.portfolio = portfolio({ holdings: [SOL, USDC_H, JUP, SPAM], hiddenSpam: 0 });
    render(<PortfolioScreen />);

    const strip = screen.getByTestId('rpc-strip');
    expect(within(strip).getByText('https://rpc.example/key')).toBeTruthy();
    expect(within(strip).getByText('slot 287,412,903')).toBeTruthy();
    expect(within(strip).getByText('84 ms')).toBeTruthy();
    expect(screen.getByText('6.210400000 SOL · 6,210,400,000 lamports')).toBeTruthy();

    const list = screen.getByRole('list', { name: 'Token accounts' });
    expect(within(list).getByText('Token-2022')).toBeTruthy();
    expect(within(list).getByText(fullText('mint EPjF…Dt1v · ata BtLe…9mHv'))).toBeTruthy();
    expect(within(list).getByText('312400000 · 6 dp')).toBeTruthy();
    expect(within(list).queryByText(/FREE/)).toBeNull();
    expect(screen.getByText('1 spam token hidden')).toBeTruthy();

    expect(screen.getByText('Expert')).toBeTruthy();
    expect(screen.getByText('⌥N')).toBeTruthy();

    const net = screen.getByRole('radiogroup', { name: /network/i });
    fireEvent.click(within(net).getByText('Dev'));
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { network: 'devnet', rpcUrl: 'https://api.devnet.solana.com' } }),
    );

    m.call.mockClear();
    fireEvent.keyDown(window, { code: 'KeyN', altKey: true });
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { network: 'devnet', rpcUrl: 'https://api.devnet.solana.com' } }),
    );
  });

  it('expert variant hides the network switch on a custom RPC', () => {
    m.state.settings = settings({ detailLevel: 'expert', network: 'custom' });
    render(<PortfolioScreen />);
    expect(screen.queryByRole('radiogroup', { name: /network/i })).toBeNull();
  });
});

describe('TokenDetail', () => {
  it('shows amount, price, authorities and the ATA badge', async () => {
    m.route = { name: 'token', mint: USDC };
    const ata = await associatedTokenAddress(ME as any, USDC as any, 'token');
    m.portfolio = portfolio({ holdings: [SOL, { ...USDC_H, tokenAccount: ata }] });
    m.history.items = [
      { signature: 's1', slot: 1n, blockTime: Math.floor(Date.now() / 1000), status: 'success', kind: 'swap', title: 'Swap from SOL', subtitle: 'jup.ag', deltas: [{ symbol: 'USDC', amount: '211.80', direction: 'in' }], fee: '0.000005' },
    ] satisfies HistoryItem[];
    render(<TokenDetailScreen />);
    expect(screen.getByText('USD Coin')).toBeTruthy();
    expect(screen.getByText('Verified mint')).toBeTruthy();
    expect(screen.getByText(/≈ \$312\.40 · price \$1\.0000/)).toBeTruthy();
    expect(screen.getByText('Token · 6 decimals')).toBeTruthy();
    expect(screen.getByText('Set · issuer can freeze')).toBeTruthy();
    expect(screen.getByText('Set · supply can grow')).toBeTruthy();
    expect(await screen.findByText('✓ ATA')).toBeTruthy();
    expect(screen.getByText('Swap from SOL')).toBeTruthy();
    expect(screen.getByText('+211.80')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'send', mint: USDC });
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'swap', inputMint: USDC });
  });

  it('flags a non-ATA token account and shows None authorities', async () => {
    m.route = { name: 'token', mint: JUP_MINT };
    m.portfolio = portfolio({ holdings: [{ ...JUP, mintAuthority: null, freezeAuthority: null, verified: false }] });
    render(<TokenDetailScreen />);
    expect(await screen.findByText('Not the ATA')).toBeTruthy();
    expect(screen.getByText('Unverified mint')).toBeTruthy();
    expect(screen.getAllByText('None').length).toBe(3);
  });
});

describe('Send', () => {
  it('MAX sends all SOL but the fee, and the token picker switches the asset', () => {
    m.route = { name: 'send' };
    render(<SendScreen />);
    fireEvent.click(screen.getByText('MAX'));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('6.210395');
    expect(screen.getByText(/≈ \$879\.39/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Choose token' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose token' })).getByText('USDC'));
    fireEvent.click(screen.getByText('MAX'));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('312.4');
  });

  it('MAX on SOL can be sent: it empties the wallet instead of leaving less than a wallet must hold', async () => {
    m.route = { name: 'send', to: ALICE };
    render(<SendScreen />);
    fireEvent.click(screen.getByText('MAX'));
    const review = screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement;
    await waitFor(() => expect(review.disabled).toBe(false));
    expect(screen.getByText('Network fee 0.000005 SOL')).toBeTruthy();
    // What the old MAX entered: 10,000 lamports kept, 5,000 left after the fee.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '6.21039' } });
    expect(await screen.findByText(/This would leave 0\.000005 SOL, less than the 0\.00089088 SOL a wallet must keep/)).toBeTruthy();
    expect(review.disabled).toBe(true);
  });

  it('refuses SOL to a new address below what opens it', async () => {
    m.route = { name: 'send', to: ALICE };
    m.classifyRecipient = vi.fn(async () => 'new');
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.0001' } });
    expect(await screen.findByText(/This address has no account yet: it needs at least 0\.00089088 SOL to open/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.001' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a token send checks the SOL for the fee and for the recipient account it opens', async () => {
    m.route = { name: 'send', to: ALICE, mint: USDC };
    m.portfolio = { ...m.portfolio, holdings: [holding({ amount: 1_000_000n }), USDC_H] };
    m.hasTokenAccount = vi.fn(async () => false);
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    expect(await screen.findByText('Network fee 0.000005 SOL · 0.00203928 SOL deposit to open their USDC account')).toBeTruthy();
    expect(m.hasTokenAccount).toHaveBeenCalledWith({ tag: 'chain' }, ALICE, USDC, 'token');
    expect(screen.getByText(/Not enough SOL: sending USDC here costs 0\.00204428 SOL .* This account has 0\.001 SOL\./)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    // The recipient already holds USDC: only the fee, which fits.
    m.hasTokenAccount = vi.fn(async () => true);
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('Network fee 0.000005 SOL')).toBeTruthy();
  });

  it('a token send from an account with no SOL says it needs SOL for the fee', async () => {
    m.route = { name: 'send', to: ALICE, mint: USDC };
    m.portfolio = { ...m.portfolio, holdings: [holding({ amount: 0n }), USDC_H] };
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    expect(await screen.findByText('Not enough SOL for the network fee: it needs 0.000005 SOL and this account has 0 SOL.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('suggests contacts and own accounts, then submits with send:true', async () => {
    m.route = { name: 'send' };
    m.calls['contacts:list'] = [{ address: ALICE, name: 'Alice', kind: 'contact', createdAt: 1 }];
    m.call = vi.fn(async () => ({ signatures: ['5igSig111'] }));
    render(<SendScreen />);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'l' } });
    const sugg = screen.getByRole('list', { name: 'Suggestions' });
    expect(within(sugg).getByText('Alice')).toBeTruthy();
    expect(within(sugg).getByText(fullText('9vRt…k2Lm · Address book'))).toBeTruthy();
    expect(within(sugg).getByText('Ledger 1')).toBeTruthy();
    expect(within(sugg).getByText(fullText('Ct4m…Q8xe · Your account'))).toBeTruthy();
    expect(within(sugg).queryByText('Whale')).toBeNull();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'ali' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Suggestions' })).getByText('Alice'));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.5' } });
    await waitFor(() => expect(m.classifyRecipient).toHaveBeenCalledWith({ tag: 'chain' }, ALICE));

    const review = screen.getByRole('button', { name: 'Review' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    await waitFor(() => expect(m.call).toHaveBeenCalled());
    expect(m.buildSendTransaction).toHaveBeenCalledWith(
      { chain: { tag: 'chain' }, reader: expect.objectContaining({ tag: 'reader' }) },
      { from: ME, to: ALICE, mint: 'SOL', amount: 500_000_000n },
    );
    expect(m.call).toHaveBeenCalledWith({ type: 'wallet:submit', account: ME, transactions: ['AQID'], send: true, purpose: 'send' });
    expect(await screen.findByText('Sent')).toBeTruthy();
    // Tracked against the signed transaction's own expiry.
    expect(m.confirm).toHaveBeenCalledWith('5igSig111', 10n);
    expect(screen.getByText('Confirmed by the network.')).toBeTruthy();
  });

  it('"Sent" waits for confirmation; an expired send says nothing was sent and returns to the form', async () => {
    let finish!: (o: string) => void;
    m.confirm = vi.fn(() => new Promise((r) => (finish = r)));
    m.route = { name: 'send', to: ALICE };
    m.call = vi.fn(async () => ({ signatures: ['5igSig111'] }));
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
    const review = screen.getByRole('button', { name: 'Review' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(await screen.findByText('Sending…')).toBeTruthy();
    expect(screen.queryByText('Sent')).toBeNull();
    expect(screen.getByRole('button', { name: 'View on explorer' })).toBeTruthy();
    finish('expired');
    expect(await screen.findByText("Didn't go through")).toBeTruthy();
    expect(screen.getByText(/nothing was sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('1');
  });

  it('a transaction that landed and failed says so; one Clef lost track of points to Activity', async () => {
    for (const [outcome, title] of [['failed', 'Send failed'], ['boom', "Couldn't confirm"]] as const) {
      m.confirm = vi.fn(async () => (outcome === 'boom' ? Promise.reject(new Error('Failed to fetch')) : outcome));
      m.route = { name: 'send', to: ALICE };
      m.call = vi.fn(async () => ({ signatures: ['5igSig111'] }));
      render(<SendScreen />);
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
      const review = screen.getByRole('button', { name: 'Review' });
      await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(review);
      expect(await screen.findByText(title)).toBeTruthy();
      cleanup();
    }
  });

  it.each([
    ['token-account', 'This is a token account, not a wallet'],
    ['program', 'This is a program, not a wallet'],
  ])('warns when the recipient is a %s', async (kind, text) => {
    m.route = { name: 'send', to: USDC_ATA };
    m.classifyRecipient = vi.fn(async () => kind);
    render(<SendScreen />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText(/Pasting an address\?/)).toBeNull();
  });

  it('field errors are tied to their fields and announced', () => {
    m.route = { name: 'send' };
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '7' } });
    const amount = screen.getByLabelText('Amount');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(amount.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe('More than your balance');
    expect(screen.getByText('More than your balance').getAttribute('role')).toBe('alert');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'zzzz-not-an-address' } });
    const to = screen.getByLabelText('To');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(to.getAttribute('aria-describedby')!)?.textContent).toBe('Not a Solana address');
  });

  it('shows the paste hint before an address and rejects more than the balance', () => {
    m.route = { name: 'send' };
    render(<SendScreen />);
    expect(screen.getByText(/Pasting an address\? Clef warns/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '7' } });
    expect(screen.getByText('More than your balance')).toBeTruthy();
  });

  it('a rejected approval reads as a cancel, not an error', async () => {
    m.route = { name: 'send', to: ALICE };
    m.call = vi.fn(async () => {
      throw Object.assign(new Error('User rejected the request'), { code: 4001 });
    });
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
    const review = screen.getByRole('button', { name: 'Review' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(await screen.findByText('Cancelled. Nothing was sent.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a send that never reached the RPC names it, keeps the raw error behind Details, and links the RPC settings', async () => {
    m.route = { name: 'send', to: ALICE };
    m.call = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    render(<SendScreen />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
    const review = screen.getByRole('button', { name: 'Review' });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    expect(await screen.findByText(/^Couldn't reach /)).toBeTruthy();
    expect(screen.getByText(/Nothing was sent/)).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change RPC' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'settings/network' });
  });

  it('parses amounts strictly', () => {
    expect(parseAmount('1.5', 9)).toBe(1_500_000_000n);
    expect(parseAmount('.5', 6)).toBe(500_000n);
    expect(parseAmount('1.1234567', 6)).toBeNull();
    expect(parseAmount('abc', 6)).toBeNull();
    expect(parseAmount('', 6)).toBeNull();
  });
});

describe('Receive', () => {
  it('renders a real QR of the active address, 4-char groups, and copies', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ReceiveScreen />);
    const qr = screen.getByRole('img', { name: 'QR code of your Main account address' });
    expect(qr.querySelector('svg, canvas, img')).toBeTruthy();
    const groups = screen.getByTestId('address-groups');
    expect(groups.textContent).toBe('7xKp Wm2Q dL9v Hc4T rB8n YeX5 uJ3k Ps6A Gf1z Nq7R 3fQa');
    const bold = groups.querySelectorAll('strong');
    expect([...bold].map((b) => b.textContent)).toEqual(['7xKp', '3fQa']);
    expect(screen.getByText('Mainnet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ME));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });
});

describe('Swap', () => {
  const quote = (outAmount: bigint) => ({
    inputMint: WSOL,
    outputMint: USDC,
    inAmount: 1_500_000_000n,
    outAmount,
    minOutAmount: (outAmount * 995n) / 1000n,
    slippageBps: 50,
    priceImpactPct: 0.001,
    route: [{ label: 'Orca', percent: 60 }, { label: 'Raydium', percent: 40 }],
    raw: {},
  });
  const jupiter = () => ({
    prices: vi.fn(async () => ({ [WSOL]: { usdPrice: 141.6, priceChange24h: 1 }, [USDC]: { usdPrice: 1, priceChange24h: 0 } })),
    quoteAndBuild: vi.fn(async (p: { slippageBps: number }) => ({ quote: { ...quote(212_400_000n), slippageBps: p.slippageBps }, wire: new Uint8Array([9, 9]), lastValidBlockHeight: 1n })),
    searchTokens: vi.fn(async () => [{ mint: JUP_MINT, symbol: 'JUP', name: 'Jupiter', decimals: 6, verified: true }]),
  });

  it('MAX on SOL keeps back what the swap needs in SOL (about 0.006)', () => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    render(<SwapScreen />);
    fireEvent.click(screen.getByText('MAX'));
    // 6.2104 SOL minus 0.001 (priority fee) + 2 token account deposits + a wallet's minimum.
    expect((screen.getByLabelText('You pay') as HTMLInputElement).value).toBe('6.20443056');
  });

  it('quotes, shows rate, minimum received, route and Clef fee None, then submits', async () => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    m.call = vi.fn(async () => ({ signatures: ['sig'] }));
    render(<SwapScreen />);
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1.5' } });
    await waitFor(() => expect(m.jupiter.quoteAndBuild).toHaveBeenCalledTimes(1));
    expect(m.jupiter.quoteAndBuild).toHaveBeenCalledWith({ inputMint: WSOL, outputMint: USDC, amount: 1_500_000_000n, slippageBps: 100, taker: ME });
    expect(await screen.findByText('1 SOL = 141.60 USDC')).toBeTruthy();
    expect(screen.getByTestId('swap-out').textContent).toBe('212.40');
    expect(screen.getByText('211.338 USDC')).toBeTruthy();
    expect(screen.getByText('Orca → Raydium')).toBeTruthy();
    expect(screen.getByText('via Jupiter')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByText(/≈ \$212\.40 · price impact <0\.01%/)).toBeTruthy();
    expect(screen.getByText(`Quote refreshes in ${REFRESH_SECONDS} s`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Review swap' }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith({ type: 'wallet:submit', account: ME, transactions: ['CQk='], send: true, purpose: 'swap' }));
    expect(m.jupiter.quoteAndBuild).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Swapped')).toBeTruthy();
  });

  it('refreshes the quote when the countdown ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    render(<SwapScreen />);
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1.5' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(m.jupiter.quoteAndBuild).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_SECONDS * 1000);
    });
    expect(screen.getByText('Quote refreshes in 0 s')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(m.jupiter.quoteAndBuild).toHaveBeenCalledTimes(2);
    expect(screen.getByText(`Quote refreshes in ${REFRESH_SECONDS} s`)).toBeTruthy();
  });

  it('changes slippage and re-quotes with it', async () => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    render(<SwapScreen />);
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1.5' } });
    await waitFor(() => expect(m.jupiter.quoteAndBuild).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Slippage settings, currently 1.0%' }));
    fireEvent.click(screen.getByText('3.0%'));
    await waitFor(() => expect(m.jupiter.quoteAndBuild).toHaveBeenLastCalledWith(expect.objectContaining({ slippageBps: 300 })));
    expect(screen.getByRole('button', { name: 'Slippage settings, currently 3.0%' })).toBeTruthy();
  });

  it('picks an output token from Jupiter search', async () => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    m.portfolio = portfolio({ holdings: [SOL, USDC_H] });
    render(<SwapScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose token to receive' }));
    fireEvent.change(screen.getByLabelText('Search tokens'), { target: { value: 'jup' } });
    const dialog = screen.getByRole('dialog', { name: 'You receive' });
    fireEvent.click(await within(dialog).findByText('JUP'));
    expect(within(screen.getByRole('button', { name: 'Choose token to receive' })).getByText('JUP')).toBeTruthy();
  });

  it('explains Jupiter errors; rate limits suggest an API key', async () => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    m.jupiter.quoteAndBuild = vi.fn(async () => {
      throw Object.assign(new Error('429'), { code: 'rate-limited', retryAfterMs: 4000 });
    });
    render(<SwapScreen />);
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1' } });
    expect(await screen.findByText('Jupiter is rate-limiting quotes')).toBeTruthy();
    expect(screen.getByText(/Try again in 4 s, or add a free Jupiter API key/)).toBeTruthy();
    expect(screen.getByText(/Settings → Swaps/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open swap settings'));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'settings', section: 'swaps' });
    expect((screen.getByRole('button', { name: 'Review swap' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['invalid-key', 'Jupiter rejected your API key'],
    ['unavailable', 'Jupiter is unavailable'],
    ['bad-request', 'No quote for this swap'],
  ])('maps %s', async (code, title) => {
    m.route = { name: 'swap' };
    m.jupiter = jupiter();
    m.jupiter.quoteAndBuild = vi.fn(async () => {
      throw Object.assign(new Error('Route not found'), { code });
    });
    render(<SwapScreen />);
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1' } });
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('is unavailable on devnet', () => {
    m.state.settings = settings({ network: 'devnet' });
    m.jupiter = jupiter();
    render(<SwapScreen />);
    expect(screen.getByText(/only available on Mainnet/)).toBeTruthy();
  });
});

describe('History', () => {
  it('a history that failed to load shows the error with Try again, not "Nothing here yet"', () => {
    const retry = vi.fn();
    m.history = { items: [], loading: false, error: 'Failed to fetch', loadMore: vi.fn(), retry, hasMore: false };
    render(<HistoryScreen />);
    expect(screen.getByText(/^Couldn't reach /)).toBeTruthy();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  const now = Date.now();
  const sec = (ms: number) => Math.floor(ms / 1000);
  const items: HistoryItem[] = [
    { signature: 'swapSig', slot: 3n, blockTime: sec(now - 60_000), status: 'success', kind: 'swap', title: 'Swap SOL → USDC', subtitle: 'External', deltas: [{ symbol: 'SOL', amount: '1.5000', direction: 'out' }, { symbol: 'USDC', amount: '211.80', direction: 'in' }], fee: '0.000105' },
    { signature: 'sendSig', slot: 2n, blockTime: sec(now - 120_000), status: 'success', kind: 'send', title: 'Sent to Alice', subtitle: 'External', deltas: [{ symbol: 'SOL', amount: '0.5000', direction: 'out' }], fee: '0.000005' },
    { signature: 'recvSig', slot: 1n, blockTime: sec(now - 86_400_000 - 1000), status: 'success', kind: 'receive', title: 'Received from 9vRt…k2Lm', subtitle: 'External', deltas: [{ symbol: 'USDC', amount: '25.00', direction: 'in' }], fee: '0' },
    { signature: 'failSig', slot: 0n, blockTime: sec(now - 86_400_000 - 2000), status: 'failed', kind: 'swap', title: 'Swap failed · slippage', subtitle: 'jup.ag', deltas: [], fee: '0.000105' },
  ];
  const log: RequestLogEntry[] = [
    { id: 'l1', at: now - 50_000, origin: 'https://jup.ag', kind: 'signTransactions', outcome: 'approved', account: ME as any, summary: 'Swap', dangerRules: [], signatures: ['swapSig'], snapshot: { level: 'intermediate', summary: 'Swap', balanceChanges: [{ owner: 'You', asset: 'SOL', amount: '-1.5000' }, { owner: 'You', asset: 'USDC', amount: '+212.40' }] } },
    { id: 'l2', at: now - 100_000, origin: 'clef://wallet', kind: 'signTransactions', outcome: 'approved', account: ME as any, summary: 'Send', dangerRules: [], signatures: ['sendSig'] },
    { id: 'l3', at: now - 70_000, origin: 'https://airdrop-claim.example', kind: 'signTransactions', outcome: 'rejected', account: ME as any, summary: 'Changes account owner', dangerRules: ['owner change'] },
  ];

  beforeEach(() => {
    m.history = { items, loading: false, error: null, loadMore: vi.fn(), retry: vi.fn(), hasMore: true };
    m.calls['log:list'] = log;
  });

  it('lists txs and request-log rows grouped by day with what-you-saw for Clef-signed txs', () => {
    render(<HistoryScreen />);
    expect(screen.getByText(fullText('Main · 7xKp…3fQa'))).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();

    const saw = screen.getByTestId('saw-vs-happened');
    expect(within(saw).getByText('What you saw → what happened')).toBeTruthy();
    expect(within(saw).getByText('~212.40 USDC')).toBeTruthy();
    expect(within(saw).getByText('211.80 USDC')).toBeTruthy();
    expect(within(saw).getByText(/✓ Matches what you approved/)).toBeTruthy();
    expect(within(saw).getByText(/jup\.ag ·/)).toBeTruthy();

    expect(screen.getByText(/^Clef · /)).toBeTruthy();
    expect(screen.getByText('Rejected · owner change')).toBeTruthy();
    expect(screen.getByText(/airdrop-claim\.example · .* · not sent/)).toBeTruthy();
    expect(screen.getByText('Swap failed · slippage')).toBeTruthy();
    expect(screen.getByText(/nothing moved/)).toBeTruthy();
    expect(screen.getByText('fee 0.000105')).toBeTruthy();

    fireEvent.click(screen.getByText('Load more'));
    expect(m.history.loadMore).toHaveBeenCalled();
  });

  it('opens a transaction in the same view, with the dApp that asked for it when Clef knows', () => {
    render(<HistoryScreen />);
    // Each row is titled by its signature (click copies it, without opening the row); the summary is a subtitle.
    const row = screen.getByRole('button', { name: 'Details of Swap SOL → USDC' });
    expect(within(row).getByRole('button', { name: 'Copy swapSig' })).toBeTruthy();
    expect(within(row).getByText('Swap SOL → USDC').className).toMatch(/text-muted/);
    fireEvent.click(within(row).getByRole('button', { name: 'Copy swapSig' }));
    expect(m.go).not.toHaveBeenCalledWith(expect.objectContaining({ signature: 'swapSig' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details of Swap SOL → USDC' }));
    expect(m.go).toHaveBeenLastCalledWith({ name: 'history/tx', signature: 'swapSig', origin: 'https://jup.ag' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Details of Received from 9vRt…k2Lm' }), { key: 'Enter' });
    expect(m.go).toHaveBeenLastCalledWith({ name: 'history/tx', signature: 'recvSig' });
  });

  it('flags a result that differs from what was shown', () => {
    m.calls['log:list'] = [{ ...log[0]!, snapshot: { level: 'basic', summary: 'Swap', balanceChanges: [{ owner: ME, asset: 'USDC', amount: '+250.00' }] } }];
    render(<HistoryScreen />);
    expect(within(screen.getByTestId('saw-vs-happened')).getByText(/Differs from what you approved · 1 other change/)).toBeTruthy();
  });

  it.each([
    ['Sent', ['Sent to Alice'], ['Swap SOL → USDC', 'Rejected · owner change']],
    ['Received', ['Received from 9vRt…k2Lm'], ['Sent to Alice']],
    ['Swaps', ['Swap SOL → USDC', 'Swap failed · slippage'], ['Sent to Alice']],
    ['Blocked', ['Rejected · owner change'], ['Sent to Alice', 'Swap SOL → USDC']],
    ['All', ['Sent to Alice', 'Rejected · owner change', 'Received from 9vRt…k2Lm'], []],
  ])('filter %s', (label, present, absent) => {
    render(<HistoryScreen />);
    fireEvent.click(screen.getByText(label, { selector: 'button, [role=radio], [role=tab], button *' }));
    for (const t of present) expect(screen.getByText(t)).toBeTruthy();
    for (const t of absent) expect(screen.queryByText(t)).toBeNull();
  });
});
