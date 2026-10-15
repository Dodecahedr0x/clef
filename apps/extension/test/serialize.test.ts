import type { ApprovalRequest } from '@clef/wallet-core';
import { describe, expect, it } from 'vitest';
import { deserializeApproval, parseDecision, serializeApproval } from '../lib/serialize';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('approval serialization', () => {
  it.each<ApprovalRequest>([
    { kind: 'connect', origin: 'https://d.example' },
    { kind: 'signTransactions', origin: 'https://d.example', account: A as never, chain: 'solana:mainnet', transactions: [new Uint8Array([1, 2])], send: true },
    { kind: 'signMessage', origin: 'https://d.example', account: A as never, message: new Uint8Array([104, 105]) },
    { kind: 'signIn', origin: 'https://d.example', account: null, input: { domain: 'd.example', statement: 'hi' } },
  ])('round-trips %s through JSON', (req) => {
    expect(deserializeApproval(JSON.parse(JSON.stringify(serializeApproval(req))))).toEqual(req);
  });
});

describe('parseDecision', () => {
  it('accepts rejections and well-formed approvals', () => {
    expect(parseDecision({ approved: false })).toEqual({ approved: false });
    expect(parseDecision({ approved: true })).toEqual({ approved: true });
    expect(parseDecision({ approved: true, accounts: [A] })).toEqual({ approved: true, accounts: [A] });
    expect(parseDecision({ approved: true, account: A })).toEqual({ approved: true, account: A });
  });

  it.each([null, 'yes', {}, { approved: 'true' }, { approved: true, accounts: 'x' }, { approved: true, accounts: ['nope'] }, { approved: true, account: 5 }])(
    'rejects %j',
    (raw) => {
      expect(() => parseDecision(raw)).toThrow();
    },
  );
});
