import { readFileSync } from 'node:fs';
import { SignType, SolSignature, SolSignRequest } from '@keystonehq/bc-ur-registry-sol';
import { UREncoder } from '@ngraveio/bc-ur';
import { address, getAddressDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { HardwareError, keystoneSignRequest, parseKeystoneSignature, parseKeystoneSync, UrFrameDecoder, type UrPayload } from '../src';

const SYNC = readFileSync(new URL('./fixtures/keystone/sync.ur.txt', import.meta.url), 'utf8').trim();
const ADDR = getAddressDecoder().decode(new Uint8Array(32).fill(1));

function decodeAll(frames: string[]): UrPayload {
  const d = new UrFrameDecoder();
  for (const f of frames) d.receive(f);
  expect(d.isComplete()).toBe(true);
  expect(d.progress()).toBe(1);
  return d.result();
}

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

describe('UrFrameDecoder', () => {
  it('rejects non-UR frames', () => {
    expect(() => new UrFrameDecoder().receive('https://example.com')).toThrow(HardwareError);
  });

  it('reports partial progress on a multi-part UR', () => {
    const { frames } = keystoneSignRequest({ data: new Uint8Array(2000).fill(7), kind: 'transaction', path: "44'/501'/0'", xfp: 'f23f9fd2', address: ADDR, origin: 'Clef' });
    expect(frames.length).toBeGreaterThan(2);
    const d = new UrFrameDecoder();
    d.receive(frames[0]!);
    expect(d.isComplete()).toBe(false);
    expect(d.progress()).toBeGreaterThan(0);
    expect(d.progress()).toBeLessThan(1);
    expect(() => d.result()).toThrow(HardwareError);
  });
});

describe('parseKeystoneSync', () => {
  it('reads Solana accounts from a crypto-multi-accounts UR and skips other chains', () => {
    const sync = parseKeystoneSync(decodeAll([SYNC]));
    expect(sync.xfp).toBe('f23f9fd2');
    expect(sync.device).toBe('Keystone 3 Pro');
    expect(sync.accounts).toEqual([
      { address: ADDR, path: "44'/501'/0'", xfp: 'f23f9fd2' },
      { address: getAddressDecoder().decode(new Uint8Array(32).fill(2)), path: "44'/501'/0'/0'", xfp: 'f23f9fd2' },
    ]);
  });

  it('rejects other UR types', () => {
    expect(() => parseKeystoneSync({ type: 'sol-signature', cbor: new Uint8Array([0xa0]) })).toThrow(HardwareError);
  });
});

describe('keystoneSignRequest', () => {
  it.each([
    ['transaction', SignType.Transaction, 1500],
    ['message', SignType.Message, 20],
  ] as const)('frames decode back to the same sol-sign-request (%s)', (kind, signType, size) => {
    const data = Uint8Array.from({ length: size }, (_, i) => i % 251);
    const { requestId, frames } = keystoneSignRequest({ data, kind, path: "44'/501'/3'/0'", xfp: 'f23f9fd2', address: ADDR, origin: 'Clef' });
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const f of frames) expect(f).toMatch(/^UR:SOL-SIGN-REQUEST\//);
    const ur = decodeAll(frames);
    expect(ur.type).toBe('sol-sign-request');
    const req = SolSignRequest.fromCBOR(Buffer.from(ur.cbor));
    expect(new Uint8Array(req.getSignData())).toEqual(data);
    expect(req.getDerivationPath()).toBe("44'/501'/3'/0'");
    expect(req.getSignType()).toBe(signType);
    expect(req.getOrigin()).toBe('Clef');
    expect(Buffer.from(req.getRequestId()!).equals(uuidBytes(requestId))).toBe(true);
  });

  it('fresh request ids', () => {
    const p = { data: new Uint8Array([1]), kind: 'message' as const, path: "44'/501'/0'", xfp: 'f23f9fd2', address: address(ADDR), origin: 'Clef' };
    expect(keystoneSignRequest(p).requestId).not.toBe(keystoneSignRequest(p).requestId);
  });
});

describe('parseKeystoneSignature', () => {
  const sig = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => i));
  const id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const payload = (s: SolSignature): UrPayload => decodeAll([UREncoder.encodeSinglePart(s.toUR())]);

  it('returns the 64-byte signature for the matching request', () => {
    expect(parseKeystoneSignature(payload(new SolSignature(sig, uuidBytes(id))), id)).toEqual(new Uint8Array(sig));
  });

  it('throws on a mismatching or missing request id', () => {
    expect(() => parseKeystoneSignature(payload(new SolSignature(sig, uuidBytes('00000000-3b7d-4bad-9bdd-2b0d7b3dcb6d'))), id)).toThrow(HardwareError);
    expect(() => parseKeystoneSignature(payload(new SolSignature(sig)), id)).toThrow(HardwareError);
  });

  it('throws on a wrong type or a malformed signature', () => {
    expect(() => parseKeystoneSignature(decodeAll([SYNC]), id)).toThrow(HardwareError);
    expect(() => parseKeystoneSignature(payload(new SolSignature(sig.subarray(0, 63), uuidBytes(id))), id)).toThrow(HardwareError);
  });
});
