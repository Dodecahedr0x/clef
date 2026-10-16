import type { DeviceActionLike, Subscribable } from './action';

/** The subset of `SignerSolana` LedgerDevice drives. */
export interface LedgerSigner {
  getAddress(path: string, opts?: { checkOnDevice?: boolean }): DeviceActionLike<string>;
  getAppConfiguration(): DeviceActionLike<{ version: string; blindSigningEnabled: boolean }>;
  signTransaction(path: string, transaction: Uint8Array): DeviceActionLike<Uint8Array>;
  signMessage(path: string, message: Uint8Array, opts?: undefined): DeviceActionLike<{ signature: string }>;
}

/** The subset of `DeviceManagementKit` used to find and open a session. Device objects are opaque. */
export interface LedgerDmk {
  startDiscovering(args: { transport?: string }): Subscribable<object>;
  listenToAvailableDevices(args: { transport?: string }): Subscribable<object[]>;
  connect(args: { device: never }): Promise<string>;
  disconnect(args: { sessionId: string }): Promise<void>;
}

export interface LedgerRuntime {
  dmk: LedgerDmk;
  transport: string;
  buildSigner(sessionId: string): LedgerSigner;
}

let shared: Promise<LedgerRuntime> | undefined;

/** One DMK per page: each instance registers its own WebHID listeners. Imports stay lazy so Node can load this module. */
export function defaultRuntime(): Promise<LedgerRuntime> {
  shared ??= (async () => {
    const [{ DeviceManagementKitBuilder }, { webHidTransportFactory, webHidIdentifier }, { SignerSolanaBuilder }] = await Promise.all([
      import('@ledgerhq/device-management-kit'),
      import('@ledgerhq/device-transport-kit-web-hid'),
      import('@ledgerhq/device-signer-kit-solana'),
    ]);
    const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
    const runtime: LedgerRuntime = {
      dmk: dmk satisfies LedgerDmk,
      transport: webHidIdentifier,
      buildSigner: (sessionId) => new SignerSolanaBuilder({ dmk, sessionId }).build() satisfies LedgerSigner,
    };
    return runtime;
  })();
  shared.catch(() => (shared = undefined));
  return shared;
}
