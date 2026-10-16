import type { ChangeView, Warning } from '@clef/explain';
import type { ApprovalDecision, ApprovalRequest } from '@clef/wallet-core';
import { fetchMultisig, type MultisigInfo } from '@clef/squads';
import { useEffect, useMemo, useState } from 'react';
import type { FullState } from '../../../lib/api';
import { createClients } from '../../../lib/clients';
import { useExplainBatch } from '../../../lib/hooks';
import { BlockedSiteBanner } from './BlockedSiteBanner';
import { accountName, Acknowledge, CardLabel, DangerBox, errorText, ErrorLine, Footer, Header, Page, siteName, SiteMark, useApprove } from './shared';

const SIGNS_NOW = ['vault_transaction_create', 'proposal_create', 'proposal_approve'];
const MEMBER_DOTS = ['bg-violet-bg', 'bg-ok-tint', 'bg-info-bg', 'bg-warn-bg', 'bg-primary-tint'];

export function SquadsApproval({
  request,
  state,
  onDecide,
  onSign,
}: {
  request: Extract<ApprovalRequest, { kind: 'squadsPropose' }>;
  state: FullState;
  onDecide: (d: ApprovalDecision) => void;
  onSign?: (payloads: Uint8Array[]) => Promise<Uint8Array[]>;
}) {
  const wires = useMemo(() => [request.inner], [request.inner]);
  const explained = useExplainBatch(wires, 'basic');
  const [info, setInfo] = useState<MultisigInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const { busy, error, run } = useApprove(onDecide);

  useEffect(() => {
    let live = true;
    fetchMultisig(createClients(state.settings).chain, request.multisig)
      .then((m) => live && (m ? setInfo(m) : setInfoError('This multisig account was not found on the current network.')))
      .catch((e) => live && setInfoError(errorText(e)));
    return () => {
      live = false;
    };
  }, [state.settings, request.multisig]);

  const host = siteName(request.origin);
  const vault = accountName(state, request.account);
  const member = accountName(state, request.member);
  const memberInfo = info?.members.find((m) => m.key === request.member);
  const memberOk = !!memberInfo && memberInfo.initiate && memberInfo.vote;
  const combined = explained.status === 'ok' ? explained.view.combined : null;
  const dangers = combined?.warnings.filter((w: Warning) => w.severity === 'danger') ?? [];
  const failed = explained.status === 'failed';
  const needsAck = !!request.phishing || failed || dangers.length > 0;
  const hardware = request.signer.kind !== 'software' && onSign;

  const title = combined ? `Propose: ${combined.summary}` : failed ? 'Propose a vault transaction' : 'Explaining the proposal…';
  const ready = !!info && memberOk && explained.status !== 'loading' && (!needsAck || ack) && !busy;

  return (
    <Page banner={request.phishing && <BlockedSiteBanner hit={request.phishing} />}>
      <Header
        mark={<SiteMark text={vault} size={32} tone="bg-warn-bg text-warn" />}
        title={info ? `${vault} · Squads ${info.threshold} of ${info.members.length}` : `${vault} · Squads`}
        subtitle={`Request from ${host} · you sign as ${member}`}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-[18px]">
        <h1 className="mx-1 my-0 text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>

        {failed && <DangerBox title="Clef could not explain this proposal">{explained.error}. Treat it as dangerous unless you know exactly what it does.</DangerBox>}
        {dangers.map((w: Warning) => (
          <DangerBox key={w.rule} title={w.message} />
        ))}

        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <CardLabel>When executed, the vault will</CardLabel>
          <div className="flex flex-col gap-1.5 px-3 py-[10px] text-[14px]">
            {explained.status === 'loading' && <span className="text-[12px] text-muted">Simulating…</span>}
            {combined && combined.balanceChanges === null && <span className="text-[12px] text-warn-ink">Balance changes unknown — the simulation did not run.</span>}
            {combined?.balanceChanges?.length === 0 && <span className="text-[12px] text-muted">No balance changes</span>}
            {combined?.balanceChanges?.map((c: ChangeView, i: number) => (
              <div key={i} className="flex">
                <span>{accountName(state, c.owner)}</span>
                <span className={`ml-auto tabular-nums ${c.amount.startsWith('-') ? 'text-danger-text' : 'text-ok'}`}>{`${c.amount} ${c.asset}`}</span>
              </div>
            ))}
            {combined?.warnings
              .filter((w: Warning) => w.severity !== 'danger')
              .map((w: Warning) => (
                <div key={w.rule} className="text-[12px] text-warn-ink">
                  {w.message}
                </div>
              ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <CardLabel>What you sign now</CardLabel>
          <ol className="m-0 py-[10px] pl-8 pr-3 font-mono text-[12px] leading-[1.8]">
            {SIGNS_NOW.map((ix) => (
              <li key={ix}>
                <span>{ix}</span>
                {ix === 'proposal_approve' && <span className="font-sans text-muted"> · your vote</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1 border-t border-line-soft px-3 py-2 text-[12px]">
            <div className="flex">
              <span className="text-muted">Signer</span>
              <span className="ml-auto">
                {member}{' '}
                {info && <span className={memberOk ? 'text-ok' : 'text-danger-text'}>{memberOk ? '✓ member · can vote' : '✕ cannot propose and vote'}</span>}
              </span>
            </div>
          </div>
        </section>

        {info && (
          <section className="flex flex-col gap-[10px] rounded-[12px] border border-line bg-surface p-3">
            <div className="flex items-center text-[12px]">
              <span className="font-semibold uppercase tracking-[0.06em] text-muted">Approvals</span>
              <span className="ml-auto">{`${Math.min(1, info.threshold)} of ${info.threshold} after you sign`}</span>
            </div>
            <div aria-hidden="true" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, info.threshold)}, minmax(0, 1fr))` }}>
              {Array.from({ length: info.threshold }, (_, i) => (
                <span key={i} className={`h-1.5 rounded-[3px] ${i === 0 ? 'bg-primary' : 'bg-line'}`} />
              ))}
            </div>
            <ul aria-label="Members" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px]">
              {info.members.map((m, i) => {
                const me = m.key === request.member;
                return (
                  <li key={m.key} className="flex items-center gap-2">
                    <span aria-hidden="true" className={`h-5 w-5 rounded-full ${MEMBER_DOTS[i % MEMBER_DOTS.length]}`} />
                    <span>{me ? `${member} (you)` : accountName(state, m.key)}</span>
                    <span className={`ml-auto text-[12px] ${me ? 'text-primary' : 'text-muted'}`}>{me ? 'approves now' : m.vote ? 'pending' : 'cannot vote'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {infoError && <ErrorLine error={`Could not load the multisig: ${infoError}`} />}

        {needsAck && (
          <Acknowledge checked={ack} onChange={setAck}>
            {request.phishing ? 'I understand this site is on a phishing list' : 'I understand I may lose these funds'}
          </Acknowledge>
        )}
        <ErrorLine error={error} />
      </div>

      <Footer
        approveLabel="Propose & approve"
        dangerPrimary={needsAck}
        approveDisabled={!ready}
        onReject={() => onDecide({ approved: false })}
        onApprove={() => run({ approved: true }, hardware ? () => hardware([request.proposal]) : undefined)}
      />
    </Page>
  );
}
