import { address, getBase58Encoder, isAddress, type Address } from '@solana/kit';
import { HardwareError } from './errors';
import { firstValue, runAction } from './ledger/action';
import { toHardwareError } from './ledger/errors';
import { defaultRuntime, type LedgerRuntime, type LedgerSigner } from './ledger/runtime';

export type { LedgerDmk, LedgerRuntime, LedgerSigner } from './ledger/runtime';

export const LEDGER_PATH = {
  legacy: (i: number) => `44'/501'/${i}'`,
  standard: (i: number) => `44'/501'/${i}'/0'`,
};

const RECONNECT_WAIT_MS = 1500;

function requireWebHid(): void {
  if (typeof navigator === 'undefined' || !('hid' in navigator) || !navigator.hid) {
    throw new HardwareError('unsupported', 'WebHID is not available in this browser');
  }
}

export class LedgerDevice {
  private closed = false;

  private constructor(
    private readonly signer: LedgerSigner,
    private readonly onClose: () => Promise<void>,
  ) {}

  /** Test seam and escape hatch: wrap an already-built signer. */
  static fromSigner(signer: LedgerSigner, onClose: () => Promise<void> = async () => {}): LedgerDevice {
    return new LedgerDevice(signer, onClose);
  }

  /** Opens the WebHID chooser; must run inside a user gesture. */
  static async request(runtime?: LedgerRuntime): Promise<LedgerDevice> {
    requireWebHid();
    const rt = runtime ?? (await defaultRuntime());
    let device: object;
    try {
      device = await firstValue(rt.dmk.startDiscovering({ transport: rt.transport }));
    } catch (e) {
      const err = toHardwareError(e);
      throw err.code === 'unknown' ? new HardwareError('no-device', err.message) : err;
    }
    return LedgerDevice.open(rt, device);
  }

  /** Reopens a device the user granted earlier, without a chooser; null if none is plugged in. */
  static async reconnect(runtime?: LedgerRuntime): Promise<LedgerDevice | null> {
    requireWebHid();
    const rt = runtime ?? (await defaultRuntime());
    let devices: object[];
    try {
      devices = await firstValue(rt.dmk.listenToAvailableDevices({ transport: rt.transport }), (d) => d.length > 0, RECONNECT_WAIT_MS);
    } catch {
      return null;
    }
    return LedgerDevice.open(rt, devices[0]!);
  }

  private static async open(rt: LedgerRuntime, device: object): Promise<LedgerDevice> {
    let sessionId: string;
    try {
      sessionId = await rt.dmk.connect({ device: device as never });
    } catch (e) {
      throw toHardwareError(e);
    }
    return new LedgerDevice(rt.buildSigner(sessionId), () => rt.dmk.disconnect({ sessionId }));
  }

  private live(): LedgerSigner {
    if (this.closed) throw new HardwareError('disconnected', 'Ledger session is closed');
    return this.signer;
  }

  async getAddress(path: string, opts?: { display?: boolean }): Promise<Address> {
    const out = await runAction(this.live().getAddress(path, { checkOnDevice: opts?.display ?? false }));
    if (!isAddress(out)) throw new HardwareError('unknown', `Ledger returned an invalid address: ${out}`);
    return address(out);
  }

  async getAppConfig(): Promise<{ version: string; blindSigningEnabled: boolean }> {
    const { version, blindSigningEnabled } = await runAction(this.live().getAppConfiguration());
    return { version, blindSigningEnabled };
  }

  /** `messageBytes` is the transaction message (or full wire tx); returns the 64-byte ed25519 signature. */
  async signTransaction(path: string, messageBytes: Uint8Array): Promise<Uint8Array> {
    const sig = await runAction(this.live().signTransaction(path, messageBytes));
    if (sig.length !== 64) throw new HardwareError('unknown', `Ledger returned a ${sig.length}-byte signature`);
    return new Uint8Array(sig);
  }

  /** Returns the 64-byte signature only. The device signs the off-chain message wrapping `message`, see signOffchainMessage. */
  async signMessage(path: string, message: Uint8Array): Promise<Uint8Array> {
    return (await this.signOffchainMessage(path, message)).signature;
  }

  /**
   * The Solana app signs an off-chain message (header + `message`), not the raw bytes.
   * `signedMessage` is the exact payload signed, or null when the kit returned a bare signature.
   */
  async signOffchainMessage(path: string, message: Uint8Array): Promise<{ signature: Uint8Array; signedMessage: Uint8Array | null }> {
    const { signature } = await runAction(this.live().signMessage(path, message, undefined));
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(getBase58Encoder().encode(signature));
    } catch {
      throw new HardwareError('unknown', 'Ledger returned a malformed signature');
    }
    if (bytes.length === 64) return { signature: bytes, signedMessage: null };
    // Envelope: [signature count = 1][64-byte signature][off-chain message]
    if (bytes.length > 65 && bytes[0] === 1) return { signature: bytes.slice(1, 65), signedMessage: bytes.slice(65) };
    throw new HardwareError('unknown', `Ledger returned an unexpected ${bytes.length}-byte signature envelope`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.onClose();
    } catch {
      // already gone
    }
  }
}
