/** Port name used by the relay content script. */
export const DAPP_PORT = 'clef-dapp';
/** Port the side panel holds open: while it is connected, approvals show in the panel instead of a window. */
export const PANEL_PORT = 'clef-panel';
/** Background -> side panel. */
export type PanelMessage = { type: 'show'; id: string } | { type: 'done'; id: string };

/** Relay -> background over the port. */
export type DappPortMessage = { type: 'request'; request: unknown };
/** Background -> relay over the port. */
export type DappPortReply = { type: 'response'; response: unknown } | { type: 'event'; accounts: string[] };

/** Extension page -> background via runtime.sendMessage. */
export type InternalMessage =
  | { channel: 'internal'; call: unknown }
  | { channel: 'build' }
  | { channel: 'approval'; op: 'get'; id: string }
  | { channel: 'approval'; op: 'decide'; id: string; decision: unknown }
  /** Sent by an open approval every few seconds: keeps the service worker (and the request in it) alive. */
  | { channel: 'approval'; op: 'ping'; id: string };

/** `code`: the protocol error code when there is one (4001 = the user rejected). */
export type InternalReply<T = unknown> = { ok: true; value: T } | { ok: false; error: string; code?: number };

/** Page <-> relay window messages. */
export const INPAGE_SOURCE = 'clef-inpage';
export const RELAY_SOURCE = 'clef-relay';
