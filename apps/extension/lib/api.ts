import type { ApprovalDecision, WalletState } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import { browser } from 'wxt/browser';
import type { InternalMessage, InternalReply } from './messages';
import { serializeDecision, type SerializedApproval } from './serialize';

export type FullState = WalletState & { activeAccount: Address | null; errorReportsAvailable: boolean };

/** This page's build; the background reports its own (see `backgroundBuild`). */
export const PAGE_BUILD: string = import.meta.env.CLEF_BUILD ?? '';

export const STALE_BACKGROUND =
  "Clef was updated but its background is still the old version, so it doesn't know this action yet. Reload Clef from your browser's extensions page (chrome://extensions or brave://extensions), then try again.";

async function send<T>(msg: InternalMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(msg)) as InternalReply<T> | undefined;
  if (!reply) throw new Error('The wallet did not respond');
  // An action the background does not know means it runs an older build than this page.
  if (!reply.ok) throw new Error(/^Unknown (call|message)/.test(reply.error) ? STALE_BACKGROUND : reply.error);
  return reply.value;
}

/** The background's build, or null when it predates build reporting (an older build than any page asking). */
export const backgroundBuild = () => send<{ build: string }>({ channel: 'build' }).then((r) => r.build, () => null);

export const call = <T = unknown>(c: { type: string } & Record<string, unknown>) => send<T>({ channel: 'internal', call: c });
export const getState = () => call<FullState>({ type: 'state' });
export const getApproval = (id: string) => send<SerializedApproval | null>({ channel: 'approval', op: 'get', id });
/** Signatures travel as base64 strings over runtime messaging. */
export const decide = (id: string, decision: ApprovalDecision) =>
  send<{ gone?: true }>({ channel: 'approval', op: 'decide', id, decision: serializeDecision(decision) });
/** `pending: false` once the request is gone (decided elsewhere, or lost when the service worker restarted). */
export const pingApproval = (id: string) => send<{ pending: boolean }>({ channel: 'approval', op: 'ping', id });

export const shortAddress = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
