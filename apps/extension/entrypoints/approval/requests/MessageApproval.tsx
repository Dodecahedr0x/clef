import { inspectMessage, type ApprovalDecision, type ApprovalRequest } from '@clef/wallet-core';
import { useMemo, useState } from 'react';
import type { FullState } from '../../../lib/api';
import { BlockedSiteBanner } from './BlockedSiteBanner';
import { accountName, CheckRow, DangerBox, ErrorLine, Footer, Header, Page, PhishingAck, siteName, SiteMark, useApprove } from './shared';

const hexOf = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

export function MessageApproval({
  request,
  state,
  onDecide,
  onSign,
}: {
  request: Extract<ApprovalRequest, { kind: 'signMessage' }>;
  state: FullState;
  onDecide: (d: ApprovalDecision) => void;
  onSign?: (payloads: Uint8Array[]) => Promise<Uint8Array[]>;
}) {
  const m = useMemo(() => inspectMessage(request.message, request.origin), [request.message, request.origin]);
  const [view, setView] = useState<'text' | 'hex'>(m.kind === 'binary' ? 'hex' : 'text');
  const [ack, setAck] = useState(false);
  const { busy, error, run } = useApprove(onDecide);
  const host = siteName(request.origin);
  const phishing = request.phishing;
  const wrongSite = m.kind === 'siws' && !m.domainMatches;
  const blocked = m.looksLikeTransaction || wrongSite;
  const text = m.kind === 'text' ? m.text : m.kind === 'siws' ? Object.entries(m.fields).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  const hardware = request.signer.kind !== 'software' && onSign;

  const toggle = (v: 'text' | 'hex', label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={view === v}
      disabled={disabled}
      onClick={() => setView(v)}
      className={`h-7 rounded-[6px] px-2 text-[12px] ${view === v ? 'border border-line-strong bg-surface font-semibold text-ink' : 'border-0 bg-transparent text-muted'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      {label}
    </button>
  );

  return (
    <Page banner={phishing && <BlockedSiteBanner hit={phishing} />}>
      <Header mark={<SiteMark text={host} size={32} blocked={!!phishing} />} title={host} subtitle={`Requests a message signature · ${accountName(state, request.account)}`} />

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-4 pt-5">
        <h1 className="mx-1 my-0 text-[20px] font-semibold tracking-[-0.01em]">Sign a message</h1>

        {m.looksLikeTransaction && (
          <DangerBox title="This message is a Solana transaction">
            Signing it could authorize that transaction and move your funds. Clef blocks this request.
          </DangerBox>
        )}
        {wrongSite && !m.looksLikeTransaction && (
          <DangerBox title="Sign-in for another site">
            This message signs you in to {m.domain}, not {host}. Clef blocks this request.
          </DangerBox>
        )}

        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line-soft bg-surface-3 px-3 py-2 text-[12px] text-muted">
            <span>
              {m.kind === 'binary' ? 'Binary data' : 'UTF-8 text'} · {request.message.length} bytes
            </span>
            <div role="group" aria-label="Message view" className="ml-auto flex gap-0.5">
              {toggle('text', 'Text', m.kind === 'binary')}
              {toggle('hex', 'Hex')}
            </div>
          </div>
          {view === 'text' ? (
            <p className="m-0 max-h-72 overflow-auto whitespace-pre-line break-words p-[14px] font-mono text-[14px] leading-[1.6]">{text}</p>
          ) : (
            <p className="m-0 max-h-72 overflow-auto break-all p-[14px] font-mono text-[12px] leading-[1.6]">{hexOf(request.message)}</p>
          )}
        </section>

        {!blocked && m.kind !== 'binary' && (
          <section className="flex flex-col gap-1.5 rounded-[12px] border border-ok-line bg-ok-bg px-[14px] py-3 text-[12px] text-ok-ink">
            <CheckRow ok>Readable text — not a hidden transaction</CheckRow>
            <CheckRow ok>Signing a message can’t move funds by itself</CheckRow>
          </section>
        )}
        {!blocked && m.kind === 'binary' && (
          <section className="flex flex-col gap-1.5 rounded-[12px] border border-warn-line bg-warn-bg px-[14px] py-3 text-[12px] text-warn-ink">
            <span className="font-semibold">Binary data — Clef can’t show it as text</span>
            <span>It does not decode as a transaction. Only sign if you trust {host}.</span>
          </section>
        )}
        {!blocked && (
          <section className="flex gap-[10px] rounded-[12px] border border-dashed border-line-strong bg-surface px-[14px] py-3 text-[12px] leading-[1.45] text-muted">
            <svg className="mt-px flex-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A86400" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16.5v.01" />
            </svg>
            <span>If a message ever decodes as transaction bytes, Clef blocks it here with a danger warning.</span>
          </section>
        )}

        {phishing && !blocked && <PhishingAck checked={ack} onChange={setAck} />}
        <ErrorLine error={error} />
      </div>

      <Footer
        approveLabel="Sign"
        dangerPrimary={blocked || !!phishing}
        approveDisabled={blocked || (!!phishing && !ack) || busy}
        onReject={() => onDecide({ approved: false })}
        onApprove={() => run({ approved: true }, hardware ? () => hardware([request.message]) : undefined)}
      />
    </Page>
  );
}
