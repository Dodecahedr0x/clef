import { getTransactionDecoder } from '@solana/kit';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { describe, expect, it } from 'vitest';
import { inspectMessage } from '../src';
import { sampleWire } from './helpers';

const ORIGIN = 'https://dapp.example';
const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('inspectMessage', () => {
  it('recognises SIWS and checks the domain against the origin', () => {
    const good = createSignInMessage({ domain: 'dapp.example', address: A, statement: 'Welcome' });
    expect(inspectMessage(good, ORIGIN)).toMatchObject({ kind: 'siws', domain: 'dapp.example', domainMatches: true, danger: false });
    const phish = createSignInMessage({ domain: 'other.example', address: A });
    expect(inspectMessage(phish, ORIGIN)).toMatchObject({ kind: 'siws', domainMatches: false, danger: true });
  });

  it('compares the domain including the port', () => {
    const msg = createSignInMessage({ domain: 'localhost:3000', address: A });
    expect(inspectMessage(msg, 'http://localhost:3000')).toMatchObject({ domainMatches: true });
    expect(inspectMessage(msg, 'http://localhost:4000')).toMatchObject({ domainMatches: false });
  });

  it('flags messages that are actually transactions or transaction messages', () => {
    const wire = sampleWire();
    expect(inspectMessage(wire, ORIGIN)).toMatchObject({ looksLikeTransaction: true, danger: true });
    const messageBytes = new Uint8Array(getTransactionDecoder().decode(wire).messageBytes);
    expect(inspectMessage(messageBytes, ORIGIN)).toMatchObject({ looksLikeTransaction: true, danger: true });
  });

  it('shows printable text and hex for binary', () => {
    expect(inspectMessage(utf8('Hello\nworld'), ORIGIN)).toEqual({ kind: 'text', text: 'Hello\nworld', looksLikeTransaction: false, danger: false });
    expect(inspectMessage(new Uint8Array([0, 1, 2]), ORIGIN)).toMatchObject({ kind: 'binary', hex: '000102', danger: false });
    expect(inspectMessage(new Uint8Array([0xff, 0xfe]), ORIGIN)).toMatchObject({ kind: 'binary', hex: 'fffe' });
  });

  it('strips bidi and control characters from displayed text', () => {
    const r = inspectMessage(utf8('pay \u202eevil\u200b'), ORIGIN);
    expect(r).toMatchObject({ kind: 'text', text: 'pay evil' });
  });
});
