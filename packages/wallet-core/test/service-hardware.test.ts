import { fromBase64, toBase64 } from '@clef/vault';
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, getTransactionDecoder, signBytes, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ERR, signInMessageBytes, type ApprovalDecision, type ApprovalRequest } from '../src';
import { attachSignature, transactionMessageBytes, verifyEd25519 } from '../src/hardware';
import { A, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const PATH = "44'/501'/0'/0'";
type Ok<T> = { ok: true; result: T };
const req = (method: string, params: unknown) => ({ id: 'r', method, params });

async function device() {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
  return { address: signer.address, sign: (bytes: Uint8Array) => signBytes(signer.keyPair.privateKey, bytes).then((s) => new Uint8Array(s)) };
}

/** A wallet with a Ledger account connected to ORIGIN; `decide` plays the approval page. */
async function ledgerWallet(decide: (r: ApprovalRequest, dev: Awaited<ReturnType<typeof device>>) => Promise<ApprovalDecision>) {
  const dev = await device();
  const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [dev.address] } : decide(r, dev)));
  await ctx.accounts.add({ kind: 'ledger', address: dev.address, label: 'Ledger 1', path: PATH });
  await ctx.service.handle(ORIGIN, req('connect', {}));
  return { ...ctx, dev };
}

const signTx = (account: Address, wires: Uint8Array[]) => req('signTransaction', { account, chain: 'solana:mainnet', transactions: wires.map(toBase64) });

describe('hardware helpers', () => {
  it('verify, message bytes and attach', async () => {
    const dev = await device();
    const wire = sampleWire(dev.address);
    const sig = await dev.sign(transactionMessageBytes(wire));
    expect(await verifyEd25519(transactionMessageBytes(wire), sig, dev.address)).toBe(true);
    expect(await verifyEd25519(transactionMessageBytes(wire), sig, A)).toBe(false);
    expect(await verifyEd25519(transactionMessageBytes(wire), sig.slice(1), dev.address)).toBe(false);
    expect(getTransactionDecoder().decode(attachSignature(wire, dev.address, sig)).signatures[dev.address]).toEqual(sig);
    expect(() => attachSignature(wire, A, sig)).toThrow();
  });
});

describe('WalletService with a Ledger signer', () => {
  it('requests carry SignerInfo; valid device signatures are attached and returned', async () => {
    const { service, approvals, dev, logged } = await ledgerWallet(async (r, d) => {
      const wires = (r as Extract<ApprovalRequest, { kind: 'signTransactions' }>).transactions;
      return { approved: true, signatures: await Promise.all(wires.map((w) => d.sign(transactionMessageBytes(w)))) };
    });
    const wires = [sampleWire(dev.address), sampleWire(dev.address)];
    const res = (await service.handle(ORIGIN, signTx(dev.address, wires))) as Ok<{ signedTransactions: string[] }>;
    expect(res.ok).toBe(true);
    expect(approvals.at(-1)).toMatchObject({ kind: 'signTransactions', signer: { kind: 'ledger', address: dev.address, path: PATH } });
    for (const s of res.result.signedTransactions) {
      const tx = getTransactionDecoder().decode(fromBase64(s));
      expect(await verifyEd25519(new Uint8Array(tx.messageBytes), tx.signatures[dev.address]!, dev.address)).toBe(true);
    }
    expect(logged.at(-1)).toMatchObject({ kind: 'signTransactions', outcome: 'approved', account: dev.address });
    expect(logged.at(-1)!.signatures).toHaveLength(2);
  });

  it('an approval without signatures fails and is logged as failed', async () => {
    const { service, dev, logged } = await ledgerWallet(async () => ({ approved: true }));
    expect(await service.handle(ORIGIN, signTx(dev.address, [sampleWire(dev.address)]))).toMatchObject({ ok: false, error: { code: ERR.INTERNAL } });
    expect(logged.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('a wrong signature (other message or wrong count) is refused', async () => {
    const other = sampleWire(A);
    const { service, dev } = await ledgerWallet(async (_r, d) => ({ approved: true, signatures: [await d.sign(transactionMessageBytes(other))] }));
    expect(await service.handle(ORIGIN, signTx(dev.address, [sampleWire(dev.address)]))).toMatchObject({ ok: false });
    expect(await service.handle(ORIGIN, signTx(dev.address, [sampleWire(dev.address), sampleWire(dev.address)]))).toMatchObject({ ok: false });
  });

  it('sends the device-signed transaction', async () => {
    const { service, sender, dev } = await ledgerWallet(async (r, d) => ({
      approved: true,
      signatures: [await d.sign(transactionMessageBytes((r as Extract<ApprovalRequest, { kind: 'signTransactions' }>).transactions[0]!))],
    }));
    const res = await service.handle(ORIGIN, req('signAndSendTransaction', { account: dev.address, chain: 'solana:mainnet', transaction: toBase64(sampleWire(dev.address)) }));
    expect(res).toMatchObject({ ok: true, result: { signature: toBase64(new Uint8Array(getBase58Encoder().encode('5sigBase58'))) } });
    expect(sender.sent).toHaveLength(1);
    expect(getTransactionDecoder().decode(sender.sent[0]!).signatures[dev.address]).toBeTruthy();
  });

  it('signMessage verifies the device signature', async () => {
    const message = new TextEncoder().encode('hello');
    const good = await ledgerWallet(async (_r, d) => ({ approved: true, signatures: [await d.sign(message)] }));
    const res = (await good.service.handle(ORIGIN, req('signMessage', { account: good.dev.address, message: toBase64(message) }))) as Ok<{ signature: string }>;
    expect(await verifyEd25519(message, fromBase64(res.result.signature), good.dev.address)).toBe(true);
    const bad = await ledgerWallet(async (_r, d) => ({ approved: true, signatures: [await d.sign(new TextEncoder().encode('other'))] }));
    expect(await bad.service.handle(ORIGIN, req('signMessage', { account: bad.dev.address, message: toBase64(message) }))).toMatchObject({ ok: false });
  });

  it('signIn verifies the device signature over the exact SIWS bytes', async () => {
    const { service, dev } = await ledgerWallet(async (r, d) => {
      const input = (r as Extract<ApprovalRequest, { kind: 'signIn' }>).input;
      return { approved: true, account: d.address, signatures: [await d.sign(signInMessageBytes(input, d.address))] };
    });
    const res = (await service.handle(ORIGIN, req('signIn', { input: { nonce: 'abc12345' } }))) as Ok<{ account: string; signedMessage: string; signature: string }>;
    expect(res.result.account).toBe(dev.address);
    expect(await verifyEd25519(fromBase64(res.result.signedMessage), fromBase64(res.result.signature), dev.address)).toBe(true);
  });
});
