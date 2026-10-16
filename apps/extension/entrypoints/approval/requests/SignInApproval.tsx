import { signInMessageBytes, type ApprovalDecision, type ApprovalRequest, type SignerInfo } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import { useState, type ReactNode } from 'react';
import type { FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { BlockedSiteBanner } from './BlockedSiteBanner';
import { AccountRadio } from './ConnectApproval';
import { CardLabel, ErrorLine, findAccount, Footer, Page, PhishingAck, signerFor, siteName, SiteMark, useApprove } from './shared';

const CHAINS: Record<string, string> = { 'solana:mainnet': 'Mainnet', 'solana:devnet': 'Devnet', 'solana:testnet': 'Testnet', 'solana:localnet': 'Localnet' };

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = t - now;
  if (diff <= 0) return 'expired';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hours`;
  return new Date(t).toLocaleString();
}

const signsMessages = (kind: string) => kind !== 'watch' && kind !== 'squads';

export function SignInApproval({
  request,
  state,
  onDecide,
  onSign,
}: {
  request: Extract<ApprovalRequest, { kind: 'signIn' }>;
  state: FullState;
  onDecide: (d: ApprovalDecision) => void;
  onSign?: (payloads: Uint8Array[], signer: SignerInfo) => Promise<Uint8Array[]>;
}) {
  const { input } = request;
  const host = siteName(request.origin);
  const phishing = request.phishing;
  const signable = state.accounts.filter((a) => signsMessages(a.kind));
  const choose = request.account === null && input.address === undefined;
  const [picked, setPicked] = useState<string | null>(
    request.account ?? input.address ?? signable.find((a) => a.address === state.activeAccount)?.address ?? signable[0]?.address ?? null,
  );
  const [ack, setAck] = useState(false);
  const { busy, error, run } = useApprove(onDecide);

  const address = request.account ?? picked;
  const account = findAccount(state, address);
  const domain = input.domain ?? host;
  const domainOk = domain === host;
  const shownAddress = input.address ?? address;
  const addressOk = !!account && signsMessages(account.kind) && shownAddress === account.address;
  const expired = input.expirationTime !== undefined && relativeTime(input.expirationTime) === 'expired';

  const approve = () => {
    if (!account) return;
    const signer = request.signer ?? signerFor(account);
    const base = { approved: true as const, ...(request.account === null && { account: account.address }) };
    const sign =
      signer.kind !== 'software' && onSign ? () => onSign([signInMessageBytes({ ...input, domain }, account.address as Address)], signer) : undefined;
    void run(base, sign);
  };

  const rows: [string, ReactNode, ReactNode?, boolean?][] = [
    ['Domain', domain, domainOk ? '✓ matches tab' : '✕ not this site', domainOk],
    ['Address', shownAddress ? shortAddress(shownAddress) : '—', addressOk ? '✓ yours' : '✕ not this account', addressOk],
  ];
  if (input.statement) rows.push(['Statement', input.statement]);
  if (input.uri) rows.push(['URI', input.uri]);
  if (input.chainId) rows.push(['Chain', CHAINS[input.chainId] ?? input.chainId]);
  if (input.expirationTime) rows.push(['Expires', relativeTime(input.expirationTime), undefined, !expired]);
  if (input.notBefore) rows.push(['Not before', new Date(input.notBefore).toLocaleString()]);
  if (input.requestId) rows.push(['Request ID', input.requestId]);
  if (input.nonce) rows.push(['Nonce', input.nonce]);
  if (input.resources?.length) rows.push(['Resources', input.resources.join('\n')]);
  const MONO = new Set(['Domain', 'Address', 'URI', 'Nonce', 'Request ID', 'Resources']);

  return (
    <Page banner={phishing && <BlockedSiteBanner hit={phishing} />}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col items-center gap-2 px-5 pb-[18px] pt-7 text-center">
          <SiteMark text={host} size={56} blocked={!!phishing} />
          <h1 className="m-0 text-[20px] font-semibold">Sign in to {host}</h1>
          {account && (
            <span className="text-[14px] text-muted">
              as <strong className="text-ink">{account.label}</strong> <span className="font-mono text-[12px]">{shortAddress(account.address)}</span>
            </span>
          )}
        </section>

        {choose && (
          <fieldset className="mx-4 mb-4 flex flex-col gap-1.5 border-0 p-0">
            <legend className="px-1 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Sign in as</legend>
            {signable.map((a) => (
              <AccountRadio key={a.address} account={a} name="signin-account" checked={picked === a.address} onSelect={() => setPicked(a.address)} />
            ))}
          </fieldset>
        )}

        <section className="mx-4 overflow-hidden rounded-[12px] border border-line bg-surface">
          <CardLabel>Sign-in message</CardLabel>
          <dl className="m-0 grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1 text-[12px]">
            {rows.map(([label, value, check, ok], i) => {
              const line = i > 0 ? 'border-t border-line-soft' : '';
              return (
                <div key={label} className="contents">
                  <dt className={`py-[7px] text-muted ${line}`}>{label}</dt>
                  <dd
                    className={`m-0 whitespace-pre-line break-all py-[7px] ${line} ${MONO.has(label) ? 'font-mono' : ''} ${check === undefined ? 'col-span-2' : ''} ${ok === false && check === undefined ? 'text-danger-text' : ''}`}
                  >
                    {value}
                  </dd>
                  {check !== undefined && <dd className={`m-0 py-[7px] ${line} ${ok ? 'text-ok' : 'text-danger-text'}`}>{check}</dd>}
                </div>
              );
            })}
          </dl>
        </section>

        <p className="mx-5 mb-0 mt-[14px] text-[12px] leading-normal text-muted">Signing in proves you own this address. It doesn’t approve any transaction.</p>
        {phishing && (
          <div className="mx-4 mt-3">
            <PhishingAck checked={ack} onChange={setAck} />
          </div>
        )}
        <div className="mx-4 mt-2">
          <ErrorLine error={error} />
        </div>
      </div>

      <Footer
        rejectLabel="Cancel"
        approveLabel="Sign in"
        dangerPrimary={!domainOk || !addressOk || !!phishing}
        approveDisabled={!domainOk || !addressOk || (!!phishing && !ack) || busy}
        onReject={() => onDecide({ approved: false })}
        onApprove={approve}
      />
    </Page>
  );
}
