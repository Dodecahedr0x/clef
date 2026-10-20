import type { BatchView, DetailLevel, Warning } from '@clef/explain';
import type { ApprovalDecision, ApprovalRequest, DecisionLog } from '@clef/wallet-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { ApprovalFrame, Button, DecisionFooter, DetailLevelSwitch, NetworkChip, Spinner, Pubkey } from '../../../components';
import { call, type FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { useApprovalHost } from '../../../lib/approval-host';
import { clusterOfChain } from '../../../lib/network';
import { announce, useCopy } from '../../../lib/a11y';
import { useAddressLookup, useExplainBatch } from '../../../lib/hooks';
import { BasicBody } from './BasicBody';
import { ExpertBody } from './ExpertBody';
import { IntermediateBody } from './IntermediateBody';
import { accountLabel, batchWarnings, hasDanger, toBase64, type Tab } from './model';
import { Acknowledge, DangerCards, IncompleteNotice, PhishingBanner } from './parts';
import { AddressBook, IdlAdder } from './source';

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
  // The dangers the checkbox was ticked for: a new or changed danger (Re-simulate, an added IDL) needs a new tick.
  const [acked, setAcked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fresh array re-runs the explanation (Re-simulate).
  const wires = useMemo(() => [...request.transactions], [request.transactions, nonce]);
  const result = useExplainBatch(wires, level);
  const raw = useCopy();
  const n = request.transactions.length;
  const host = useApprovalHost();
  const lookup = useAddressLookup(state.accounts);
  // "Add IDL" on an undecodable instruction: confirm first (a site can hand over a file that hides a danger),
  // then pick the JSON file here and explain the request again.
  const idlFile = useRef<HTMLInputElement>(null);
  const idlFor = useRef<string | null>(null);
  const [idlAsk, setIdlAsk] = useState<string | null>(null);
  const chooseIdl = () => {
    idlFor.current = idlAsk;
    setIdlAsk(null);
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

  const ready = result.status === 'ok' && result.view.level === level;
  const view = ready ? (result.view as BatchView) : null;
  const warnings: Warning[] = view ? batchWarnings(view) : [];
  const danger = request.phishing !== null || result.status === 'failed' || hasDanger(warnings);
  const dangerKeys = [
    ...(request.phishing ? ['phishing'] : []),
    ...(result.status === 'failed' ? [`could-not-explain\u0000${result.error}`] : []),
    ...warnings.filter((w) => w.severity === 'danger').map((w) => `${w.rule}\u0000${w.message}`),
  ];
  const ack = acked !== null && dangerKeys.every((k) => acked.includes(k));

  // The spinner is replaced silently: say what came of the simulation (once per explanation).
  useEffect(() => {
    if (result.status === 'failed') return announce('Clef could not explain this request. Signing what you cannot see can lose funds.');
    if (!view) return;
    const dangers = dangerKeys.length;
    const others = warnings.filter((w) => w.severity !== 'danger').length;
    announce(
      dangers
        ? `Simulation complete: ${dangers} ${dangers === 1 ? 'danger' : 'dangers'}. Read them before signing.`
        : `Simulation complete${others ? `: ${others} ${others === 1 ? 'warning' : 'warnings'}` : ', no warnings'}.`,
    );
  }, [result.status, view]);
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
    ? <>{label} · <Pubkey value={request.account} /> · {SIGNER_KIND[request.signer.kind]}</>
    : `Requests ${n > 1 ? `${n} signatures` : 'signature'} · ${label}`;
  // A test network is marked at every level by the edge (NetworkEdge, in Approval). Expert also names the network here,
  // read-only: switching inside an approval would explain the request against another cluster.
  const headerRight = (
    <div className="flex items-center gap-2">
      {expert && <NetworkChip cluster={clusterOfChain(request.chain)} />}
      <DetailLevelSwitch value={level} onChange={changeLevel} compact={!expert} />
    </div>
  );

  const approveLabel = `${n > 1 ? `Sign all ${n}` : 'Sign'}${danger ? ' anyway' : ''}`;
  const extra = expert ? (
    <div className="flex gap-2.5">
      <Button variant="secondary" size="md" onClick={() => raw.copy(request.transactions.map(toBase64).join('\n'), 'raw transactions')}>
        {raw.copied ? 'Copied' : 'Copy raw'}
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
        <DangerCards warnings={[{ rule: 'could-not-explain', severity: 'danger', message: 'Clef could not work out what this request does. Signing what you cannot see can lose funds.', details: [`Clef's error: ${result.error}`] }]} />
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
    <IdlAdder.Provider value={level === 'basic' ? null : setIdlAsk}>
    <AddressBook.Provider value={lookup}>
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
        {view?.combined.incomplete && view.mode === 'independent' && view.steps.length > 1 && (
          <div className={expert ? 'px-5 pt-3' : 'px-4 pt-4'}>
            <IncompleteNotice dependentSteps={view.dependentSteps} />
          </div>
        )}
        {body}
        {idlAsk && (
          <div className={`flex flex-col gap-2 pt-3 ${expert ? 'px-5' : 'px-4'}`}>
            <section role="alertdialog" aria-label="Add an IDL" className="flex flex-col gap-2.5 rounded-xl border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">
              <p className="m-0">
                Only add an IDL from a source you trust, never one the site asking you to sign gave you. An IDL names what a program does; it can make a harmful request look ordinary.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="md" onClick={chooseIdl}>
                  Choose IDL file
                </Button>
                <Button variant="secondary" size="md" onClick={() => setIdlAsk(null)}>
                  Cancel
                </Button>
              </div>
            </section>
          </div>
        )}
        {(error || danger) && (
          <div className={`mt-auto flex flex-col gap-2 pt-3 ${expert ? 'px-5' : 'px-4'}`}>
            {error && (
              <p role="alert" className="m-0 rounded-xl border border-danger-line bg-danger-bg px-3 py-2.5 text-sm text-danger-ink">
                {error}
              </p>
            )}
            {danger && <Acknowledge checked={ack} onChange={(v) => setAcked(v ? dangerKeys : null)} dangers={dangerKeys} />}
          </div>
        )}
      </div>
    </ApprovalFrame>
    </AddressBook.Provider>
    </IdlAdder.Provider>
  );
}
