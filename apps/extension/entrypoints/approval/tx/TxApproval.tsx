import type { BatchView, DetailLevel, Warning } from '@clef/explain';
import { DEFAULT_RPC, type ApprovalDecision, type ApprovalRequest, type DecisionLog } from '@clef/wallet-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { ApprovalFrame, Button, DecisionFooter, DetailLevelSwitch, NetworkSwitch, Spinner } from '../../../components';
import { call, type FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { useApprovalHost } from '../../../lib/approval-host';
import { useExplainBatch } from '../../../lib/hooks';
import { BasicBody } from './BasicBody';
import { ExpertBody } from './ExpertBody';
import { IntermediateBody } from './IntermediateBody';
import { accountLabel, batchWarnings, hasDanger, toBase64, type Tab } from './model';
import { Acknowledge, DangerCards, IncompleteNotice, PhishingBanner } from './parts';
import { IdlAdder } from './source';

type Request = Extract<ApprovalRequest, { kind: 'signTransactions' }>;

const SIGNER_KIND = { software: 'hot wallet', ledger: 'Ledger', keystone: 'Keystone' } as const;

async function resizeWindow(width: number) {
  try {
    const w = await browser.windows.getCurrent();
    if (w.id !== undefined) await browser.windows.update(w.id, { width });
  } catch {
    // Not in an extension window (tests, a tab): nothing to resize.
  }
}

export function TxApproval({
  request,
  state,
  onDecide,
  onSign,
}: {
  request: Request;
  state: FullState;
  onDecide: (d: ApprovalDecision) => void;
  onSign?: (payloads: Uint8Array[]) => Promise<Uint8Array[]>;
}) {
  const [level, setLevel] = useState<DetailLevel>(state.settings.detailLevel);
  const [tab, setTab] = useState<Tab>('all');
  const [nonce, setNonce] = useState(0);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fresh array re-runs the explanation (Re-simulate).
  const wires = useMemo(() => [...request.transactions], [request.transactions, nonce]);
  const result = useExplainBatch(wires, level);
  const n = request.transactions.length;
  const host = useApprovalHost();
  // "Add IDL" on an undecodable instruction: pick the JSON file here, then explain the request again.
  const idlFile = useRef<HTMLInputElement>(null);
  const idlFor = useRef<string | null>(null);
  const addIdl = (programId: string) => {
    idlFor.current = programId;
    idlFile.current?.click();
  };
  const onIdlFile = async (file: File | undefined) => {
    const programId = idlFor.current;
    if (!file || !programId) return;
    setError(null);
    try {
      const s = state.settings;
      await call({ type: 'idls:add', programId, network: s.network === 'custom' ? s.customCluster : s.network, json: await file.text() });
      setNonce((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (host === 'window') void resizeWindow(level === 'expert' ? 760 : 400);
  }, [level, host]);

  const changeLevel = (v: DetailLevel) => {
    setLevel(v);
    void call({ type: 'settings:update', patch: { detailLevel: v } }).catch(() => {});
  };
  const changeNetwork = (v: 'mainnet' | 'devnet') => {
    void call({ type: 'settings:update', patch: { network: v, rpcUrl: DEFAULT_RPC[v] } }).catch(() => {});
  };

  const ready = result.status === 'ok' && result.view.level === level;
  const view = ready ? (result.view as BatchView) : null;
  const warnings: Warning[] = view ? batchWarnings(view) : [];
  const danger = request.phishing !== null || result.status === 'failed' || hasDanger(warnings);
  const canSign = (ready || result.status === 'failed') && (!danger || ack) && !busy;

  // What the user saw, for the local request log (validated again by the background).
  const dangerRules = [
    ...new Set([
      ...(request.phishing ? ['phishing'] : []),
      ...(result.status === 'failed' ? ['could-not-explain'] : []),
      ...warnings.filter((w) => w.severity === 'danger').map((w) => w.rule.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)),
    ]),
  ].slice(0, 32);
  const summary = (view?.combined.summary ?? (result.status === 'failed' ? 'Clef could not explain this request' : 'Not explained yet')).slice(0, 280);
  const log: DecisionLog = {
    summary,
    dangerRules,
    ...(view && {
      snapshot: { level: view.level, summary, balanceChanges: view.combined.balanceChanges && view.combined.balanceChanges.slice(0, 64).map((c) => ({ owner: c.owner, asset: c.asset, amount: c.amount })) },
    }),
  };

  const approve = async () => {
    setError(null);
    if (!onSign) return onDecide({ approved: true, log });
    setBusy(true);
    try {
      const signatures = await onSign(request.transactions);
      onDecide({ approved: true, signatures, log });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const label = accountLabel(state, request.account);
  const expert = level === 'expert';
  const subtitle = expert
    ? `${label} · ${shortAddress(request.account)} · ${SIGNER_KIND[request.signer.kind]}`
    : `Requests ${n > 1 ? `${n} signatures` : 'signature'} · ${label}`;
  const network = state.settings.network;
  const showNetwork = expert && state.settings.networkSwitchInHeader && (network === 'mainnet' || network === 'devnet');

  const headerRight = (
    <div className="flex items-center gap-2">
      {showNetwork && <NetworkSwitch value={network} onChange={changeNetwork} />}
      <DetailLevelSwitch value={level} onChange={changeLevel} compact={!expert} />
    </div>
  );

  const approveLabel = `${n > 1 ? `Sign all ${n}` : 'Sign'}${danger ? ' anyway' : ''}`;
  const extra = expert ? (
    <div className="flex gap-2.5">
      <Button variant="secondary" size="md" onClick={() => void navigator.clipboard?.writeText(request.transactions.map(toBase64).join('\n'))}>
        Copy raw
      </Button>
      <Button variant="secondary" size="md" disabled={busy} onClick={() => setNonce((x) => x + 1)}>
        Re-simulate
      </Button>
    </div>
  ) : undefined;

  let body;
  if (result.status === 'failed') {
    body = (
      <div className="flex flex-col gap-3.5 px-4 pt-5">
        <DangerCards warnings={[{ rule: 'could-not-explain', severity: 'danger', message: `Clef could not explain this request (${result.error}). Signing what you cannot see can lose funds.` }]} />
      </div>
    );
  } else if (!view) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted">
        <Spinner size={18} />
        <span>Simulating{n > 1 ? ` ${n} transactions` : ''}…</span>
      </div>
    );
  } else if (view.level === 'basic') {
    body = <BasicBody view={view} warnings={warnings} danger={danger} />;
  } else if (view.level === 'intermediate') {
    body = <IntermediateBody view={view as BatchView<'intermediate'>} tab={tab} onTab={setTab} warnings={warnings} />;
  } else {
    body = (
      <ExpertBody
        view={view as BatchView<'expert'>}
        batch={(result as Extract<typeof result, { status: 'ok' }>).batch}
        tab={tab}
        onTab={setTab}
        state={state}
        chain={request.chain}
        warnings={warnings}
        onResimulate={() => setNonce((x) => x + 1)}
      />
    );
  }

  return (
    <IdlAdder.Provider value={addIdl}>
    <input ref={idlFile} type="file" accept=".json,application/json" className="sr-only" aria-label="IDL file" onChange={(e) => {
      void onIdlFile(e.target.files?.[0]);
      e.target.value = '';
    }} />
    <ApprovalFrame
      site={{ origin: request.origin }}
      subtitle={subtitle}
      headerRight={headerRight}
      banner={request.phishing ? <PhishingBanner hit={request.phishing} /> : undefined}
      width={host === 'panel' ? 'fill' : expert ? 760 : 400}
      footer={
        <DecisionFooter
          onReject={() => onDecide({ approved: false, log })}
          onApprove={() => void approve()}
          approveLabel={approveLabel}
          rejectLabel={n > 1 ? 'Reject all' : 'Reject'}
          approveDisabled={!canSign}
          busy={busy}
          dangerPrimary={danger}
          extra={extra}
        />
      }
    >
      <div className={`flex flex-col ${expert ? 'min-h-0 flex-1' : 'min-h-full'}`}>
        {view?.combined.incomplete && (
          <div className={expert ? 'px-5 pt-3' : 'px-4 pt-4'}>
            <IncompleteNotice dependentSteps={view.dependentSteps} />
          </div>
        )}
        {body}
        {(error || danger) && (
          <div className={`mt-auto flex flex-col gap-2 pt-3 ${expert ? 'px-5' : 'px-4'}`}>
            {error && (
              <p role="alert" className="m-0 rounded-xl border border-danger-line bg-danger-bg px-3 py-2.5 text-sm text-danger-ink">
                {error}
              </p>
            )}
            {danger && <Acknowledge checked={ack} onChange={setAck} />}
          </div>
        )}
      </div>
    </ApprovalFrame>
    </IdlAdder.Provider>
  );
}
