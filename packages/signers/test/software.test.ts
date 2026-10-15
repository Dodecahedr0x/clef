import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  getTransactionDecoder,
  verifySignature,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { NotASignerError, signMessageBytes, signTransactionWire } from '../src';
import { buildWire } from './helpers';

const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const KEY = new Uint8Array(32).fill(9);
let signer: KeyPairSigner;

beforeAll(async () => {
  signer = await createKeyPairSignerFromPrivateKeyBytes(KEY);
});

const transferFrom = (from: Address, to: Address) =>
  getTransferSolInstruction({ source: createNoopSigner(from), destination: to, amount: 1n });

describe.each(['legacy', 0, 1] as const)('signTransactionWire (version %s)', (version) => {
  it('fills exactly the signer slot with a valid signature', async () => {
    const wire = buildWire([transferFrom(signer.address, OTHER)], signer.address, version);
    const signed = getTransactionDecoder().decode(await signTransactionWire(wire, signer.address, new Uint8Array(KEY)));
    const sig = signed.signatures[signer.address];
    expect(sig).toBeTruthy();
    expect(await verifySignature(signer.keyPair.publicKey, sig!, signed.messageBytes)).toBe(true);
    expect(signed.messageBytes).toEqual(getTransactionDecoder().decode(wire).messageBytes);
  });

  it('keeps other signers untouched', async () => {
    // OTHER pays the fee, the signer authorizes a transfer: two required signers.
    const wire = buildWire([transferFrom(signer.address, OTHER)], OTHER, version);
    const signed = getTransactionDecoder().decode(await signTransactionWire(wire, signer.address, new Uint8Array(KEY)));
    expect(signed.signatures[OTHER]).toBeNull();
    expect(signed.signatures[signer.address]).toBeTruthy();
  });
});

describe('guards', () => {
  it('refuses when the account is not a required signer', async () => {
    const wire = buildWire([transferFrom(OTHER, signer.address)], OTHER, 0);
    await expect(signTransactionWire(wire, signer.address, new Uint8Array(KEY))).rejects.toBeInstanceOf(NotASignerError);
  });

  it('refuses when the key does not belong to the account', async () => {
    const wire = buildWire([transferFrom(signer.address, OTHER)], signer.address, 0);
    await expect(signTransactionWire(wire, signer.address, new Uint8Array(32).fill(1))).rejects.toThrow(/does not match/);
  });

  it('signs messages', async () => {
    const msg = new TextEncoder().encode('hello');
    const sig = await signMessageBytes(msg, signer.address, new Uint8Array(KEY));
    expect(await verifySignature(signer.keyPair.publicKey, sig, msg)).toBe(true);
  });
});
