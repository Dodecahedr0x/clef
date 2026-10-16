import type { ApprovalDecision, ApprovalRequest, PublicAccount } from '@clef/wallet-core';
import { useState } from 'react';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { BlockedSiteBanner } from './BlockedSiteBanner';
import { CheckRow, Footer, Page, PhishingAck, siteName, SiteMark } from './shared';

const TAGS: Partial<Record<PublicAccount['kind'], string>> = { ledger: 'Ledger', keystone: 'Keystone', squads: 'Squads' };
const DOTS: Record<string, string> = { ledger: 'bg-violet', keystone: 'bg-violet', imported: 'bg-ok', squads: 'bg-warn rounded-[6px]' };

export function AccountRadio({ account, name, checked, onSelect }: { account: PublicAccount; name: string; checked: boolean; onSelect: () => void }) {
  const tag = TAGS[account.kind];
  return (
    <label
      className={`flex min-h-[52px] cursor-pointer items-center gap-[10px] rounded-[12px] bg-surface px-3 ${checked ? 'border-[1.5px] border-primary' : 'border border-line'}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="m-0 h-[18px] w-[18px] accent-primary" />
      <span aria-hidden="true" className={`h-[22px] w-[22px] flex-none rounded-full ${DOTS[account.kind] ?? 'bg-info-dot'}`} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-[14px] font-medium">{account.label}</span>
        <span className="font-mono text-[12px] text-muted">{shortAddress(account.address)}</span>
      </span>
      {tag && <span className="rounded-[5px] border border-line-strong px-1.5 py-px text-[12px] text-muted">{tag}</span>}
    </label>
  );
}

export function ConnectApproval({ request, state, onDecide }: { request: Extract<ApprovalRequest, { kind: 'connect' }>; state: FullState; onDecide: (d: ApprovalDecision) => void }) {
  const accounts = state.accounts.filter((a) => a.kind !== 'watch');
  const [selected, setSelected] = useState(accounts.find((a) => a.address === state.activeAccount)?.address ?? accounts[0]?.address ?? null);
  const [ack, setAck] = useState(false);
  const host = siteName(request.origin);
  const known = state.permissions.some((p) => p.origin === request.origin);
  const https = request.origin.startsWith('https://');
  const phishing = request.phishing;

  return (
    <Page banner={phishing && <BlockedSiteBanner hit={phishing} />}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col items-center gap-[10px] px-5 pb-5 pt-7 text-center">
          <SiteMark text={host} size={56} blocked={!!phishing} />
          <h1 className="m-0 text-[20px] font-semibold">{host} wants to connect</h1>
          <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted">
            {https && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0F7A62" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            )}
            {request.origin}
          </span>
          {!phishing && <span className="text-[12px] text-ok">Not on phishing lists · {known ? 'connected before' : 'first visit'}</span>}
        </section>

        <fieldset className="mx-4 flex flex-col gap-1.5 border-0 p-0">
          <legend className="px-1 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Share account</legend>
          {accounts.map((a) => (
            <AccountRadio key={a.address} account={a} name="connect-account" checked={selected === a.address} onSelect={() => setSelected(a.address)} />
          ))}
        </fieldset>

        <section className="mx-4 mt-4 flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-[14px] py-3 text-[12px] leading-[1.45]">
          <CheckRow ok>See this account’s address and balances</CheckRow>
          <CheckRow ok>Ask you to sign — every request comes back here</CheckRow>
          <CheckRow ok={false}>Move funds without your approval</CheckRow>
        </section>

        {phishing && (
          <div className="mx-4 mt-3">
            <PhishingAck checked={ack} onChange={setAck} />
          </div>
        )}
      </div>

      <Footer
        rejectLabel="Cancel"
        approveLabel={phishing ? 'Connect anyway' : 'Connect'}
        dangerPrimary={!!phishing}
        approveDisabled={!selected || (!!phishing && !ack)}
        onReject={() => onDecide({ approved: false })}
        onApprove={() => selected && onDecide({ approved: true, accounts: [selected] })}
      />
    </Page>
  );
}
