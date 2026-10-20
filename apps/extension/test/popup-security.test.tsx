import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  call: vi.fn(),
  nav: { route: { name: 'settings/security' }, go: vi.fn(), back: vi.fn(), replace: vi.fn(), reset: vi.fn() },
  state: null as unknown,
}));

vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('../lib/nav', () => ({ useNav: () => h.nav }));
vi.mock('../lib/hooks', () => ({ useWallet: () => ({ state: h.state, error: null, refresh: vi.fn() }) }));

import { SecurityScreen } from '../entrypoints/popup/screens/Security';

const FIRST = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SECOND = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

const withPhrases = (phrases: number) => {
  h.state = { hasVault: true, unlocked: true, phrases, accounts: [], permissions: [], activeAccount: null, errorReportsAvailable: false, settings: {} };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.call.mockImplementation(async (c: { type: string; phrase?: number }) => (c.type === 'vault:revealMnemonic' ? { mnemonic: c.phrase === 2 ? SECOND : FIRST } : {}));
});
afterEach(cleanup);

describe('Security reveal with several recovery phrases', () => {
  it('asks which phrase to reveal and reveals that one', async () => {
    withPhrases(2);
    const user = userEvent.setup();
    render(<SecurityScreen />);
    const choice = screen.getByRole('radiogroup', { name: 'Which recovery phrase' });
    expect(within(choice).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Recovery phrase 1', 'Recovery phrase 2']);
    await user.click(screen.getByRole('radio', { name: 'Recovery phrase 2' }));
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'vault:revealMnemonic', password: 'a long password', phrase: 2 }));
    const words = await screen.findByRole('list', { name: 'Recovery phrase 2' });
    expect(within(words).getAllByText('zoo')).toHaveLength(11);
  });

  it('says so when the wallet has no phrase, with nothing to reveal', () => {
    withPhrases(0);
    render(<SecurityScreen />);
    expect(screen.getByText(/This wallet has no recovery phrase/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal recovery phrase' })).toBeNull();
  });

  it('does not ask when the wallet holds one phrase', async () => {
    withPhrases(1);
    const user = userEvent.setup();
    render(<SecurityScreen />);
    expect(screen.queryByRole('radiogroup', { name: 'Which recovery phrase' })).toBeNull();
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'vault:revealMnemonic', password: 'a long password' }));
    expect(await screen.findByRole('list', { name: 'Recovery phrase' })).toBeTruthy();
  });
});
