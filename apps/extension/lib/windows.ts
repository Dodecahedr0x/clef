import type { ApprovalRequest, Settings } from '@clef/wallet-core';

export type WindowSize = { width: number; height: number };
type DetailLevel = Settings['detailLevel'];

export const APPROVAL_SIZE: WindowSize = { width: 400, height: 680 };
export const EXPERT_APPROVAL_SIZE: WindowSize = { width: 760, height: 960 };

/** Expert transaction reviews open wide; everything else opens narrow (the page may resize itself later). */
export function approvalWindowSize(req: Pick<ApprovalRequest, 'kind'>, level: DetailLevel): WindowSize {
  const isTx = req.kind === 'signTransactions' || req.kind === 'squadsPropose';
  return isTx && level === 'expert' ? EXPERT_APPROVAL_SIZE : APPROVAL_SIZE;
}

export interface WindowsApi {
  windows: { create(o: { url: string; type: 'popup'; focused: boolean } & WindowSize): Promise<{ id?: number } | undefined> };
  runtime: { getURL(path: string): string };
}

export async function openApprovalWindow(api: WindowsApi, id: string, size: WindowSize): Promise<number | undefined> {
  const win = await api.windows.create({
    url: api.runtime.getURL(`/approval.html?id=${encodeURIComponent(id)}`),
    type: 'popup',
    focused: true,
    ...size,
  });
  return win?.id;
}

/** A History transaction, explained like an approval (read only); sized like an approval at the same level. */
export async function openTransactionWindow(api: WindowsApi, signature: string, origin: string | null, level: DetailLevel): Promise<number | undefined> {
  const q = new URLSearchParams({ sig: signature, ...(origin && { origin }) });
  const win = await api.windows.create({
    url: api.runtime.getURL(`/transaction.html?${q}`),
    type: 'popup',
    focused: true,
    ...(level === 'expert' ? EXPERT_APPROVAL_SIZE : APPROVAL_SIZE),
  });
  return win?.id;
}

/** Ledger (WebHID) and Keystone (camera) connect in a full tab: popups lose focus and permission prompts. */
export const hardwareTabUrl = (kind: 'ledger' | 'keystone'): string => `/hardware.html?kind=${kind}`;
