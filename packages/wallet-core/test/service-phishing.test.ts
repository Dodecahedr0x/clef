import { toBase64 } from '@clef/vault';
import { describe, expect, it } from 'vitest';
import { ERR, INTERNAL_ORIGIN } from '../src';
import { A, connected, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const req = (method: string, params: unknown = {}) => ({ id: 'r', method, params });
const hit = { reason: 'blocklist' as const, match: 'dapp.example' };
const phishing = { check: async (host: string) => (host === 'dapp.example' ? hit : null) };

describe('phishing and request log', () => {
  it('every request from a listed origin carries the hit; rejecting it is logged as blocked', async () => {
    const { service, approvals, logged } = await setup(() => ({ approved: false }), { phishing });
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ error: { code: ERR.USER_REJECTED } });
    expect(approvals.at(-1)).toEqual({ kind: 'connect', origin: ORIGIN, phishing: hit });
    expect(logged.at(-1)).toMatchObject({ origin: ORIGIN, kind: 'connect', outcome: 'blocked', summary: 'Connect' });
    await service.handle('https://fine.example', req('connect'));
    expect(approvals.at(-1)).toMatchObject({ phishing: null });
    expect(logged.at(-1)).toMatchObject({ outcome: 'rejected' });
  });

  it('signing requests carry the hit too', async () => {
    const { service, approvals } = await connected(() => ({ approved: true }), { phishing });
    await service.handle(ORIGIN, req('signMessage', { account: A, message: 'aGk=' }));
    expect(approvals.at(-1)).toMatchObject({ kind: 'signMessage', phishing: hit });
  });

  it('logs approvals with the page snapshot and failures', async () => {
    const snapshot = { level: 'basic' as const, summary: 'Send 1 SOL', balanceChanges: [{ owner: 'You', asset: 'SOL', amount: '-1' }] };
    const { service, logged, sender } = await connected(() => ({ approved: true, log: { summary: 'Send 1 SOL', dangerRules: ['owner-change'], snapshot } }));
    await service.handle(ORIGIN, req('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [toBase64(sampleWire(A))] }));
    expect(logged.at(-1)).toMatchObject({ kind: 'signTransactions', outcome: 'approved', account: A, summary: 'Send 1 SOL', dangerRules: ['owner-change'], snapshot });
    expect(logged.at(-1)!.signatures).toHaveLength(1);
    sender.send = async () => {
      throw new Error('Blockhash not found');
    };
    await service.handle(ORIGIN, req('signAndSendTransaction', { account: A, chain: 'solana:mainnet', transaction: toBase64(sampleWire(A)) }));
    expect(logged.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('the internal origin is never phishing-checked and dApps cannot claim it', async () => {
    const checked: string[] = [];
    const { service, approvals } = await setup(() => ({ approved: true }), { phishing: { check: async (h) => (checked.push(h), hit) } });
    expect(await service.submit({ account: A, transactions: [sampleWire(A)], send: false })).toHaveProperty('signedTransactions');
    expect(approvals.at(-1)).toMatchObject({ origin: INTERNAL_ORIGIN, phishing: null });
    expect(checked).toEqual([]);
    expect(await service.handle(INTERNAL_ORIGIN, req('connect'))).toMatchObject({ ok: false, error: { code: ERR.UNAUTHORIZED } });
  });

  it('submit sends each transaction and returns base58 signatures; rejection throws', async () => {
    const ok = await setup(() => ({ approved: true }));
    expect(await ok.service.submit({ account: A, transactions: [sampleWire(A), sampleWire(A)], send: true })).toEqual({ signatures: ['5sigBase58', '5sigBase58'] });
    expect(ok.approvals.at(-1)).toMatchObject({ kind: 'signTransactions', send: true, transactions: [expect.any(Uint8Array), expect.any(Uint8Array)] });
    const no = await setup(() => ({ approved: false }));
    await expect(no.service.submit({ account: A, transactions: [sampleWire(A)], send: true })).rejects.toThrow('User rejected the request');
  });
});
