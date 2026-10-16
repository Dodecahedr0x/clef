import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  getTransactionDecoder,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachSignature, NotASignerError, transactionMessageBytes, verifyEd25519 } from '../src';
import { buildWire } from './helpers';

const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
let signer: KeyPairSigner;

beforeAll(async () => {
  signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(5));
});

const wire = (version: 'legacy' | 0) =>
  buildWire([getTransferSolInstruction({ source: createNoopSigner(signer.address), destination: OTHER, amount: 1n })], signer.address, version);

describe('verifyEd25519', () => {
  it('accepts a valid signature and rejects a wrong message or key', async () => {
    const msg = new TextEncoder().encode('hello');
    const sig = await signBytes(signer.keyPair.privateKey, msg);
    expect(await verifyEd25519(msg, sig, signer.address)).toBe(true);
    expect(await verifyEd25519(new TextEncoder().encode('hellp'), sig, signer.address)).toBe(false);
    expect(await verifyEd25519(msg, sig, OTHER)).toBe(false);
    expect(await verifyEd25519(msg, sig.slice(0, 63), signer.address)).toBe(false);
  });
});

describe.each(['legacy', 0] as const)('transactionMessageBytes/attachSignature (%s)', (version) => {
  it('round trips a hardware signature into the wire', async () => {
    const w = wire(version);
    const msg = transactionMessageBytes(w);
    expect(msg).toEqual(new Uint8Array(getTransactionDecoder().decode(w).messageBytes));
    const sig = await signBytes(signer.keyPair.privateKey, msg);
    const signed = attachSignature(w, signer.address, sig);
    const tx = getTransactionDecoder().decode(signed);
    expect(new Uint8Array(tx.signatures[signer.address]!)).toEqual(new Uint8Array(sig));
    expect(new Uint8Array(tx.messageBytes)).toEqual(msg);
    expect(await verifyEd25519(transactionMessageBytes(signed), tx.signatures[signer.address]!, signer.address)).toBe(true);
  });

  it('throws NotASignerError for a non-signer and rejects bad signature length', () => {
    const w = wire(version);
    expect(() => attachSignature(w, OTHER, new Uint8Array(64))).toThrow(NotASignerError);
    expect(() => attachSignature(w, signer.address, new Uint8Array(63))).toThrow();
  });
});
