import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  call: vi.fn(),
  nav: { route: { name: 'welcome' } as { name: string; next?: string }, go: vi.fn(), back: vi.fn(), replace: vi.fn(), reset: vi.fn() },
  draft: { password: null as string | null, mnemonic: null as string | null, set: vi.fn(), clear: vi.fn() },
  state: null as unknown,
  refresh: vi.fn(),
  getBalance: vi.fn(),
  getTokenAccounts: vi.fn(),
}));

vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('../lib/nav', () => ({ useNav: () => h.nav, useOnboardingDraft: () => h.draft }));
vi.mock('../lib/hooks', () => ({ useWallet: () => ({ state: h.state, error: null, refresh: h.refresh }) }));
vi.mock('../lib/clients', () => ({
  createClients: () => ({ portfolio: { getBalance: h.getBalance, getTokenAccounts: h.getTokenAccounts } }),
}));

import { ConfirmPhraseScreen } from '../entrypoints/popup/screens/ConfirmPhrase';
import { CreatePasswordScreen } from '../entrypoints/popup/screens/CreatePassword';
import { ImportScreen } from '../entrypoints/popup/screens/Import';
import { RecoveryPhraseScreen } from '../entrypoints/popup/screens/RecoveryPhrase';
import { UnlockScreen } from '../entrypoints/popup/screens/Unlock';
import { WelcomeScreen } from '../entrypoints/popup/screens/Welcome';

const PHRASE12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE24 = Array(23).fill('abandon').join(' ') + ' art';
const GEN = 'orbit maple tunnel quiz salad pilot hazard velvet crane lunar attic meadow';
const A0 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const A1 = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const A2 = 'So11111111111111111111111111111111111111112';
const WATCH = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const STAKE = 'Stake11111111111111111111111111111111111111';
const VOTE = 'Vote111111111111111111111111111111111111111';

function setState(p: { hasVault: boolean; unlocked?: boolean }) {
  h.state = {
    hasVault: p.hasVault,
    unlocked: p.unlocked ?? p.hasVault,
    accounts: [],
    permissions: [],
    activeAccount: null,
    errorReportsAvailable: false,
    settings: { network: 'mainnet', rpcUrl: 'http://rpc.test', autoLockMinutes: 15, hideSpam: true, jupiterApiKey: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.draft.password = null;
  h.draft.mnemonic = null;
  h.nav.route = { name: 'welcome' };
  setState({ hasVault: false });
  h.getBalance.mockResolvedValue(0n);
  h.getTokenAccounts.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Welcome', () => {
  it('routes create and import to the password step', async () => {
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    expect(screen.getByRole('heading', { name: /Know what\s*you sign\./ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a new wallet' }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'create-password', next: 'create' });
    await user.click(screen.getByRole('button', { name: 'I already have a wallet' }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'create-password', next: 'import' });
    await user.click(screen.getByRole('button', { name: 'Watch an address' }));
    expect(h.nav.go).toHaveBeenLastCalledWith({ name: 'create-password', next: 'import' });
  });
});

describe('CreatePassword', () => {
  it('rates strength, checks the match and stores the password in the draft', async () => {
    const user = userEvent.setup();
    h.nav.route = { name: 'create-password', next: 'create' };
    render(<CreatePasswordScreen />);
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);

    await user.type(screen.getByLabelText('Password'), 'abc');
    expect(screen.getByText('Too short')).toBeTruthy();
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'password');
    expect(screen.getByText('Weak')).toBeTruthy();
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'a-long-passphrase');
    expect(screen.getByText('Strong')).toBeTruthy();

    await user.type(screen.getByLabelText('Confirm password'), 'a-long-pass');
    expect(screen.getByText(/Passwords don.t match/)).toBeTruthy();
    expect(cont.disabled).toBe(true);
    await user.type(screen.getByLabelText('Confirm password'), 'phrase');
    expect(screen.getByText(/Passwords match/)).toBeTruthy();
    expect(cont.disabled).toBe(false);

    await user.click(cont);
    expect(h.draft.set).toHaveBeenCalledWith({ password: 'a-long-passphrase' });
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'recovery-phrase' });
  });

  it('goes to import when next is import', async () => {
    const user = userEvent.setup();
    h.nav.route = { name: 'create-password', next: 'import' };
    render(<CreatePasswordScreen />);
    await user.type(screen.getByLabelText('Password'), 'a-long-passphrase');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-passphrase');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'import' });
  });
});

describe('RecoveryPhrase', () => {
  it('generates the phrase in the background when the draft has none and shows 12 words', async () => {
    const user = userEvent.setup();
    h.draft.password = 'a-long-passphrase';
    h.call.mockImplementation(async (c: { type: string }) => {
      if (c.type === 'mnemonic:generate') return { mnemonic: GEN };
      throw new Error('unexpected');
    });
    h.draft.set.mockImplementation((p: { mnemonic?: string }) => {
      if (p.mnemonic) h.draft.mnemonic = p.mnemonic;
    });
    const { rerender } = render(<RecoveryPhraseScreen />);
    await waitFor(() => expect(h.draft.set).toHaveBeenCalledWith({ mnemonic: GEN }));
    rerender(<RecoveryPhraseScreen />);
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items[2]!.textContent).toContain('tunnel');
    expect(screen.getByText(/Anyone with these words owns your funds/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I wrote them down' }));
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'confirm-phrase' });
  });
});

describe('ConfirmPhrase', () => {
  it('asks for 3 random words with distractors, then Finish creates the vault', async () => {
    const user = userEvent.setup();
    h.draft.password = 'a-long-passphrase';
    h.draft.mnemonic = GEN;
    h.call.mockResolvedValue({});
    render(<ConfirmPhraseScreen />);
    const words = GEN.split(' ');
    const prompt = screen.getByText(/Pick words \d+, \d+ and \d+/).textContent!;
    const positions = prompt.match(/\d+/g)!.map(Number);
    expect(new Set(positions).size).toBe(3);
    const finish = screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);

    for (const [i, pos] of positions.entries()) {
      const group = screen.getByRole('group', { name: `Choose word ${pos}` });
      const options = within(group).getAllByRole('button');
      expect(options).toHaveLength(6);
      const correct = words[pos - 1]!;
      expect(options.filter((b) => b.textContent === correct)).toHaveLength(1);
      if (i === 0) {
        await user.click(options.find((b) => b.textContent !== correct)!);
        expect(screen.getByText(new RegExp(`That's not word #${pos}`))).toBeTruthy();
        expect(finish.disabled).toBe(true);
      }
      await user.click(within(group).getByRole('button', { name: correct }));
    }
    expect(finish.disabled).toBe(false);
    await user.click(finish);
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'vault:create', password: 'a-long-passphrase', mnemonic: GEN }));
    expect(h.draft.clear).toHaveBeenCalled();
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });
});

describe('A first recovery phrase for a wallet without one', () => {
  it('shows the phrase as step 1 of 2 and goes on to the check', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true });
    h.nav.route = { name: 'accounts/new-phrase' };
    h.draft.mnemonic = GEN;
    render(<RecoveryPhraseScreen />);
    expect(screen.getByText(/New accounts come from this phrase/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I wrote them down' }));
    expect(h.nav.go).toHaveBeenCalledWith({ name: 'accounts/confirm-phrase' });
  });

  it('after the check, adds the phrase with its first account to the unlocked wallet', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true });
    h.nav.route = { name: 'accounts/confirm-phrase' };
    h.draft.mnemonic = GEN;
    h.call.mockResolvedValue({});
    render(<ConfirmPhraseScreen />);
    const words = GEN.split(' ');
    const positions = screen.getByText(/Pick words \d+, \d+ and \d+/).textContent!.match(/\d+/g)!.map(Number);
    for (const pos of positions) {
      await user.click(within(screen.getByRole('group', { name: `Choose word ${pos}` })).getByRole('button', { name: words[pos - 1]! }));
    }
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:importMnemonic', mnemonic: GEN, indexes: [0] }));
    expect(h.call.mock.calls.some(([c]) => c.type === 'vault:create')).toBe(false);
    expect(h.draft.clear).toHaveBeenCalled();
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });
});

describe('Import', () => {
  beforeEach(() => {
    h.draft.password = 'a-long-passphrase';
    h.nav.route = { name: 'import' };
    h.getBalance.mockImplementation(async (a: string) => (a === A0 ? 6_210_000_000n : a === A1 ? 400_000_000n : 0n));
    h.getTokenAccounts.mockImplementation(async (a: string) => (a === A0 ? [{ amount: 5n }, { amount: 1n }, { amount: 2n }, { amount: 0n }] : []));
    h.call.mockImplementation(async (c: { type: string }) => {
      if (c.type === 'accounts:scan') return { accounts: [{ index: 0, address: A0 }, { index: 1, address: A1 }, { index: 2, address: A2 }] };
      if (c.type === 'mnemonic:generate') return { mnemonic: GEN };
      return {};
    });
  });

  it('checks the checksum, blurs until Show, scans accounts with balances and imports the selected indexes', async () => {
    const user = userEvent.setup();
    render(<ImportScreen />);
    const box = screen.getByLabelText('Recovery phrase (12 or 24 words)') as HTMLTextAreaElement;
    await user.click(box);
    await user.paste(PHRASE12.split(' ').slice(0, 11).join(' '));
    expect(screen.getByText('11 words')).toBeTruthy();
    await user.type(box, ' abandon');
    expect(screen.getByText(/checksum doesn.t match/i)).toBeTruthy();
    await user.clear(box);
    await user.paste(PHRASE12);
    expect(screen.getByText('✓ 12 words · valid checksum')).toBeTruthy();
    expect(box.className).toMatch(/blur/);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(box.className).not.toMatch(/blur/);

    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:scan', mnemonic: PHRASE12, from: 0, count: 3 }));
    expect(await screen.findByText('6.21 SOL · 3 tokens')).toBeTruthy();
    expect(screen.getByText('0.40 SOL')).toBeTruthy();
    expect(screen.getByText('empty')).toBeTruthy();
    expect(screen.getByText("44'/501'/n'/0'")).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);

    await user.click(screen.getByRole('button', { name: 'Import 2 accounts' }));
    await waitFor(() =>
      expect(h.call).toHaveBeenCalledWith({ type: 'vault:create', password: 'a-long-passphrase', mnemonic: PHRASE12, indexes: [0, 1] }),
    );
    expect(h.draft.clear).toHaveBeenCalled();
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('accepts 24 words', async () => {
    const user = userEvent.setup();
    render(<ImportScreen />);
    await user.click(screen.getByLabelText('Recovery phrase (12 or 24 words)'));
    await user.paste(PHRASE24);
    expect(screen.getByText('✓ 24 words · valid checksum')).toBeTruthy();
  });

  it('offers the legacy derivation path, scanned and imported in the background', async () => {
    const user = userEvent.setup();
    render(<ImportScreen />);
    await user.click(screen.getByLabelText('Recovery phrase (12 or 24 words)'));
    await user.paste(PHRASE12);
    await screen.findByText('6.21 SOL · 3 tokens');
    h.call.mockImplementation(async (c: { type: string }) => (c.type === 'accounts:scan' ? { accounts: [{ index: 0, address: WATCH }, { index: 1, address: STAKE }, { index: 2, address: VOTE }] } : {}));
    await user.click(screen.getByRole('button', { name: 'Use a different derivation path' }));
    expect(screen.getByText("44'/501'/n'")).toBeTruthy();
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:scan', mnemonic: PHRASE12, from: 0, count: 3, scheme: 'legacy' }));
    await waitFor(() => expect(screen.queryByText('6.21 SOL · 3 tokens')).toBeNull());
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    await waitFor(() => expect((boxes[0] as HTMLInputElement).checked).toBe(true));
    await user.click(boxes[2]!);

    await user.click(screen.getByRole('button', { name: 'Import 2 accounts' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:importMnemonic', mnemonic: PHRASE12, indexes: [0, 2], scheme: 'legacy' }));
    expect(h.call).toHaveBeenCalledWith({ type: 'vault:create', password: 'a-long-passphrase', mnemonic: PHRASE12, indexes: [] });
    expect(h.call.mock.calls.some(([c]) => c.type === 'accounts:import')).toBe(false);
  });

  it('another phrase into an existing wallet goes to the background as a phrase, not as keys', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true });
    render(<ImportScreen />);
    await user.click(screen.getByLabelText('Recovery phrase (12 or 24 words)'));
    await user.paste(PHRASE12);
    await screen.findByText('6.21 SOL · 3 tokens');
    await user.click(screen.getByRole('button', { name: 'Import 2 accounts' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:importMnemonic', mnemonic: PHRASE12, indexes: [0, 1] }));
    expect(h.call.mock.calls.some(([c]) => c.type === 'vault:create' || c.type === 'accounts:import')).toBe(false);
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('private key tab: creates the vault from that key alone, never with a phrase the user has not seen', async () => {
    const user = userEvent.setup();
    render(<ImportScreen />);
    await user.click(screen.getByRole('radio', { name: 'Private key' }));
    await user.type(screen.getByLabelText('Private key'), 'SECRET');
    await user.click(screen.getByRole('button', { name: 'Import account' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'vault:create', password: 'a-long-passphrase', secretKey: 'SECRET' }));
    expect(h.call.mock.calls.some(([c]) => c.type === 'mnemonic:generate' || c.type === 'accounts:import')).toBe(false);
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('private key tab: a rejected key at onboarding stays on the form', async () => {
    const user = userEvent.setup();
    h.call.mockRejectedValueOnce(new Error('Invalid secret key: expected 64 bytes'));
    render(<ImportScreen />);
    await user.click(screen.getByRole('radio', { name: 'Private key' }));
    await user.type(screen.getByLabelText('Private key'), 'notakey');
    await user.click(screen.getByRole('button', { name: 'Import account' }));
    expect(await screen.findByText('Invalid secret key: expected 64 bytes')).toBeTruthy();
    expect(h.call.mock.calls.filter(([c]) => c.type === 'vault:create')).toHaveLength(1);
    expect(h.nav.reset).not.toHaveBeenCalled();
  });

  it('watch-only tab at onboarding creates the vault with the watched address and no phrase', async () => {
    const user = userEvent.setup();
    render(<ImportScreen />);
    await user.click(screen.getByRole('radio', { name: 'Watch-only' }));
    await user.type(screen.getByLabelText('Address'), WATCH);
    await user.click(screen.getByRole('button', { name: 'Watch address' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'vault:create', password: 'a-long-passphrase', watch: { address: WATCH, label: 'Watch' } }));
    expect(h.call.mock.calls.some(([c]) => c.type === 'mnemonic:generate' || c.type === 'accounts:watch')).toBe(false);
  });

  it('private key tab with an existing wallet only imports', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true });
    h.call.mockRejectedValueOnce(new Error('Invalid secret key'));
    render(<ImportScreen />);
    await user.click(screen.getByRole('radio', { name: 'Private key' }));
    await user.type(screen.getByLabelText('Private key'), 'BAD');
    await user.click(screen.getByRole('button', { name: 'Import account' }));
    expect(await screen.findByText('Invalid secret key')).toBeTruthy();
    expect(h.call.mock.calls.some(([c]) => c.type === 'vault:create')).toBe(false);
    expect(h.nav.reset).not.toHaveBeenCalled();
  });

  it('watch-only tab validates the address and watches it', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true });
    render(<ImportScreen />);
    await user.click(screen.getByRole('radio', { name: 'Watch-only' }));
    await user.type(screen.getByLabelText('Address'), 'not-an-address');
    expect(screen.getByText('Not a Solana address')).toBeTruthy();
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), WATCH);
    await user.type(screen.getByLabelText('Name'), 'Grant wallet');
    await user.click(screen.getByRole('button', { name: 'Watch address' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'accounts:watch', address: WATCH, label: 'Grant wallet' }));
    expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' });
  });
});

describe('Unlock', () => {
  it('shows an error on a wrong password and unlocks on the right one', async () => {
    const user = userEvent.setup();
    setState({ hasVault: true, unlocked: false });
    h.call.mockRejectedValueOnce(new Error('Wrong password')).mockResolvedValueOnce({});
    render(<UnlockScreen />);
    expect(screen.getByText('Auto-locks after 15 min')).toBeTruthy();
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Wrong password')).toBeTruthy();
    expect(h.nav.reset).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(h.call).toHaveBeenLastCalledWith({ type: 'vault:unlock', password: 'correct-horse' }));
    await waitFor(() => expect(h.nav.reset).toHaveBeenCalledWith({ name: 'home' }));
    expect(h.refresh).toHaveBeenCalled();
  });
});
