import type { ApprovalDecision, WalletState } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import { browser } from 'wxt/browser';
import type { InternalMessage, InternalReply } from './messages';
import { serializeDecision, type SerializedApproval } from './serialize';

export type FullState = WalletState & { activeAccount: Address | null; errorReportsAvailable: boolean };

async function send<T>(msg: InternalMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(msg)) as InternalReply<T> | undefined;
  if (!reply) throw new Error('The wallet did not respond');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export const call = <T = unknown>(c: { type: string } & Record<string, unknown>) => send<T>({ channel: 'internal', call: c });
export const getState = () => call<FullState>({ type: 'state' });
export const getApproval = (id: string) => send<SerializedApproval | null>({ channel: 'approval', op: 'get', id });
/** Signatures travel as base64 strings over runtime messaging. */
export const decide = (id: string, decision: ApprovalDecision) =>
  send<object>({ channel: 'approval', op: 'decide', id, decision: serializeDecision(decision) });

export const shortAddress = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
