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
    expect(inspectMessage(utf8('Hello\nworld'), ORIGIN)).toEqual({ kind: 'text', text: 'Hello\nworld', marked: 0, looksLikeTransaction: false, danger: false });
    expect(inspectMessage(new Uint8Array([0, 1, 2]), ORIGIN)).toMatchObject({ kind: 'binary', hex: '000102', danger: false });
    expect(inspectMessage(new Uint8Array([0xff, 0xfe]), ORIGIN)).toMatchObject({ kind: 'binary', hex: 'fffe' });
  });

  it('shows bidi and invisible characters as markers instead of hiding them', () => {
    const r = inspectMessage(utf8('pay \u202eevil\u200b'), ORIGIN);
    expect(r).toMatchObject({ kind: 'text', text: 'pay ⟨U+202E⟩evil⟨U+200B⟩', marked: 2 });
  });

  it('keeps the whole message: long lines, indentation and tabs', () => {
    const long = 'x'.repeat(10_000);
    const r = inspectMessage(utf8(`  indented\n\ttabbed\n${long}`), ORIGIN);
    expect(r).toMatchObject({ kind: 'text', text: `  indented\n\ttabbed\n${long}`, marked: 0 });
  });

  it('shows a Sign In With Solana request as the exact message, resources included', () => {
    const msg = [
      'dapp.example wants you to sign in with your Solana account:',
      'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
      '',
      'Please sign in',
      '',
      'URI: https://dapp.example',
      'Version: 1',
      'Nonce: abcdefgh',
      'Issued At: 2026-10-16T10:00:00.000Z',
      'Resources:',
      '- https://dapp.example/terms',
    ].join('\n');
    const r = inspectMessage(utf8(msg), 'https://dapp.example');
    expect(r).toMatchObject({ kind: 'siws', domainMatches: true, text: msg });
  });
});
