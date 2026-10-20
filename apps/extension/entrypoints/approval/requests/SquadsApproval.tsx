import type { ChangeView, Warning } from '@clef/explain';
import type { ApprovalDecision, ApprovalRequest } from '@clef/wallet-core';
import { fetchMultisig, outerInstructionNames, type MultisigInfo } from '@clef/squads';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { useEffect, useMemo, useState } from 'react';
import type { FullState } from '../../../lib/api';
import { createClients } from '../../../lib/clients';
import { useExplainBatch } from '../../../lib/hooks';
import { BlockedSiteBanner } from './BlockedSiteBanner';
import { accountName, Acknowledge, CardLabel, DangerBox, errorText, ErrorLine, Footer, Header, Page, siteName, SiteMark, useApprove } from './shared';

/** What the member signs, read from the outer wires themselves; consecutive repeats are folded ("x ×3"). */
function signsNow(proposals: Uint8Array[]): string[] {
  const names = proposals.flatMap((w) => {
    try {
      return outerInstructionNames(w);
    } catch {
      return ['undecodable transaction'];
    }
  });
  const out: { name: string; n: number }[] = [];
  for (const name of names) {
    const last = out.at(-1);
    if (last?.name === name) last.n++;
    else out.push({ name, n: 1 });
  }
  return out.map(({ name, n }) => (n > 1 ? `${name} ×${n}` : name));
}

/** Signers of the inner transaction besides the vault; Clef replaces them with ephemeral signers. */
function extraSigners(inner: Uint8Array, vault: string): number {
  try {
    const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(inner).messageBytes);
    return msg.staticAccounts.slice(0, msg.header.numSignerAccounts).filter((k) => k !== vault).length;
  } catch {
    return 0;
  }
}
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
  const outer = request.proposals.length;
  const signs = useMemo(() => signsNow(request.proposals), [request.proposals]);
  const closesStale = signs.includes('transaction_buffer_close');
  const resumes = !signs.some((n) => n.startsWith('transaction_buffer_create')) && signs.includes('vault_transaction_create_from_buffer');
  const ephemeral = useMemo(() => extraSigners(request.inner, request.account), [request.inner, request.account]);

  const title = combined ? `Propose: ${combined.summary}` : failed ? 'Propose a vault transaction' : 'Explaining the proposal…';
  const ready = !!info && memberOk && explained.status !== 'loading' && (!needsAck || ack) && !busy;

  return (
    <Page banner={request.phishing && <BlockedSiteBanner hit={request.phishing} />}>
      <Header
        mark={<SiteMark text={vault} size={28} tone="bg-warn-bg text-warn" />}
        title={info ? `${vault} · Squads ${info.threshold} of ${info.members.length}` : `${vault} · Squads`}
        subtitle={`Request from ${host} · you sign as ${member}`}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-[18px]">
        <h1 className="mx-1 my-0 text-xl font-semibold tracking-[-0.01em]">{title}</h1>

        {failed && <DangerBox title="Clef could not explain this proposal">{explained.error}. Treat it as dangerous unless you know exactly what it does.</DangerBox>}
        {dangers.map((w: Warning) => (
          <DangerBox key={w.rule} title={w.message} />
        ))}

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <CardLabel>When executed, the vault will</CardLabel>
          <div className="flex flex-col gap-1.5 px-3 py-[10px] text-sm">
            {explained.status === 'loading' && <span className="text-xs text-muted">Simulating…</span>}
            {combined && combined.balanceChanges === null && <span className="text-xs text-warn-ink">Balance changes unknown — the simulation did not run.</span>}
            {combined?.balanceChanges?.length === 0 && <span className="text-xs text-muted">No balance changes</span>}
            {combined?.balanceChanges?.map((c: ChangeView, i: number) => (
              <div key={i} className="flex">
                <span>{accountName(state, c.owner)}</span>
                <span className={`ml-auto tabular-nums ${c.amount.startsWith('-') ? 'text-danger-text' : 'text-ok'}`}>{`${c.amount} ${c.asset}`}</span>
              </div>
            ))}
            {combined?.warnings
              .filter((w: Warning) => w.severity !== 'danger')
              .map((w: Warning) => (
                <div key={w.rule} className="text-xs text-warn-ink">
                  {w.message}
                </div>
              ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <CardLabel>What you sign now</CardLabel>
          <ol className="m-0 py-[10px] pl-8 pr-3 font-mono text-xs leading-[1.8]">
            {signs.map((ix) => (
              <li key={ix}>
                <span>{ix}</span>
                {ix === 'proposal_approve' && <span className="font-sans text-muted"> · your vote</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1 border-t border-line-soft px-3 py-2 text-xs">
            {outer > 1 && <p className="m-0 text-muted">{`You sign ${outer} transactions, sent one after another.`}</p>}
            {closesStale && <p className="m-0 text-muted">Clef first closes a transaction buffer an earlier attempt left behind; its rent comes back to you.</p>}
            {!resumes && signs.some((n) => n.startsWith('transaction_buffer_create')) && (
              <p className="m-0 text-muted">The proposal is too large for one transaction, so Clef uploads it to a Squads transaction buffer first.</p>
            )}
            {resumes && <p className="m-0 text-muted">Clef resumes an upload an earlier attempt left unfinished.</p>}
            {ephemeral > 0 && (
              <p className="m-0 text-warn-ink">
                {ephemeral === 1
                  ? 'The site asked for 1 extra signer. The multisig signs for it with an ephemeral signer, so that account gets a different address than the site chose.'
                  : `The site asked for ${ephemeral} extra signers. The multisig signs for them with ephemeral signers, so those accounts get different addresses than the site chose.`}
              </p>
            )}
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
          <section className="flex flex-col gap-[10px] rounded-2xl border border-line bg-surface p-3">
            <div className="flex items-center text-xs">
              <span className="font-semibold uppercase tracking-[0.06em] text-muted">Approvals</span>
              <span className="ml-auto">{`${Math.min(1, info.threshold)} of ${info.threshold} after you sign`}</span>
            </div>
            <div aria-hidden="true" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, info.threshold)}, minmax(0, 1fr))` }}>
              {Array.from({ length: info.threshold }, (_, i) => (
                <span key={i} className={`h-1.5 rounded-xs ${i === 0 ? 'bg-primary' : 'bg-line'}`} />
              ))}
            </div>
            <ul aria-label="Members" className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
              {info.members.map((m, i) => {
                const me = m.key === request.member;
                return (
                  <li key={m.key} className="flex items-center gap-2">
                    <span aria-hidden="true" className={`h-5 w-5 rounded-full ${MEMBER_DOTS[i % MEMBER_DOTS.length]}`} />
                    <span>{me ? `${member} (you)` : accountName(state, m.key)}</span>
                    <span className={`ml-auto text-xs ${me ? 'text-primary' : 'text-muted'}`}>{me ? 'approves now' : m.vote ? 'pending' : 'cannot vote'}</span>
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
        busy={busy}
        onReject={() => onDecide({ approved: false })}
        onApprove={() => run({ approved: true }, hardware ? () => hardware(request.proposals) : undefined)}
      />
    </Page>
  );
}
