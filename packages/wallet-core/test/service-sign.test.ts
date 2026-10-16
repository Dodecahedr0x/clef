import { fromBase64, toBase64 } from '@clef/vault';
import { getBase58Encoder, getTransactionDecoder } from '@solana/kit';
import { verifySignIn } from '@solana/wallet-standard-util';
import { describe, expect, it } from 'vitest';
import { ERR } from '../src';
import { A, connected, ORIGIN, setup } from './fixture';
import { OTHER, sampleWire } from './helpers';

const req = (method: string, params: unknown) => ({ id: 'r', method, params });
const signTx = (wire: Uint8Array, chain = 'solana:mainnet', account: string = A) =>
  req('signTransaction', { account, chain, transactions: [toBase64(wire)] });
type Ok<T> = { ok: true; result: T };

describe('WalletService signTransaction', () => {
  it('signs a batch for a connected account after approval', async () => {
    const { service, approvals } = await connected();
    const wires = [sampleWire(A), sampleWire(A)];
    const res = (await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: wires.map(toBase64) }))) as Ok<{
      signedTransactions: string[];
    }>;
    expect(res.ok).toBe(true);
    expect(res.result.signedTransactions).toHaveLength(2);
    for (const signed of res.result.signedTransactions) {
      expect(getTransactionDecoder().decode(fromBase64(signed)).signatures[A]).toBeTruthy();
    }
    expect(approvals.at(-1)).toEqual({ kind: 'signTransactions', origin: ORIGIN, phishing: null, account: A, chain: 'solana:mainnet', transactions: wires, send: false, signer: { kind: 'software' } });
  });

  it('refuses unconnected origins, wrong chains and watch-only accounts before prompting', async () => {
    const { service, accounts, approvals } = await connected();
    const before = approvals.length;
    expect(await service.handle('https://other.example', signTx(sampleWire(A)))).toMatchObject({ error: { code: ERR.UNAUTHORIZED } });
    expect(await service.handle(ORIGIN, signTx(sampleWire(A), 'solana:devnet'))).toMatchObject({ error: { code: ERR.UNSUPPORTED } });
    await accounts.remove(A);
    await accounts.add({ kind: 'watch', address: A, label: 'w' });
    expect(await service.handle(ORIGIN, signTx(sampleWire(A)))).toMatchObject({ error: { code: ERR.UNAUTHORIZED } });
    expect(approvals.length).toBe(before);
  });

  it('a transaction the account does not sign is refused after approval without a signature', async () => {
    const { service } = await connected();
    expect(await service.handle(ORIGIN, signTx(sampleWire(OTHER)))).toMatchObject({ ok: false, error: { code: ERR.INVALID_PARAMS } });
  });

  it('rejection signs nothing', async () => {
    const { service } = await connected(() => ({ approved: false }));
    expect(await service.handle(ORIGIN, signTx(sampleWire(A)))).toMatchObject({ error: { code: ERR.USER_REJECTED } });
  });

  it('a wallet locked before signing reports it without signing', async () => {
    const { service, vault } = await connected();
    await vault.lock();
    expect(await service.handle(ORIGIN, signTx(sampleWire(A)))).toMatchObject({ ok: false, error: { code: ERR.UNAUTHORIZED, message: 'Wallet is locked' } });
  });
});

describe('WalletService signAndSendTransaction', () => {
  it('submits the signed wire and returns the signature bytes', async () => {
    const { service, sender, approvals } = await connected();
    const res = (await service.handle(
      ORIGIN,
      req('signAndSendTransaction', { account: A, chain: 'solana:mainnet', transaction: toBase64(sampleWire(A)) }),
    )) as Ok<{ signature: string }>;
    expect(sender.sent).toHaveLength(1);
    expect(getTransactionDecoder().decode(sender.sent[0]!).signatures[A]).toBeTruthy();
    expect(res.result.signature).toBe(toBase64(new Uint8Array(getBase58Encoder().encode('5sigBase58'))));
    expect(approvals.at(-1)).toMatchObject({ kind: 'signTransactions', send: true });
  });

  it('a send failure is reported and nothing claims success', async () => {
    const { service, sender } = await connected();
    sender.send = async () => {
      throw new Error('Blockhash not found');
    };
    expect(
      await service.handle(ORIGIN, req('signAndSendTransaction', { account: A, chain: 'solana:mainnet', transaction: toBase64(sampleWire(A)) })),
    ).toMatchObject({ ok: false, error: { code: ERR.INTERNAL } });
  });
});

describe('WalletService signMessage', () => {
  it('returns the message and a valid signature', async () => {
    const { service, approvals } = await connected();
    const message = new TextEncoder().encode('hi');
    const res = (await service.handle(ORIGIN, req('signMessage', { account: A, message: toBase64(message) }))) as Ok<{
      signedMessage: string;
      signature: string;
    }>;
    expect(fromBase64(res.result.signedMessage)).toEqual(message);
    expect(fromBase64(res.result.signature)).toHaveLength(64);
    expect(approvals.at(-1)).toEqual({ kind: 'signMessage', origin: ORIGIN, phishing: null, account: A, message, signer: { kind: 'software' } });
  });

  it('requires a connected account', async () => {
    const { service } = await setup();
    expect(await service.handle(ORIGIN, req('signMessage', { account: A, message: 'aGk=' }))).toMatchObject({ error: { code: ERR.UNAUTHORIZED } });
  });
});

describe('WalletService signIn', () => {
  const publicKey = new Uint8Array(getBase58Encoder().encode(A));

  it('binds the domain to the requesting origin, signs a verifiable message and connects', async () => {
    const { service, approvals, events } = await setup((r) => (r.kind === 'signIn' ? { approved: true, account: A } : { approved: false }));
    const res = (await service.handle(ORIGIN, req('signIn', { input: { statement: 'Welcome', nonce: 'abc12345' } }))) as Ok<{
      account: string;
      signedMessage: string;
      signature: string;
    }>;
    expect(res.ok).toBe(true);
    expect(res.result.account).toBe(A);
    expect(new TextDecoder().decode(fromBase64(res.result.signedMessage))).toContain('dapp.example wants you to sign in with your Solana account');
    expect(approvals.at(-1)).toEqual({ kind: 'signIn', origin: ORIGIN, phishing: null, account: null, input: { statement: 'Welcome', nonce: 'abc12345', domain: 'dapp.example' }, signer: null });
    const verified = verifySignIn(
      { domain: 'dapp.example', statement: 'Welcome', nonce: 'abc12345', address: A },
      {
        account: { address: A, publicKey, chains: [], features: [] },
        signedMessage: fromBase64(res.result.signedMessage),
        signature: fromBase64(res.result.signature),
      },
    );
    expect(verified).toBe(true);
    expect(events.at(-1)).toEqual({ origin: ORIGIN, accounts: [A] });
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [A] } });
  });

  it('uses the requested address when one is given', async () => {
    const { service, approvals } = await setup(() => ({ approved: true }));
    expect(await service.handle(ORIGIN, req('signIn', { input: { address: A } }))).toMatchObject({ ok: true, result: { account: A } });
    expect(approvals.at(-1)).toMatchObject({ account: A });
  });

  it('refuses a domain that is not the origin, before prompting', async () => {
    const { service, approvals } = await setup(() => ({ approved: true, account: A }));
    expect(await service.handle(ORIGIN, req('signIn', { input: { domain: 'bank.example' } }))).toMatchObject({ error: { code: ERR.INVALID_PARAMS } });
    expect(approvals).toEqual([]);
  });

  it('refuses accounts it cannot sign with', async () => {
    const { service } = await setup(() => ({ approved: true, account: OTHER }));
    expect(await service.handle(ORIGIN, req('signIn', { input: {} }))).toMatchObject({ ok: false });
  });
});
