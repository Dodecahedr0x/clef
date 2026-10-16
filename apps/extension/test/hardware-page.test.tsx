import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class HardwareError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  const legacy = (i: number) => `44'/501'/${i}'`;
  const standard = (i: number) => `44'/501'/${i}'/0'`;
  return {
    HardwareError,
    LEDGER_PATH: { legacy, standard },
    call: vi.fn(),
    getBalance: vi.fn(),
    request: vi.fn(),
    device: { getAddress: vi.fn(), getAppConfig: vi.fn(), close: vi.fn() },
    parseKeystoneSync: vi.fn(),
    frames: [] as string[],
    scan: null as null | ((result: { getText(): string } | undefined, error?: unknown) => void),
    stop: vi.fn(),
    decodeFromVideoDevice: vi.fn(),
  };
});

vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('../lib/clients', () => ({ createClients: () => ({ portfolio: { getBalance: h.getBalance } }) }));
vi.mock('@clef/signers', () => ({
  HardwareError: h.HardwareError,
  LEDGER_PATH: h.LEDGER_PATH,
  LedgerDevice: { request: h.request },
  parseKeystoneSync: h.parseKeystoneSync,
  UrFrameDecoder: class {
    receive(f: string) {
      if (!f.startsWith('ur:')) throw new h.HardwareError('unknown', 'This QR code is not from a Keystone');
      h.frames.push(f);
    }
    progress() {
      return Math.min(h.frames.length / 3, 1);
    }
    isComplete() {
      return h.frames.length >= 3;
    }
    result() {
      return { type: 'crypto-multi-accounts', cbor: new Uint8Array([1]) };
    }
  },
}));
vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice(...args: unknown[]) {
      return h.decodeFromVideoDevice(...args);
    }
  },
}));

import { HardwareApp } from '../entrypoints/hardware/HardwareApp';

const A = (n: number, scheme: string) => `${scheme === 'legacy' ? 'Leg' : 'Std'}${n}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxQ`.slice(0, 44);
const RPC_STATE = {
  hasVault: true,
  unlocked: true,
  accounts: [],
  permissions: [],
  activeAccount: null,
  errorReportsAvailable: false,
  settings: { network: 'mainnet', rpcUrl: 'http://rpc.test' },
};
const close = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  h.frames = [];
  h.scan = null;
  vi.stubGlobal('close', close);
  h.call.mockImplementation(async (c: { type: string }) => (c.type === 'state' ? RPC_STATE : {}));
  h.getBalance.mockImplementation(async (a: string) => (a === A(0, 'legacy') ? 2_890_000_000n : 0n));
  h.device.getAppConfig.mockResolvedValue({ version: '1.4.0', blindSigningEnabled: false });
  h.device.getAddress.mockImplementation(async (path: string) => {
    const m = /^44'\/501'\/(\d+)'(\/0')?$/.exec(path)!;
    return A(Number(m[1]), m[2] ? 'standard' : 'legacy');
  });
  h.device.close.mockResolvedValue(undefined);
  h.request.mockResolvedValue(h.device);
  h.decodeFromVideoDevice.mockImplementation(async (_d: unknown, _v: unknown, cb: typeof h.scan) => {
    h.scan = cb;
    return { stop: h.stop };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

describe('Ledger connect', () => {
  async function connect() {
    const user = userEvent.setup();
    render(<HardwareApp kind="ledger" />);
    expect(screen.getByRole('heading', { name: 'Connect Ledger' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect Ledger' }));
    await screen.findByText('Ledger connected');
    await screen.findByText(short(A(2, 'legacy')));
    return user;
  }

  it('lists legacy addresses with balances, switches scheme, adds the selected accounts', async () => {
    const user = await connect();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('USB · Solana app open')).toBeTruthy();
    for (let i = 0; i < 3; i++) expect(h.device.getAddress).toHaveBeenCalledWith(h.LEDGER_PATH.legacy(i));
    await screen.findByText('2.89 SOL');
    expect(screen.getAllByText('empty')).toHaveLength(2);

    // Account 0 is preselected.
    expect(screen.getByRole('button', { name: 'Add 1 account' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: new RegExp(short(A(2, 'legacy'))) }));
    expect(screen.getByRole('button', { name: 'Add 2 accounts' })).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: "44'/501'/n'/0'" }));
    await screen.findByText(short(A(0, 'standard')));
    for (let i = 0; i < 3; i++) expect(h.device.getAddress).toHaveBeenCalledWith(h.LEDGER_PATH.standard(i));
    await user.click(screen.getByRole('checkbox', { name: new RegExp(short(A(1, 'standard'))) }));

    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText(short(A(5, 'standard')));
    expect(h.device.getAddress).toHaveBeenCalledWith(h.LEDGER_PATH.standard(5));

    await user.click(screen.getByRole('button', { name: 'Add 3 accounts' }));
    await screen.findByText(/3 accounts added/);
    const adds = h.call.mock.calls.map((c) => c[0]).filter((c) => c.type === 'accounts:addHardware');
    expect(adds).toEqual([
      { type: 'accounts:addHardware', kind: 'ledger', address: A(0, 'legacy'), path: h.LEDGER_PATH.legacy(0) },
      { type: 'accounts:addHardware', kind: 'ledger', address: A(2, 'legacy'), path: h.LEDGER_PATH.legacy(2) },
      { type: 'accounts:addHardware', kind: 'ledger', address: A(1, 'standard'), path: h.LEDGER_PATH.standard(1) },
    ]);
    expect(h.device.close).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(close).toHaveBeenCalled();
  });

  it.each([
    ['locked', /Ledger is locked/],
    ['app-not-open', /Open the Solana app/],
    ['no-device', /No Ledger selected/],
    ['rejected', /rejected on the device/],
    ['unsupported', /can.t reach USB devices/],
  ])('maps HardwareError %s to readable copy', async (code, copy) => {
    h.request.mockRejectedValueOnce(new h.HardwareError(code, 'raw'));
    const user = userEvent.setup();
    render(<HardwareApp kind="ledger" />);
    await user.click(screen.getByRole('button', { name: 'Connect Ledger' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(copy);
    expect(screen.getByRole('button', { name: 'Connect Ledger' })).toBeTruthy();
  });

  it('shows app-not-open when the Solana app config cannot be read', async () => {
    h.device.getAppConfig.mockRejectedValueOnce(new h.HardwareError('app-not-open', 'raw'));
    const user = userEvent.setup();
    render(<HardwareApp kind="ledger" />);
    await user.click(screen.getByRole('button', { name: 'Connect Ledger' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Open the Solana app/);
  });

  it('Back closes the tab', async () => {
    const user = userEvent.setup();
    render(<HardwareApp kind="ledger" />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(close).toHaveBeenCalled();
  });
});

describe('Keystone connect', () => {
  const KS = [
    { address: A(0, 'legacy'), path: "m/44'/501'/0'", xfp: 'f23f9fd2' },
    { address: A(1, 'legacy'), path: "m/44'/501'/1'", xfp: 'f23f9fd2' },
  ];

  it('scans animated frames, lists accounts and adds them', async () => {
    h.parseKeystoneSync.mockReturnValue({ xfp: 'f23f9fd2', device: 'Keystone 3 Pro', accounts: KS });
    const user = userEvent.setup();
    render(<HardwareApp kind="keystone" />);
    expect(screen.getByRole('heading', { name: 'Connect Keystone' })).toBeTruthy();
    await waitFor(() => expect(h.scan).not.toBeNull());
    expect(h.decodeFromVideoDevice.mock.calls[0]![0]).toBeUndefined();
    expect(h.decodeFromVideoDevice.mock.calls[0]![1]).toBeInstanceOf(HTMLVideoElement);
    expect(screen.getByText('Camera on')).toBeTruthy();

    act(() => h.scan!(undefined, new Error('NotFoundException')));
    act(() => h.scan!({ getText: () => 'UR:CRYPTO-MULTI-ACCOUNTS/1-3/abc' }));
    expect(h.frames).toEqual(['ur:crypto-multi-accounts/1-3/abc']);
    expect(await screen.findByText(/33%/)).toBeTruthy();
    act(() => h.scan!({ getText: () => 'ur:crypto-multi-accounts/2-3/def' }));
    act(() => h.scan!({ getText: () => 'ur:crypto-multi-accounts/3-3/ghi' }));

    await screen.findByText(short(A(1, 'legacy')));
    expect(h.stop).toHaveBeenCalled();
    expect(h.parseKeystoneSync).toHaveBeenCalledWith({ type: 'crypto-multi-accounts', cbor: new Uint8Array([1]) });
    expect(screen.getByText(/Keystone 3 Pro/)).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Add 2 accounts' }));
    await screen.findByText(/2 accounts added/);
    const adds = h.call.mock.calls.map((c) => c[0]).filter((c) => c.type === 'accounts:addHardware');
    expect(adds).toEqual(KS.map((k) => ({ type: 'accounts:addHardware', kind: 'keystone', address: k.address, path: k.path, xfp: k.xfp })));
  });

  it('ignores non-UR codes with a hint and reports camera denial', async () => {
    render(<HardwareApp kind="keystone" />);
    await waitFor(() => expect(h.scan).not.toBeNull());
    act(() => h.scan!({ getText: () => 'https://example.com' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/not from a Keystone/);
    cleanup();

    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    h.decodeFromVideoDevice.mockRejectedValueOnce(denied);
    render(<HardwareApp kind="keystone" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Camera access was denied/);
  });

  it('shows a readable error when the sync payload is invalid, and Cancel closes', async () => {
    h.parseKeystoneSync.mockImplementation(() => {
      throw new h.HardwareError('unknown', 'No Solana accounts in this Keystone QR code');
    });
    const user = userEvent.setup();
    render(<HardwareApp kind="keystone" />);
    await waitFor(() => expect(h.scan).not.toBeNull());
    for (const f of ['ur:a/1-3/x', 'ur:a/2-3/y', 'ur:a/3-3/z']) act(() => h.scan!({ getText: () => f }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/No Solana accounts/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
    expect(h.stop).toHaveBeenCalled();
  });
});

describe('HardwareApp kind', () => {
  it('rejects unknown kinds', () => {
    render(<HardwareApp kind={'trezor' as 'ledger'} />);
    expect(within(document.body).getByText(/Unknown device/)).toBeTruthy();
  });
});
