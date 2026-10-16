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
    proposal: new Uint8Array([6, 5]),
    signer: { kind: 'software' },
  },
] as ApprovalRequest[];

describe('approval serialization', () => {
  it.each(VARIANTS.map((r) => [`${r.kind}${r.phishing ? ' (phishing)' : ''}`, r] as const))('round-trips %s through JSON', (_n, req) => {
    const wire = JSON.parse(JSON.stringify(serializeApproval(req)));
    expect(JSON.stringify(wire)).not.toMatch(/"0":/); // no Uint8Array leaked as an index object
    expect(deserializeApproval(wire)).toEqual(req);
  });

  it('encodes bytes as base64 strings', () => {
    const s = serializeApproval(VARIANTS[6]!) as { inner: unknown; proposal: unknown };
    expect(s.inner).toBe('CQgH');
    expect(s.proposal).toBe('BgU=');
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
