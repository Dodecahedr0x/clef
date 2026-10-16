import type { ApprovalRequest } from '@clef/wallet-core';
import { describe, expect, it } from 'vitest';
import { deserializeApproval, parseDecision, serializeApproval, serializeDecision } from '../lib/serialize';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' as never;
const B = '11111111111111111111111111111111' as never;
const HIT = { reason: 'blocklist', match: 'evil.example' } as const;
const LEDGER = { kind: 'ledger', address: A, path: "44'/501'/0'/0'" } as const;
const KEYSTONE = { kind: 'keystone', address: A, path: "44'/501'/0'", xfp: '12345678' } as const;
const sig = (fill: number) => new Uint8Array(64).fill(fill);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

const VARIANTS: ApprovalRequest[] = [
  { kind: 'connect', origin: 'https://d.example', phishing: null },
  { kind: 'connect', origin: 'https://evil.example', phishing: HIT },
  {
    kind: 'signTransactions',
    origin: 'https://d.example',
    phishing: null,
    account: A,
    chain: 'solana:mainnet',
    transactions: [new Uint8Array([1, 2]), new Uint8Array([3])],
    send: true,
    signer: { kind: 'software' },
  },
  { kind: 'signMessage', origin: 'https://d.example', phishing: HIT, account: A, message: new Uint8Array([104, 105]), signer: LEDGER },
  { kind: 'signIn', origin: 'https://d.example', phishing: null, account: null, input: { domain: 'd.example', statement: 'hi' }, signer: null },
  { kind: 'signIn', origin: 'https://d.example', phishing: null, account: A, input: { domain: 'd.example' }, signer: KEYSTONE },
  {
    kind: 'squadsPropose',
    origin: 'clef://wallet',
    phishing: null,
    account: A,
    multisig: B,
    vaultIndex: 0,
    member: A,
    inner: new Uint8Array([9, 8, 7]),
    proposals: [new Uint8Array([6, 5])],
    signer: { kind: 'software' },
  },
  {
    kind: 'squadsPropose',
    origin: 'https://dapp.example',
    phishing: null,
    account: A,
    multisig: B,
    vaultIndex: 0,
    member: A,
    inner: new Uint8Array([9, 8, 7]),
    proposals: [new Uint8Array([6, 5]), new Uint8Array([4])],
    step: { index: 2, of: 3 },
    signer: { kind: 'ledger', address: A, path: "44'/501'/0'" },
  },
] as ApprovalRequest[];

describe('approval serialization', () => {
  it.each(VARIANTS.map((r) => [`${r.kind}${r.phishing ? ' (phishing)' : ''}`, r] as const))('round-trips %s through JSON', (_n, req) => {
    const wire = JSON.parse(JSON.stringify(serializeApproval(req)));
    expect(JSON.stringify(wire)).not.toMatch(/"0":/); // no Uint8Array leaked as an index object
    expect(deserializeApproval(wire)).toEqual(req);
  });

  it('encodes bytes as base64 strings', () => {
    const s = serializeApproval(VARIANTS[6]!) as { inner: unknown; proposals: unknown };
    expect(s.inner).toBe('CQgH');
    expect(s.proposals).toEqual(['BgU=']);
  });
});

describe('parseDecision', () => {
  it('accepts rejections and well-formed approvals', () => {
    expect(parseDecision({ approved: false })).toEqual({ approved: false });
    expect(parseDecision({ approved: true })).toEqual({ approved: true });
    expect(parseDecision({ approved: true, accounts: [A] })).toEqual({ approved: true, accounts: [A] });
    expect(parseDecision({ approved: true, account: A })).toEqual({ approved: true, account: A });
  });

  it('decodes base64 signatures of exactly 64 bytes', () => {
    const sigs = [sig(1), sig(2)];
    expect(parseDecision({ approved: true, signatures: sigs.map(b64) })).toEqual({ approved: true, signatures: sigs });
  });

  it('round-trips a decision with signatures through serializeDecision and JSON', () => {
    const d = { approved: true as const, account: A as string, signatures: Array.from({ length: 16 }, (_, i) => sig(i)) };
    expect(parseDecision(JSON.parse(JSON.stringify(serializeDecision(d))))).toEqual(d);
    expect(serializeDecision({ approved: false })).toEqual({ approved: false });
  });

  it.each([
    ['63-byte signature', [b64(new Uint8Array(63))]],
    ['65-byte signature', [b64(new Uint8Array(65))]],
    ['17 signatures', Array.from({ length: 17 }, () => b64(sig(1)))],
    ['empty list', []],
    ['not base64', ['!!!not-base64!!!']],
    ['a number', [5]],
    ['raw bytes object', [{ 0: 1 }]],
    ['not an array', b64(sig(1))],
  ])('rejects signatures: %s', (_n, signatures) => {
    expect(() => parseDecision({ approved: true, signatures })).toThrow();
  });

  it.each([null, 'yes', {}, { approved: 'true' }, { approved: true, accounts: 'x' }, { approved: true, accounts: ['nope'] }, { approved: true, account: 5 }])(
    'rejects %j',
    (raw) => {
      expect(() => parseDecision(raw)).toThrow();
    },
  );
});

describe('decision log', () => {
  const LOG = {
    summary: 'Send 1 SOL to Hx…3k',
    dangerRules: ['owner-change', 'unknown-program'],
    snapshot: { level: 'expert', summary: 'Send 1 SOL', balanceChanges: [{ owner: 'you', asset: 'SOL', amount: '-1' }] },
  } as const;
  const wire = (d: unknown) => JSON.parse(JSON.stringify(d));

  it('round-trips with a log on approve and on reject', () => {
    const approve = { approved: true as const, signatures: [sig(3)], log: LOG };
    expect(parseDecision(wire(serializeDecision(approve as never)))).toEqual(approve);
    const reject = { approved: false as const, log: { summary: 'Blocked site', snapshot: { ...LOG.snapshot, balanceChanges: null } } };
    expect(parseDecision(wire(serializeDecision(reject as never)))).toEqual(reject);
  });

  it('drops invalid fields without blocking the decision', () => {
    expect(parseDecision({ approved: false, log: 'nope' })).toEqual({ approved: false });
    expect(parseDecision({ approved: true, log: { summary: 5, dangerRules: ['Bad Rule!'], snapshot: { level: 'wizard', summary: 'x', balanceChanges: null } } })).toEqual({
      approved: true,
    });
    expect(parseDecision({ approved: true, log: { summary: 'ok', dangerRules: 'owner-change' } })).toEqual({ approved: true, log: { summary: 'ok' } });
    expect(
      parseDecision({ approved: true, log: { snapshot: { level: 'basic', summary: 'x', balanceChanges: [{ owner: 1, asset: 'SOL', amount: '1' }] } } }),
    ).toEqual({ approved: true });
  });

  it('trims oversize strings, strips control characters and drops oversize lists', () => {
    const d = parseDecision({
      approved: true,
      log: {
        summary: `a\u0000b\u001b[31m${'x'.repeat(400)}`,
        dangerRules: Array.from({ length: 33 }, () => 'rule'),
        snapshot: { level: 'basic', summary: 'y'.repeat(300), balanceChanges: Array.from({ length: 65 }, () => ({ owner: 'o', asset: 'a', amount: '1' })) },
      },
    });
    expect(d.log?.summary).toHaveLength(280);
    expect(d.log?.summary).toMatch(/^ab\[31mx+$/);
    expect(d.log?.dangerRules).toBeUndefined();
    expect(d.log?.snapshot).toBeUndefined();
    expect(parseDecision({ approved: true, log: { dangerRules: ['x'.repeat(65)] } })).toEqual({ approved: true });
    const long = parseDecision({ approved: true, log: { snapshot: { level: 'basic', summary: 'y'.repeat(300), balanceChanges: [{ owner: 'o'.repeat(129), asset: 'a', amount: '1' }] } } });
    expect(long.log?.snapshot).toEqual({ level: 'basic', summary: 'y'.repeat(280), balanceChanges: [{ owner: 'o'.repeat(128), asset: 'a', amount: '1' }] });
  });
});
