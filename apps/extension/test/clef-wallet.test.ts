import { getBase58Encoder } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ClefWallet, type Bridge } from '../lib/clef-wallet';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const b64 = (b: number[]) => btoa(String.fromCharCode(...b));

function fakeBridge(handler: (method: string, params: any) => unknown) {
  let emit: (accounts: string[]) => void = () => {};
  const calls: { method: string; params: any }[] = [];
  const bridge: Bridge = {
    request: async (method, params) => {
      calls.push({ method, params });
      return handler(method, params);
    },
    onEvent: (cb) => {
      emit = cb;
    },
  };
  return { bridge, calls, emit: (a: string[]) => emit(a) };
}

const connectedWallet = async (handler: (method: string, params: any) => unknown = () => ({})) => {
  const fb = fakeBridge((m, p) => (m === 'connect' ? { accounts: [A] } : handler(m, p)));
  const wallet = new ClefWallet(fb.bridge);
  await wallet.features['standard:connect'].connect();
  return { wallet, ...fb, account: wallet.accounts[0]! };
};

describe('ClefWallet', () => {
  it('describes itself per Wallet Standard', () => {
    const w = new ClefWallet(fakeBridge(() => ({})).bridge);
    expect(w.name).toBe('Clef');
    expect(w.version).toBe('1.0.0');
    expect(w.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(w.chains).toEqual(['solana:mainnet', 'solana:devnet']);
    expect(Object.keys(w.features).sort()).toEqual(
      ['solana:signAndSendTransaction', 'solana:signIn', 'solana:signMessage', 'solana:signTransaction', 'standard:connect', 'standard:disconnect', 'standard:events'].sort(),
    );
    expect(w.features['solana:signTransaction'].supportedTransactionVersions).toEqual(['legacy', 0, 1]);
  });

  it('connect exposes accounts with public keys and notifies listeners', async () => {
    const fb = fakeBridge(() => ({ accounts: [A] }));
    const wallet = new ClefWallet(fb.bridge);
    const change = vi.fn();
    const off = wallet.features['standard:events'].on('change', change);
    const { accounts } = await wallet.features['standard:connect'].connect({ silent: true });
    expect(fb.calls).toEqual([{ method: 'connect', params: { silent: true } }]);
    expect(accounts[0]!.address).toBe(A);
    expect(accounts[0]!.publicKey).toEqual(new Uint8Array(getBase58Encoder().encode(A)));
    expect(accounts[0]!.chains).toEqual(['solana:mainnet', 'solana:devnet']);
    expect(change).toHaveBeenCalledWith({ accounts });
    off();
    fb.emit([]);
    expect(change).toHaveBeenCalledOnce();
    expect(wallet.accounts).toEqual([]);
  });

  it('batches signTransaction per account and chain, preserving order', async () => {
    const { wallet, calls, account } = await connectedWallet((_m, p) => ({ signedTransactions: p.transactions.map((t: string) => t) }));
    const out = await wallet.features['solana:signTransaction'].signTransaction(
      { account, transaction: new Uint8Array([1]), chain: 'solana:mainnet' },
      { account, transaction: new Uint8Array([2]), chain: 'solana:mainnet' },
      { account, transaction: new Uint8Array([3]), chain: 'solana:devnet' },
    );
    expect(out.map((o) => [...o.signedTransaction])).toEqual([[1], [2], [3]]);
    expect(calls.slice(1)).toEqual([
      { method: 'signTransaction', params: { account: A, chain: 'solana:mainnet', transactions: [b64([1]), b64([2])] } },
      { method: 'signTransaction', params: { account: A, chain: 'solana:devnet', transactions: [b64([3])] } },
    ]);
  });

  it('signAndSendTransaction returns signature bytes', async () => {
    const { wallet, calls, account } = await connectedWallet(() => ({ signature: b64([9, 9]) }));
    const [out] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
      account,
      transaction: new Uint8Array([1]),
      chain: 'solana:mainnet',
      options: { skipPreflight: true },
    });
    expect([...out!.signature]).toEqual([9, 9]);
    expect(calls.at(-1)).toEqual({ method: 'signAndSendTransaction', params: { account: A, chain: 'solana:mainnet', transaction: b64([1]), skipPreflight: true } });
  });

  it('signMessage round-trips bytes', async () => {
    const { wallet, account } = await connectedWallet((_m, p) => ({ signedMessage: p.message, signature: b64([7]) }));
    const [out] = await wallet.features['solana:signMessage'].signMessage({ account, message: new Uint8Array([104, 105]) });
    expect([...out!.signedMessage]).toEqual([104, 105]);
    expect([...out!.signature]).toEqual([7]);
    expect(out!.signatureType).toBe('ed25519');
  });

  it('signIn returns a WalletAccount and updates accounts', async () => {
    const fb = fakeBridge(() => ({ account: A, signedMessage: b64([1]), signature: b64([2]) }));
    const wallet = new ClefWallet(fb.bridge);
    const [out] = await wallet.features['solana:signIn'].signIn({ statement: 'hi' });
    expect(out!.account.address).toBe(A);
    expect(fb.calls[0]).toEqual({ method: 'signIn', params: { input: { statement: 'hi' } } });
    expect(wallet.accounts.map((a) => a.address)).toEqual([A]);
  });

  it('surfaces bridge errors with their code', async () => {
    const fb = fakeBridge(() => {
      throw Object.assign(new Error('User rejected the request'), { code: 4001 });
    });
    const wallet = new ClefWallet(fb.bridge);
    await expect(wallet.features['standard:connect'].connect()).rejects.toMatchObject({ code: 4001, message: 'User rejected the request' });
  });

  it('refuses accounts it does not know', async () => {
    const { wallet } = await connectedWallet();
    const stranger = { ...wallet.accounts[0]!, address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
    await expect(wallet.features['solana:signMessage'].signMessage({ account: stranger, message: new Uint8Array([1]) })).rejects.toThrow(/not connected/);
  });

  it('disconnect clears accounts', async () => {
    const { wallet, calls } = await connectedWallet();
    await wallet.features['standard:disconnect'].disconnect();
    expect(calls.at(-1)!.method).toBe('disconnect');
    expect(wallet.accounts).toEqual([]);
  });
});
