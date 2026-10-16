import { toBase64 } from '@clef/vault';
import { address, getTransactionDecoder } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ERR, type SquadsClient } from '../src';
import { A, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const VAULT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MULTISIG = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const req = (method: string, params: unknown) => ({ id: 'r', method, params });

function fakeSquads(members = [{ key: A, initiate: true }]) {
  const built: Parameters<SquadsClient['buildProposeTransaction']>[0][] = [];
  const client: SquadsClient = {
    fetchMultisig: vi.fn(async () => ({ transactionIndex: 6n, members })),
    buildProposeTransaction: async (p) => {
      built.push(p);
      return sampleWire(p.member); // member pays and signs
    },
    latestBlockhash: async () => 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k',
  };
  return { client, built };
}

async function squadsWallet(members?: { key: typeof A; initiate: boolean }[]) {
  const { client, built } = fakeSquads(members);
  const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [VAULT] } : { approved: true }), { squads: client });
  await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: A });
  await ctx.service.handle(ORIGIN, req('connect', {}));
  return { ...ctx, built };
}

describe('WalletService with a Squads vault', () => {
  it('signTransaction is unsupported', async () => {
    const { service, approvals } = await squadsWallet();
    const before = approvals.length;
    expect(await service.handle(ORIGIN, req('signTransaction', { account: VAULT, chain: 'solana:mainnet', transactions: [toBase64(sampleWire(VAULT))] }))).toMatchObject({
      ok: false,
      error: { code: ERR.UNSUPPORTED, message: 'Multisig accounts can only sign and send' },
    });
    expect(approvals.length).toBe(before);
  });

  it('signAndSendTransaction proposes: squadsPropose approval, member-signed proposal sent', async () => {
    const { service, approvals, sender, built, logged } = await squadsWallet();
    const inner = sampleWire(VAULT);
    const res = await service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(inner) }));
    expect(res).toMatchObject({ ok: true });
    expect(built).toEqual([{ multisig: MULTISIG, vaultIndex: 0, member: A, innerWire: inner, transactionIndex: 7n, blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' }]);
    expect(approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', account: VAULT, multisig: MULTISIG, vaultIndex: 0, member: A, inner, signer: { kind: 'software' }, phishing: null });
    expect(sender.sent).toHaveLength(1);
    expect(getTransactionDecoder().decode(sender.sent[0]!).signatures[A]).toBeTruthy();
    expect(logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'approved', signatures: ['5sigBase58'] });
  });

  it('refuses when the member is not an initiating member', async () => {
    const { service, sender } = await squadsWallet([{ key: A, initiate: false }]);
    expect(await service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }))).toMatchObject({
      ok: false,
      error: { code: ERR.UNAUTHORIZED },
    });
    expect(sender.sent).toHaveLength(0);
  });

  it('wallet.submit proposes from the internal origin without a connection', async () => {
    const { service, approvals } = await squadsWallet();
    expect(await service.submit({ account: VAULT, transactions: [sampleWire(VAULT)], send: true })).toEqual({ signatures: ['5sigBase58'] });
    expect(approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', origin: 'clef://wallet' });
    await expect(service.submit({ account: VAULT, transactions: [sampleWire(VAULT)], send: false })).rejects.toThrow(/sign and send/);
  });
});
