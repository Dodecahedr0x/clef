import type { WalletState } from '@clef/wallet-core';
import { browser } from 'wxt/browser';
import type { InternalMessage, InternalReply } from './messages';
import type { SerializedApproval } from './serialize';

async function send<T>(msg: InternalMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(msg)) as InternalReply<T> | undefined;
  if (!reply) throw new Error('The wallet did not respond');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export const call = <T = unknown>(c: { type: string } & Record<string, unknown>) => send<T>({ channel: 'internal', call: c });
export const getState = () => call<WalletState>({ type: 'state' });
export const getApproval = (id: string) => send<SerializedApproval | null>({ channel: 'approval', op: 'get', id });
export const decide = (id: string, decision: unknown) => send<object>({ channel: 'approval', op: 'decide', id, decision });

export const shortAddress = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;
