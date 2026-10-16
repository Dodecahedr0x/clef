import {
  Buffer as BufferPolyfill,
  CryptoKeypath,
  CryptoMultiAccounts,
  PathComponent,
  SignType,
  SolSignature,
  SolSignRequest,
} from '@keystonehq/bc-ur-registry-sol';
import { URDecoder, UREncoder } from '@ngraveio/bc-ur';
import { getAddressDecoder, type Address } from '@solana/kit';
import { HardwareError } from './errors';

// @ngraveio/bc-ur and cbor-sync reference the global Buffer, which browsers lack.
globalThis.Buffer ??= BufferPolyfill as unknown as typeof globalThis.Buffer;

export type KeystoneAccount = { address: Address; path: string; xfp: string };
export type UrPayload = { type: string; cbor: Uint8Array };

const SOLANA_COIN_TYPE = 501;
const MAX_FRAGMENT_LENGTH = 400;

const toBuffer = (bytes: Uint8Array) => globalThis.Buffer.from(bytes);
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function uuidToBytes(id: string): Uint8Array {
  const hex = id.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new HardwareError('unknown', 'Invalid request id');
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}

/** Accumulates scanned QR frames (single-part or animated fountain-coded) into one UR. */
export class UrFrameDecoder {
  #decoder = new URDecoder();

  receive(frame: string): void {
    const text = frame.trim().toLowerCase();
    if (!text.startsWith('ur:')) throw new HardwareError('unknown', 'This QR code is not from a Keystone');
    try {
      this.#decoder.receivePart(text);
    } catch {
      throw new HardwareError('unknown', 'Unreadable Keystone QR code');
    }
  }

  progress(): number {
    if (this.isComplete()) return 1;
    return Math.min(Math.max(this.#decoder.estimatedPercentComplete(), 0), 0.99);
  }

  isComplete(): boolean {
    return Boolean(this.#decoder.isComplete());
  }

  result(): UrPayload {
    if (!this.#decoder.isComplete()) throw new HardwareError('unknown', 'QR code not fully scanned yet');
    if (!this.#decoder.isSuccess()) throw new HardwareError('unknown', `Keystone QR code is corrupt: ${this.#decoder.resultError()}`);
    const ur = this.#decoder.resultUR();
    return { type: ur.type, cbor: new Uint8Array(ur.cbor) };
  }
}

export function parseKeystoneSync(ur: UrPayload): { xfp: string; device?: string; accounts: KeystoneAccount[] } {
  if (ur.type !== 'crypto-multi-accounts') throw new HardwareError('unknown', 'Not a Keystone account QR code');
  let multi: CryptoMultiAccounts;
  try {
    multi = CryptoMultiAccounts.fromCBOR(toBuffer(ur.cbor));
  } catch {
    throw new HardwareError('unknown', 'Unreadable Keystone account QR code');
  }
  const xfp = toHex(multi.getMasterFingerprint());
  const accounts: KeystoneAccount[] = [];
  for (const key of multi.getKeys()) {
    const origin = key.getOrigin();
    const components = origin?.getComponents() ?? [];
    if (components[1]?.getIndex() !== SOLANA_COIN_TYPE) continue;
    const bytes = key.getKey();
    if (bytes.length !== 32) continue;
    const source = origin.getSourceFingerprint();
    accounts.push({
      address: getAddressDecoder().decode(new Uint8Array(bytes)),
      path: origin.getPath(),
      xfp: source && source.length > 0 ? toHex(source) : xfp,
    });
  }
  return { xfp, device: multi.getDevice() || undefined, accounts };
}

/**
 * Builds the animated QR frames for a sol-sign-request. `address` is accepted for the caller's
 * bookkeeping but not sent: Keystone's own Solana keyring omits it and identifies the key by path + xfp.
 */
export function keystoneSignRequest(p: {
  data: Uint8Array;
  kind: 'transaction' | 'message';
  path: string;
  xfp: string;
  address: Address;
  origin: string;
}): { requestId: string; frames: string[] } {
  if (!/^[0-9a-f]{8}$/i.test(p.xfp)) throw new HardwareError('unknown', 'Invalid Keystone fingerprint');
  const components = p.path
    .replace(/^m\//i, '')
    .split('/')
    .map((c) => {
      const hardened = c.endsWith("'");
      const index = Number(hardened ? c.slice(0, -1) : c);
      if (!Number.isInteger(index) || index < 0) throw new HardwareError('unknown', `Invalid derivation path ${p.path}`);
      return new PathComponent({ index, hardened });
    });
  const requestId = crypto.randomUUID();
  const request = new SolSignRequest({
    requestId: toBuffer(uuidToBytes(requestId)),
    signData: toBuffer(p.data),
    derivationPath: new CryptoKeypath(components, globalThis.Buffer.from(p.xfp, 'hex')),
    origin: p.origin,
    signType: p.kind === 'transaction' ? SignType.Transaction : SignType.Message,
  });
  const encoder = new UREncoder(request.toUR(), MAX_FRAGMENT_LENGTH);
  const frames =
    encoder.fragmentsLength === 1
      ? [UREncoder.encodeSinglePart(request.toUR())]
      : Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart());
  return { requestId, frames: frames.map((f) => f.toUpperCase()) };
}

/** Extracts the signature from a scanned sol-signature UR; the caller still verifies it with verifyEd25519. */
export function parseKeystoneSignature(ur: UrPayload, requestId: string): Uint8Array {
  if (ur.type !== 'sol-signature') throw new HardwareError('unknown', 'Not a Keystone signature QR code');
  let sig: SolSignature;
  try {
    sig = SolSignature.fromCBOR(toBuffer(ur.cbor));
  } catch {
    throw new HardwareError('unknown', 'Unreadable Keystone signature QR code');
  }
  const id = sig.getRequestId();
  if (!id || toHex(id) !== toHex(uuidToBytes(requestId))) {
    throw new HardwareError('unknown', 'This signature belongs to a different request. Scan the QR code for the current request.');
  }
  const signature = sig.getSignature();
  if (signature.length !== 64) throw new HardwareError('unknown', 'Keystone returned a malformed signature');
  return new Uint8Array(signature);
}
