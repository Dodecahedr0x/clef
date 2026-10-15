import { describe, expect, it } from 'vitest';
import { ERR, failure, parseRequest, ProtocolError } from '../src';

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const ok = (method: string, params: unknown) => ({ id: 'r1', method, params });

describe('parseRequest', () => {
  it('accepts well-formed requests and decodes bytes', () => {
    expect(parseRequest(ok('connect', { silent: true }))).toEqual({ id: 'r1', method: 'connect', params: { silent: true } });
    expect(parseRequest({ id: 'r1', method: 'connect' })).toEqual({ id: 'r1', method: 'connect', params: { silent: false } });
    const tx = parseRequest(ok('signTransaction', { account: A, chain: 'solana:mainnet', transactions: ['AQI='] }));
    expect(tx).toEqual({ id: 'r1', method: 'signTransaction', params: { account: A, chain: 'solana:mainnet', transactions: [new Uint8Array([1, 2])] } });
    expect(parseRequest(ok('signAndSendTransaction', { account: A, chain: 'solana:devnet', transaction: 'AQI=', skipPreflight: true }))).toMatchObject({
      params: { skipPreflight: true },
    });
    expect(parseRequest(ok('signMessage', { account: A, message: 'aGk=' }))).toMatchObject({ params: { message: new Uint8Array([104, 105]) } });
    expect(parseRequest(ok('signIn', { input: { statement: 'Welcome', resources: ['https://x.example'] } }))).toEqual({
      id: 'r1',
      method: 'signIn',
      params: { input: { statement: 'Welcome', resources: ['https://x.example'] } },
    });
  });

  it.each([
    ['non-object', 'connect'],
    ['unknown method', ok('eth_sign', {})],
    ['bad id', { id: 5, method: 'connect', params: {} }],
    ['huge id', { id: 'x'.repeat(65), method: 'connect', params: {} }],
    ['array params', ok('connect', [])],
    ['non-base64 tx', ok('signTransaction', { account: A, chain: 'solana:mainnet', transactions: ['%%%'] })],
    ['empty tx list', ok('signTransaction', { account: A, chain: 'solana:mainnet', transactions: [] })],
    ['bad account', ok('signMessage', { account: 'nope', message: 'AQI=' })],
    ['bad chain', ok('signTransaction', { account: A, chain: 'eip155:1', transactions: ['AQI='] })],
    ['too many txs', ok('signTransaction', { account: A, chain: 'solana:mainnet', transactions: Array(17).fill('AQI=') })],
    ['oversized tx', ok('signAndSendTransaction', { account: A, chain: 'solana:mainnet', transaction: 'A'.repeat(5600) })],
    ['oversized message', ok('signMessage', { account: A, message: 'A'.repeat(30000) })],
    ['unknown signIn field', ok('signIn', { input: { domain: 'x', evil: 1 } })],
    ['prototype-polluting signIn', ok('signIn', { input: JSON.parse('{"__proto__": {"polluted": true}}') })],
    ['bad signIn address', ok('signIn', { input: { address: 'nope' } })],
    ['non-string signIn field', ok('signIn', { input: { statement: 5 } })],
  ])('rejects %s', (_name, raw) => {
    let caught: unknown;
    try {
      parseRequest(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProtocolError);
    expect((caught as ProtocolError).code).toBe(ERR.INVALID_PARAMS);
  });
});

describe('failure', () => {
  it('passes protocol errors through and hides internal errors', () => {
    expect(failure('r', new ProtocolError(ERR.USER_REJECTED, 'User rejected the request'))).toEqual({
      id: 'r',
      ok: false,
      error: { code: 4001, message: 'User rejected the request' },
    });
    expect(failure('r', new Error('secret detail'))).toEqual({ id: 'r', ok: false, error: { code: ERR.INTERNAL, message: 'Internal error' } });
  });
});
