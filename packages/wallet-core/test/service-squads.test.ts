import { toBase64 } from '@clef/vault';
import { address, createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, getTransactionDecoder, signBytes, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ERR, type ApprovalRequest, type SquadsClient } from '../src';
import { transactionMessageBytes, verifyEd25519 } from '../src/hardware';
import { A, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const VAULT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MULTISIG = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const req = (method: string, params: unknown) => ({ id: 'r', method, params });

/** Distinct member-paid outer wires: the transfer amount's low byte is the wire's position. */
function outerWires(member: Address, count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => {
    const w = sampleWire(member);
    w[w.length - 8] = i + 1;
    return w;
  });
}

function fakeSquads(members: { key: Address; initiate: boolean }[] = [{ key: A, initiate: true }], outer = 1, confirm?: SquadsClient['confirm']) {
  const built: Parameters<SquadsClient['buildProposeTransactions']>[0][] = [];
  const client: SquadsClient = {
    fetchMultisig: vi.fn(async () => ({ transactionIndex: 6n, members })),
    buildProposeTransactions: async (p) => {
      built.push(p);
      return outerWires(p.member, outer); // member pays and signs
    },
    latestBlockhash: async () => 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k',
    ...(confirm && { confirm }),
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
    expect((approvals.at(-1) as Extract<ApprovalRequest, { kind: 'squadsPropose' }>).proposals).toHaveLength(1);
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

  it('buffered proposals: signs every outer transaction, sends them in order waiting for each, returns the last signature', async () => {
    const confirmed: string[] = [];
    const { client } = fakeSquads(undefined, 3, async (sig) => {
      confirmed.push(sig);
      return 'confirmed';
    });
    const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [VAULT] } : { approved: true }), { squads: client });
    await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: A });
    await ctx.service.handle(ORIGIN, req('connect', {}));
    let n = 0;
    const sent: Uint8Array[] = [];
    ctx.sender.send = async (wire) => {
      sent.push(wire);
      return `sig${++n}`;
    };
    const res = await ctx.service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }));
    expect(res).toMatchObject({ ok: true, result: { signature: toBase64(new Uint8Array(getBase58Encoder().encode('sig3'))) } });
    const request = ctx.approvals.at(-1) as Extract<ApprovalRequest, { kind: 'squadsPropose' }>;
    expect(request.proposals).toEqual(outerWires(A, 3));
    expect(sent.map((w) => w[w.length - 8])).toEqual([1, 2, 3]);
    for (const w of sent) expect(getTransactionDecoder().decode(w).signatures[A]).toBeTruthy();
    expect(confirmed).toEqual(['sig1', 'sig2']);
    expect(ctx.logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'approved', signatures: ['sig1', 'sig2', 'sig3'] });
  });

  it('buffered proposals stop at the first failure', async () => {
    const { client } = fakeSquads(undefined, 3, async (sig) => (sig === 'sig1' ? 'confirmed' : 'failed'));
    const ctx = await setup((r) => (r.kind === 'connect' ? { approved: true, accounts: [VAULT] } : { approved: true }), { squads: client });
    await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: A });
    await ctx.service.handle(ORIGIN, req('connect', {}));
    let n = 0;
    ctx.sender.send = async () => `sig${++n}`;
    const res = await ctx.service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }));
    expect(res).toMatchObject({ ok: false });
    expect(n).toBe(2);
    expect(ctx.logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'failed' });

    ctx.sender.send = async () => {
      throw new Error('rpc down');
    };
    expect(await ctx.service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }))).toMatchObject({ ok: false });
  });

  it('buffered proposals with a hardware member: one verified device signature per outer transaction', async () => {
    const dev = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
    const sign = (b: Uint8Array) => signBytes(dev.keyPair.privateKey, b).then((s) => new Uint8Array(s));
    const { client } = fakeSquads([{ key: dev.address, initiate: true }], 2, async () => 'confirmed');
    const ctx = await setup(
      async (r) =>
        r.kind === 'connect'
          ? { approved: true, accounts: [VAULT] }
          : r.kind === 'squadsPropose'
            ? { approved: true, signatures: await Promise.all(r.proposals.map((w) => sign(transactionMessageBytes(w)))) }
            : { approved: false },
      { squads: client },
    );
    await ctx.accounts.add({ kind: 'ledger', address: dev.address, label: 'Ledger 1', path: "44'/501'/0'/0'" });
    await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: dev.address });
    await ctx.service.handle(ORIGIN, req('connect', {}));
    const res = await ctx.service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }));
    expect(res).toMatchObject({ ok: true });
    expect(ctx.approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', signer: { kind: 'ledger', address: dev.address } });
    expect(ctx.sender.sent).toHaveLength(2);
    for (const w of ctx.sender.sent) {
      const sig = getTransactionDecoder().decode(w).signatures[dev.address]!;
      expect(await verifyEd25519(transactionMessageBytes(w), sig, dev.address)).toBe(true);
    }
  });

  it('a hardware member must sign every outer transaction', async () => {
    const dev = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
    const { client } = fakeSquads([{ key: dev.address, initiate: true }], 2, async () => 'confirmed');
    const ctx = await setup(
      async (r) =>
        r.kind === 'connect'
          ? { approved: true, accounts: [VAULT] }
          : { approved: true, signatures: [new Uint8Array(await signBytes(dev.keyPair.privateKey, transactionMessageBytes((r as Extract<ApprovalRequest, { kind: 'squadsPropose' }>).proposals[0]!)))] },
      { squads: client },
    );
    await ctx.accounts.add({ kind: 'ledger', address: dev.address, label: 'Ledger 1', path: "44'/501'/0'/0'" });
    await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: dev.address });
    await ctx.service.handle(ORIGIN, req('connect', {}));
    expect(await ctx.service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }))).toMatchObject({ ok: false });
    expect(ctx.sender.sent).toHaveLength(0);
  });
});
