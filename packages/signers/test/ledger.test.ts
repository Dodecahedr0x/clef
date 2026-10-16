import { getBase58Decoder } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HardwareError } from '../src/errors';
import { LEDGER_PATH, LedgerDevice, type LedgerRuntime, type LedgerSigner } from '../src/ledger';

const ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIG = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
const b58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);

type Emission = { state: unknown } | { throw: unknown };

/** Minimal stand-in for a DMK device action: replays emissions synchronously on subscribe. */
function action(...emissions: Emission[]) {
  const cancel = vi.fn();
  return {
    cancel,
    observable: {
      subscribe(o: { next(v: unknown): void; error(e: unknown): void; complete(): void }) {
        for (const e of emissions) {
          if ('throw' in e) return o.error(e.throw), { unsubscribe() {} };
          o.next(e.state);
        }
        o.complete();
        return { unsubscribe() {} };
      },
    },
  };
}
const pending = { state: { status: 'pending', intermediateValue: { requiredUserInteraction: 'sign-transaction' } } };
const done = (output: unknown) => action(pending, { state: { status: 'completed', output } });
const failed = (error: unknown) => action(pending, { state: { status: 'error', error } });

function fakeSigner(over: Partial<Record<keyof LedgerSigner, unknown>> = {}) {
  const s = {
    getAddress: vi.fn(() => done(ADDR)),
    getAppConfiguration: vi.fn(() => done({ version: '1.10.2', blindSigningEnabled: false, pubKeyDisplayMode: 0 })),
    signTransaction: vi.fn(() => done(SIG)),
    signMessage: vi.fn(() => done({ signature: b58(SIG) })),
    ...over,
  };
  return { s, device: LedgerDevice.fromSigner(s as unknown as LedgerSigner) };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HardwareError);
  return (e as HardwareError).code;
}

describe('LEDGER_PATH', () => {
  it('formats legacy and standard paths', () => {
    expect(LEDGER_PATH.legacy(0)).toBe("44'/501'/0'");
    expect(LEDGER_PATH.standard(0)).toBe("44'/501'/0'/0'");
    expect(LEDGER_PATH.standard(3)).toBe("44'/501'/3'/0'");
  });
});

describe('LedgerDevice', () => {
  it.each([LEDGER_PATH.legacy(0), LEDGER_PATH.standard(0)])('getAddress(%s)', async (path) => {
    const { s, device } = fakeSigner();
    expect(await device.getAddress(path)).toBe(ADDR);
    expect(s.getAddress).toHaveBeenCalledWith(path, { checkOnDevice: false });
    await device.getAddress(path, { display: true });
    expect(s.getAddress).toHaveBeenLastCalledWith(path, { checkOnDevice: true });
  });

  it('getAddress rejects a malformed address', async () => {
    const { device } = fakeSigner({ getAddress: () => done('not-an-address') });
    expect(await codeOf(device.getAddress(LEDGER_PATH.legacy(0)))).toBe('unknown');
  });

  it('getAppConfig', async () => {
    const { device } = fakeSigner();
    expect(await device.getAppConfig()).toEqual({ version: '1.10.2', blindSigningEnabled: false });
  });

  it('signTransaction returns the 64-byte signature', async () => {
    const { s, device } = fakeSigner();
    const msg = new Uint8Array([1, 2, 3]);
    const sig = await device.signTransaction(LEDGER_PATH.standard(0), msg);
    expect(sig).toEqual(SIG);
    expect(sig).toHaveLength(64);
    expect(s.signTransaction).toHaveBeenCalledWith(LEDGER_PATH.standard(0), msg);
  });

  it('signTransaction rejects a signature of the wrong length', async () => {
    const { device } = fakeSigner({ signTransaction: () => done(new Uint8Array(63)) });
    expect(await codeOf(device.signTransaction(LEDGER_PATH.legacy(0), new Uint8Array(1)))).toBe('unknown');
  });

  it('signMessage returns a plain 64-byte signature', async () => {
    const { s, device } = fakeSigner();
    const msg = new TextEncoder().encode('hello');
    expect(await device.signMessage(LEDGER_PATH.legacy(0), msg)).toEqual(SIG);
    expect(s.signMessage).toHaveBeenCalledWith(LEDGER_PATH.legacy(0), msg, undefined);
  });

  it('signMessage strips the off-chain envelope', async () => {
    const ocm = new Uint8Array([0xff, ...new TextEncoder().encode('solana offchain'), 0, 9, 9, 9]);
    const envelope = new Uint8Array([1, ...SIG, ...ocm]);
    const { device } = fakeSigner({ signMessage: () => done({ signature: b58(envelope) }) });
    expect(await device.signMessage(LEDGER_PATH.legacy(0), new Uint8Array([9]))).toEqual(SIG);
    const off = await device.signOffchainMessage(LEDGER_PATH.legacy(0), new Uint8Array([9]));
    expect(off.signature).toEqual(SIG);
    expect(off.signedMessage).toEqual(ocm);
  });

  const exchange = (errorCode: string, tag = 'SolanaAppCommandError') => ({ _tag: tag, errorCode, message: 'x' });
  const unknownSw = (errorCode: string) => ({
    _tag: 'UnknownDeviceExchangeError',
    originalError: { message: 'UnknownError', errorCode },
    message: 'Unexpected device exchange error happened.',
  });

  it.each([
    ['0x6808 blind signing (unknown SW wrapper)', unknownSw('6808'), 'blind-signing-required'],
    ['0x6985 user refusal', exchange('6985'), 'rejected'],
    ['RefusedByUserDAError', { _tag: 'RefusedByUserDAError' }, 'rejected'],
    ['0x5515 locked', exchange('5515', 'DeviceLockedError'), 'locked'],
    ['DeviceLockedError DA', { _tag: 'DeviceLockedError' }, 'locked'],
    ['0x6e00 app not open', exchange('6e00', 'DeviceInternalError'), 'app-not-open'],
    ['0x6d00 app not open', exchange('6d00'), 'app-not-open'],
    ['0x6a83 app not open', unknownSw('6a83'), 'app-not-open'],
    ['0x6511 app not open', unknownSw('6511'), 'app-not-open'],
    ['numeric SW', { _tag: 'X', errorCode: 0x6985 }, 'rejected'],
    ['DisconnectError', { _tag: 'DisconnectError' }, 'disconnected'],
    ['DeviceDisconnectedWhileSendingError', { _tag: 'DeviceDisconnectedWhileSendingError' }, 'disconnected'],
    ['timeout', { _tag: 'SendApduTimeoutError' }, 'timeout'],
    ['unknown SW', unknownSw('6a80'), 'unknown'],
    ['garbage', 'boom', 'unknown'],
  ])('maps %s', async (_name, error, code) => {
    const { device } = fakeSigner({ signTransaction: () => failed(error) });
    expect(await codeOf(device.signTransaction(LEDGER_PATH.legacy(0), new Uint8Array(1)))).toBe(code);
  });

  it('maps a disconnect thrown by the observable', async () => {
    const { device } = fakeSigner({
      signMessage: () => action(pending, { throw: { _tag: 'DeviceDisconnectedWhileSendingError' } }),
    });
    expect(await codeOf(device.signMessage(LEDGER_PATH.legacy(0), new Uint8Array([1])))).toBe('disconnected');
  });

  it('a stream that completes without output is an error', async () => {
    const { device } = fakeSigner({ getAddress: () => action(pending) });
    expect(await codeOf(device.getAddress(LEDGER_PATH.legacy(0)))).toBe('unknown');
  });

  it('close() runs the session close hook once', async () => {
    const onClose = vi.fn(async () => {});
    const device = LedgerDevice.fromSigner(fakeSigner().s as unknown as LedgerSigner, onClose);
    await device.close();
    await device.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await codeOf(device.getAddress(LEDGER_PATH.legacy(0)))).toBe('disconnected');
  });
});

function fakeRuntime(over: Partial<LedgerRuntime['dmk']> = {}) {
  const signer = fakeSigner().s as unknown as LedgerSigner;
  const dmk = {
    startDiscovering: vi.fn(() => action({ state: { id: 'dev1' } }).observable),
    listenToAvailableDevices: vi.fn(() => action({ state: [] }, { state: [{ id: 'dev1' }] }).observable),
    connect: vi.fn(async () => 'session-1'),
    disconnect: vi.fn(async () => {}),
    ...over,
  };
  const runtime: LedgerRuntime = { dmk, transport: 'WEB-HID', buildSigner: vi.fn(() => signer) };
  return { runtime, dmk };
}

describe('LedgerDevice.request / reconnect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('without WebHID -> unsupported', async () => {
    vi.stubGlobal('navigator', {});
    expect(await codeOf(LedgerDevice.request())).toBe('unsupported');
    expect(await codeOf(LedgerDevice.reconnect())).toBe('unsupported');
  });

  it('connects the chosen device and disconnects on close', async () => {
    vi.stubGlobal('navigator', { hid: {} });
    const { runtime, dmk } = fakeRuntime();
    const device = await LedgerDevice.request(runtime);
    expect(dmk.startDiscovering).toHaveBeenCalledWith({ transport: 'WEB-HID' });
    expect(dmk.connect).toHaveBeenCalledWith({ device: { id: 'dev1' } });
    expect(runtime.buildSigner).toHaveBeenCalledWith('session-1');
    expect(await device.getAddress(LEDGER_PATH.legacy(0))).toBe(ADDR);
    await device.close();
    expect(dmk.disconnect).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('cancelled chooser -> no-device', async () => {
    vi.stubGlobal('navigator', { hid: {} });
    const { runtime } = fakeRuntime({
      startDiscovering: () => action({ throw: { _tag: 'NoAccessibleDeviceError' } }).observable,
    });
    expect(await codeOf(LedgerDevice.request(runtime))).toBe('no-device');
    const empty = fakeRuntime({ startDiscovering: () => action().observable });
    expect(await codeOf(LedgerDevice.request(empty.runtime))).toBe('no-device');
  });

  it('reconnect uses a previously granted device without the chooser', async () => {
    vi.stubGlobal('navigator', { hid: {} });
    const { runtime, dmk } = fakeRuntime();
    const device = await LedgerDevice.reconnect(runtime);
    expect(device).toBeInstanceOf(LedgerDevice);
    expect(dmk.startDiscovering).not.toHaveBeenCalled();
    expect(dmk.connect).toHaveBeenCalledWith({ device: { id: 'dev1' } });
  });

  it('reconnect returns null when nothing was granted', async () => {
    vi.stubGlobal('navigator', { hid: {} });
    vi.useFakeTimers();
    const pendingForever = { subscribe: (o: { next(v: unknown): void }) => (o.next([]), { unsubscribe() {} }) };
    const { runtime, dmk } = fakeRuntime({ listenToAvailableDevices: () => pendingForever });
    const p = LedgerDevice.reconnect(runtime);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
    expect(dmk.connect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
