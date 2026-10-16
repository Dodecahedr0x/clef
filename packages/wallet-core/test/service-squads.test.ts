import { toBase64 } from '@clef/vault';
import { address, createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, getTransactionDecoder, signBytes, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ERR, type ApprovalDecision, type ApprovalRequest, type SquadsClient } from '../src';
import { transactionMessageBytes, verifyEd25519 } from '../src/hardware';
import { A, ORIGIN, setup } from './fixture';
import { sampleWire } from './helpers';

const VAULT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MULTISIG = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const BLOCKHASHES = ['EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi'];
const req = (method: string, params: unknown) => ({ id: 'r', method, params });
type Propose = Extract<ApprovalRequest, { kind: 'squadsPropose' }>;
type Status = 'confirmed' | 'failed' | 'expired';

/** Distinct member-paid outer wires: the transfer amount's low byte is `first + i`. */
function outerWires(member: Address, count: number, first = 1): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => {
    const w = sampleWire(member);
    w[w.length - 8] = first + i;
    return w;
  });
}

/**
 * `outer[k]` is how many outer wires the k-th build returns (the last entry repeats); a later build stands for one
 * resumed from chain, so its wires continue the numbering. `events` interleaves blockhash fetches, builds and approvals.
 */
function fakeSquads(o: { members?: { key: Address; initiate: boolean }[]; outer?: number[]; confirm?: (sig: string) => Status } = {}) {
  const outer = o.outer ?? [1];
  const built: Parameters<SquadsClient['buildProposeTransactions']>[0][] = [];
  const events: string[] = [];
  const confirmed: [string, bigint][] = [];
  let hashes = 0;
  const client: SquadsClient = {
    fetchMultisig: vi.fn(async () => ({ transactionIndex: 6n, members: o.members ?? [{ key: A, initiate: true }] })),
    buildProposeTransactions: async (p) => {
      built.push(p);
      events.push(`build:${p.blockhash.slice(0, 4)}`);
      const total = outer[0]!;
      const count = outer[Math.min(built.length - 1, outer.length - 1)]!;
      return outerWires(p.member, count, total - count + 1);
    },
    latestBlockhash: async () => {
      const blockhash = BLOCKHASHES[hashes % BLOCKHASHES.length]!;
      events.push(`hash:${blockhash.slice(0, 4)}`);
      return { blockhash, lastValidBlockHeight: 100n + BigInt(hashes++) };
    },
    confirm: async (sig, lastValidBlockHeight) => {
      confirmed.push([sig, lastValidBlockHeight]);
      return o.confirm ? o.confirm(sig) : 'confirmed';
    },
  };
  return { client, built, events, confirmed };
}

async function squadsWallet(o: Parameters<typeof fakeSquads>[0] & { member?: 'software' | 'ledger'; decide?: (r: Propose) => ApprovalDecision | Promise<ApprovalDecision> } = {}) {
  const dev = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
  const memberAddress = o.member === 'ledger' ? dev.address : A;
  const fake = fakeSquads({ members: [{ key: memberAddress, initiate: true }], ...o });
  const ctx = await setup(
    async (r) => {
      if (r.kind === 'connect') return { approved: true, accounts: [VAULT] };
      fake.events.push('approval');
      return o.decide ? o.decide(r as Propose) : { approved: true };
    },
    { squads: fake.client },
  );
  if (o.member === 'ledger') await ctx.accounts.add({ kind: 'ledger', address: dev.address, label: 'Ledger 1', path: "44'/501'/0'/0'" });
  await ctx.accounts.add({ kind: 'squads', address: VAULT, label: 'Team', multisig: MULTISIG, vaultIndex: 0, member: memberAddress });
  await ctx.service.handle(ORIGIN, req('connect', {}));
  let n = 0;
  const sent: Uint8Array[] = [];
  ctx.sender.send = async (wire) => {
    sent.push(wire);
    return `sig${++n}`;
  };
  const deviceSign = async (r: Propose) => ({
    approved: true as const,
    signatures: await Promise.all(r.proposals.map(async (w) => new Uint8Array(await signBytes(dev.keyPair.privateKey, transactionMessageBytes(w))))),
  });
  return { ...ctx, ...fake, sent, dev, deviceSign };
}

const propose = (service: { handle: (o: string, r: ReturnType<typeof req>) => Promise<unknown> }) =>
  service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(sampleWire(VAULT)) }));
const b64sig = (s: string) => toBase64(new Uint8Array(getBase58Encoder().encode(s)));
const position = (w: Uint8Array) => w[w.length - 8];

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

  it('signAndSendTransaction proposes: preview before the prompt, fresh blockhash after approval, member-signed proposal sent', async () => {
    const { service, approvals, sent, built, events, logged } = await squadsWallet();
    const inner = sampleWire(VAULT);
    const res = await service.handle(ORIGIN, req('signAndSendTransaction', { account: VAULT, chain: 'solana:mainnet', transaction: toBase64(inner) }));
    expect(res).toMatchObject({ ok: true, result: { signature: b64sig('sig1') } });
    expect(events).toEqual(['hash:EETu', 'build:EETu', 'approval', 'hash:4vJ9', 'build:4vJ9']);
    expect(built[1]).toEqual({ multisig: MULTISIG, vaultIndex: 0, member: A, innerWire: inner, transactionIndex: 7n, blockhash: BLOCKHASHES[1] });
    expect(approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', account: VAULT, multisig: MULTISIG, vaultIndex: 0, member: A, inner, signer: { kind: 'software' }, phishing: null });
    expect((approvals.at(-1) as Propose).proposals).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(getTransactionDecoder().decode(sent[0]!).signatures[A]).toBeTruthy();
    expect(logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'approved', signatures: ['sig1'] });
  });

  it('refuses when the member is not an initiating member', async () => {
    const { service, sent } = await squadsWallet({ members: [{ key: A, initiate: false }] });
    expect(await propose(service)).toMatchObject({ ok: false, error: { code: ERR.UNAUTHORIZED } });
    expect(sent).toHaveLength(0);
  });

  it('wallet.submit proposes from the internal origin without a connection', async () => {
    const { service, approvals } = await squadsWallet();
    expect(await service.submit({ account: VAULT, transactions: [sampleWire(VAULT)], send: true })).toEqual({ signatures: ['sig1'] });
    expect(approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', origin: 'clef://wallet' });
    await expect(service.submit({ account: VAULT, transactions: [sampleWire(VAULT)], send: false })).rejects.toThrow(/sign and send/);
  });

  it('buffered, software: sends every outer transaction in order, confirming each against its blockhash, returns the last signature', async () => {
    const { service, approvals, sent, confirmed, logged } = await squadsWallet({ outer: [3] });
    expect(await propose(service)).toMatchObject({ ok: true, result: { signature: b64sig('sig3') } });
    expect((approvals.at(-1) as Propose).proposals.map(position)).toEqual([1, 2, 3]);
    expect(sent.map(position)).toEqual([1, 2, 3]);
    for (const w of sent) expect(getTransactionDecoder().decode(w).signatures[A]).toBeTruthy();
    expect(confirmed).toEqual([
      ['sig1', 101n], // built after approval on the second blockhash
      ['sig2', 101n],
    ]);
    expect(logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'approved', signatures: ['sig1', 'sig2', 'sig3'] });
  });

  it.each(['expired', 'failed'] as const)('buffered: stops at the first %s transaction and tells the user to retry', async (status) => {
    const { service, sent, logged } = await squadsWallet({ outer: [3], confirm: (sig) => (sig === 'sig1' ? 'confirmed' : status) });
    const res = (await propose(service)) as { ok: false; error: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error.message).toBe(`Multisig proposal stopped at transaction 2 of 3 (${status}). Send the request again: Clef resumes the upload where it stopped.`);
    expect(sent).toHaveLength(2);
    expect(logged.at(-1)).toMatchObject({ kind: 'squadsPropose', outcome: 'failed' });
  });

  it('buffered: a send error also stops the sequence with the retry message', async () => {
    const ctx = await squadsWallet({ outer: [3] });
    let n = 0;
    ctx.sender.send = async () => {
      if (++n === 2) throw new Error('Blockhash not found');
      return `sig${n}`;
    };
    expect(await propose(ctx.service)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/transaction 2 of 3 \(Blockhash not found\)\. Send the request again/) } });
    expect(n).toBe(2);
  });

  it('buffered, hardware: signs exactly what the page showed, one verified device signature per outer transaction', async () => {
    let ctx!: Awaited<ReturnType<typeof squadsWallet>>;
    ctx = await squadsWallet({ member: 'ledger', outer: [3], decide: (r) => ctx.deviceSign(r) });
    expect(await propose(ctx.service)).toMatchObject({ ok: true, result: { signature: b64sig('sig3') } });
    expect(ctx.events).toEqual(['hash:EETu', 'build:EETu', 'approval']);
    expect(ctx.approvals.at(-1)).toMatchObject({ kind: 'squadsPropose', signer: { kind: 'ledger', address: ctx.dev.address } });
    expect(ctx.sent.map(position)).toEqual([1, 2, 3]);
    for (const w of ctx.sent) {
      const sig = getTransactionDecoder().decode(w).signatures[ctx.dev.address]!;
      expect(await verifyEd25519(transactionMessageBytes(w), sig, ctx.dev.address)).toBe(true);
    }
    expect(ctx.confirmed).toEqual([
      ['sig1', 100n],
      ['sig2', 100n],
    ]);
  });

  it('buffered, hardware: every outer transaction is signed in one approval, built right before the prompt', async () => {
    let ctx!: Awaited<ReturnType<typeof squadsWallet>>;
    ctx = await squadsWallet({ member: 'ledger', outer: [9], decide: (r) => ctx.deviceSign(r) });
    expect(await propose(ctx.service)).toMatchObject({ ok: true, result: { signature: b64sig('sig9') } });
    const requests = ctx.approvals.filter((r): r is Propose => r.kind === 'squadsPropose');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.proposals.map(position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect('step' in requests[0]!).toBe(false);
    expect(ctx.events).toEqual(['hash:EETu', 'build:EETu', 'approval']);
    expect(ctx.sent.map(position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ctx.confirmed.map(([s, h]) => `${s}@${h}`)).toEqual(['sig1@100', 'sig2@100', 'sig3@100', 'sig4@100', 'sig5@100', 'sig6@100', 'sig7@100', 'sig8@100']);
  });

  it('buffered, hardware: an expired blockhash mid-way stops with the retry message', async () => {
    let ctx!: Awaited<ReturnType<typeof squadsWallet>>;
    ctx = await squadsWallet({ member: 'ledger', outer: [5], confirm: (sig) => (sig === 'sig3' ? 'expired' : 'confirmed'), decide: (r) => ctx.deviceSign(r) });
    expect(await propose(ctx.service)).toMatchObject({
      ok: false,
      error: { message: 'Multisig proposal stopped at transaction 3 of 5 (expired). Send the request again: Clef resumes the upload where it stopped.' },
    });
    expect(ctx.sent).toHaveLength(3);
  });

  it('a hardware member must sign every outer transaction', async () => {
    let ctx!: Awaited<ReturnType<typeof squadsWallet>>;
    ctx = await squadsWallet({ member: 'ledger', outer: [2], decide: async (r) => ({ approved: true, signatures: (await ctx.deviceSign(r)).signatures.slice(0, 1) }) });
    expect(await propose(ctx.service)).toMatchObject({ ok: false });
    expect(ctx.sent).toHaveLength(0);
  });

  it('buffered proposals need confirm', async () => {
    const ctx = await squadsWallet({ outer: [3] });
    delete (ctx.client as Partial<SquadsClient>).confirm;
    expect(await propose(ctx.service)).toMatchObject({ ok: false, error: { code: ERR.UNSUPPORTED } });
    expect(ctx.approvals.filter((r) => r.kind === 'squadsPropose')).toHaveLength(0);
  });
});
