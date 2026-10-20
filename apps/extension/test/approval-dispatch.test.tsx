// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ACCOUNT = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const decide = vi.fn(async () => ({}));
let request: Record<string, unknown> | null = null;

const ping = vi.fn(async () => ({ pending: true }));
vi.mock('../lib/api', () => ({
  pingApproval: (...a: unknown[]) => ping(...(a as [])),
  decide: (...a: unknown[]) => decide(...(a as [])),
  getApproval: async () => request,
}));
vi.mock('../lib/serialize', () => ({ deserializeApproval: (s: unknown) => s }));
vi.mock('../lib/hooks', () => ({
  useWallet: () => ({
    state: { unlocked: true, hasVault: true, accounts: [{ kind: 'ledger', address: ACCOUNT, label: 'Ledger 1' }], settings: {} },
    error: null,
    refresh: async () => {},
  }),
}));
vi.mock('../entrypoints/popup/screens/Unlock', () => ({ UnlockScreen: () => <p>unlock</p> }));

// The request view records whether it was remounted and shows what onSign rejected with.
let mounts = 0;
vi.mock('../entrypoints/approval/tx/TxApproval', () => ({
  TxApproval: ({ onSign, onDecide }: { onSign?: (p: Uint8Array[]) => Promise<Uint8Array[]>; onDecide: (d: unknown) => void }) => {
    const [mount] = useState(() => ++mounts);
    const [error, setError] = useState<string | null>(null);
    return (
      <div>
        <p>review mount {mount}</p>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          onClick={() =>
            onSign!([new Uint8Array([1])]).then(
              (sigs) => onDecide({ approved: true, signatures: sigs }),
              (e: Error) => setError(e.message),
            )
          }
        >
          Sign
        </button>
      </div>
    );
  },
}));
vi.mock('../entrypoints/approval/requests', () => ({
  ConnectApproval: () => null,
  MessageApproval: () => null,
  SignInApproval: () => null,
  SquadsApproval: () => null,
  HardwareSignStep: (p: { summary: string; accountLabel?: string; onCancel: () => void; onSigned: (s: Uint8Array[]) => void }) => (
    <div>
      <p>device step: {p.summary} as {p.accountLabel}</p>
      <button type="button" onClick={p.onCancel}>Cancel on device step</button>
      <button type="button" onClick={() => p.onSigned([new Uint8Array(64)])}>Device signed</button>
    </div>
  ),
}));

const { Approval, APPROVAL_PING_MS } = await import('../entrypoints/approval/Approval');

afterEach(() => {
  cleanup();
  decide.mockClear();
  mounts = 0;
});

const txRequest = () => ({
  kind: 'signTransactions',
  origin: 'https://dapp.example',
  phishing: null,
  account: ACCOUNT,
  chain: 'solana:mainnet',
  transactions: [new Uint8Array([1])],
  send: false,
  signer: { kind: 'ledger', address: ACCOUNT, path: "44'/501'/0'" },
});

describe('approval dispatcher, hardware signer', () => {
  it('shows what is signed and keeps the review mounted; a cancel comes back as an error with nothing decided', async () => {
    request = txRequest();
    render(<Approval />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    expect(await screen.findByText('device step: Sign a transaction for dapp.example as Ledger 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel on device step' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/cancelled/i);
    expect(screen.getByText('review mount 1')).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
  });

  it('forwards the device signatures in the decision', async () => {
    request = txRequest();
    render(<Approval />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Device signed' }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]).toMatchObject([expect.any(String), { approved: true, signatures: [expect.any(Uint8Array)] }]);
    expect(screen.getByText('review mount 1')).toBeTruthy();
  });

  it('names Clef for a request the wallet itself made', async () => {
    request = { ...txRequest(), origin: 'clef://wallet' };
    render(<Approval />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    expect(await screen.findByText('device step: Sign a transaction for Clef as Ledger 1')).toBeTruthy();
  });

  it('says the request is gone when the id is unknown', async () => {
    request = null;
    render(<Approval />);
    expect(await screen.findByText(/no longer available/)).toBeTruthy();
  });
});

describe('approval kept alive while the user is elsewhere', () => {
  it('pings the background every 20 s and on return; a lost request turns into an expired notice', async () => {
    request = txRequest();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Approval />);
      await screen.findByRole('button', { name: 'Sign' });
      ping.mockClear();
      await vi.advanceTimersByTimeAsync(APPROVAL_PING_MS * 2 + 10);
      expect(ping).toHaveBeenCalledTimes(2);
      expect(APPROVAL_PING_MS).toBeLessThan(30_000); // under Chrome's idle limit for service workers
      ping.mockResolvedValueOnce({ pending: false });
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByText('This request expired')).toBeTruthy();
  });

  it('a decision Clef could not take says what to check, keeps the raw error behind Details, and can be closed', async () => {
    request = txRequest();
    decide.mockRejectedValueOnce(new Error('Signature does not verify') as never);
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    render(<Approval />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Device signed' }));
    expect(await screen.findByText("Clef couldn't complete your approval")).toBeTruthy();
    expect(screen.getByText(/check the site and Activity/)).toBeTruthy();
    expect(screen.getByText('Signature does not verify')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });

  it('a decision for a request that is gone shows the expired notice instead of doing nothing', async () => {
    request = txRequest();
    decide.mockResolvedValueOnce({ gone: true } as never);
    render(<Approval />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Device signed' }));
    expect(await screen.findByText('This request expired')).toBeTruthy();
  });
});
