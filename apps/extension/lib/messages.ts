/** Port name used by the relay content script. */
export const DAPP_PORT = 'clef-dapp';

/** Relay -> background over the port. */
export type DappPortMessage = { type: 'request'; request: unknown };
/** Background -> relay over the port. */
export type DappPortReply = { type: 'response'; response: unknown } | { type: 'event'; accounts: string[] };

/** Extension page -> background via runtime.sendMessage. */
export type InternalMessage =
  | { channel: 'internal'; call: unknown }
  | { channel: 'approval'; op: 'get'; id: string }
  | { channel: 'approval'; op: 'decide'; id: string; decision: unknown };

export type InternalReply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** Page <-> relay window messages. */
export const INPAGE_SOURCE = 'clef-inpage';
export const RELAY_SOURCE = 'clef-relay';
