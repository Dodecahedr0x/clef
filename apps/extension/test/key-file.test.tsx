import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_KEY_FILE_BYTES, readKeyFile } from '../lib/key-file';

const h = vi.hoisted(() => ({ call: vi.fn(async () => ({})), tabsCreate: vi.fn() }));
vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('../lib/nav', () => ({
  useNav: () => ({ route: { name: 'import' }, go: vi.fn(), back: vi.fn(), reset: vi.fn() }),
  useOnboardingDraft: () => ({ password: null, clear: () => {} }),
}));
vi.mock('../lib/hooks', () => ({ useWallet: () => ({ state: { hasVault: true, unlocked: true, accounts: [], settings: { network: 'localnet', rpcUrl: 'http://127.0.0.1:8899' } }, refresh: async () => {} }) }));
vi.mock('wxt/browser', () => ({ browser: { tabs: { create: h.tabsCreate }, runtime: { getURL: (p: string) => `chrome-extension://id${p}` } } }));

const { ImportScreen } = await import('../entrypoints/popup/screens/Import');

let address: string;
let full: Uint8Array;
beforeAll(async () => {
  const seed = new Uint8Array(32).fill(7);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  address = signer.address;
  full = new Uint8Array([...seed, ...new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey))]);
});
afterEach(cleanup);

const fileOf = (text: string, name = 'keypair.json') => new File([text], name, { type: 'application/json' });

describe('readKeyFile', () => {
  it('reads a Solana CLI keypair JSON and a base58 text file', async () => {
    expect(await readKeyFile(fileOf(JSON.stringify([...full])))).toEqual({ ok: true, secret: JSON.stringify([...full]), address });
    expect(await readKeyFile(fileOf(`${getBase58Decoder().decode(full)}\n`, 'key.txt'))).toMatchObject({ ok: true, address });
  });

  it('refuses files that are not a key: wrong size, wrong content, mismatched public half', async () => {
    expect(await readKeyFile(fileOf('x'.repeat(MAX_KEY_FILE_BYTES + 1)))).toMatchObject({ ok: false });
    expect(await readKeyFile(fileOf(''))).toMatchObject({ ok: false });
    expect(await readKeyFile(fileOf('{"hello":"world"}'))).toMatchObject({ ok: false });
    const bad = [...full];
    bad[63] = bad[63]! ^ 1;
    expect(await readKeyFile(fileOf(JSON.stringify(bad)))).toMatchObject({ ok: false });
  });
});

describe('Import · Private key file', () => {
  it('a dropped keypair file fills the key and shows its address; Import sends it', async () => {
    render(<ImportScreen />);
    fireEvent.click(screen.getByRole('radio', { name: /Private key/ }));
    fireEvent.drop(screen.getByTestId('key-drop'), { dataTransfer: { files: [fileOf(JSON.stringify([...full]))], types: ['Files'] } });
    expect(await screen.findByText('Loaded keypair.json')).toBeTruthy();
    expect(screen.getByText(`Address ${address.slice(0, 4)}…${address.slice(-4)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import account' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'accounts:import', secretKey: JSON.stringify([...full]) })));
  });

  it('a file that is not a key is refused with a reason; the popup offers a tab for dropping files', async () => {
    render(<ImportScreen />);
    fireEvent.click(screen.getByRole('radio', { name: /Private key/ }));
    fireEvent.change(screen.getByLabelText('Choose a keypair file'), { target: { files: [fileOf('not a key', 'notes.txt')] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a Solana private key/);
    fireEvent.click(screen.getByRole('button', { name: 'Open in a tab' }));
    expect(h.tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://id/popup.html#import-key' });
  });
});
