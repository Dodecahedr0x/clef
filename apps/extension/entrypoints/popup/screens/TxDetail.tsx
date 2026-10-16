import type { BatchView, DetailLevel, Warning } from '@clef/explain';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { ApprovalFrame, Button, DetailLevelSwitch, Spinner, Pubkey } from '../../../components';
import { call, type FullState } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { useExplainLanded, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { BasicBody } from '../../approval/tx/BasicBody';
import { ExpertBody } from '../../approval/tx/ExpertBody';
import { IntermediateBody } from '../../approval/tx/IntermediateBody';
import { batchWarnings, hasDanger, type Tab } from '../../approval/tx/model';
import { DangerCards } from '../../approval/tx/parts';
import { ExplainSource, IdlAdder } from '../../approval/tx/source';

function explorerUrl(state: FullState, signature: string): string | null {
  const s = state.settings;
  const cluster = s.network === 'custom' ? s.customCluster : s.network;
  if (cluster === 'localnet') return null;
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

const when = (t: number | null | undefined) =>
  t ? new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'time unknown';

/** A past transaction from History, shown in the same view with the approval bodies (from its recorded meta, read only). */
export function TxDetailScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const route = nav.route as { name: 'history/tx'; signature: string; origin?: string };
  return (
    <div className="h-(--popup-h) w-(--popup-w) overflow-hidden">
      {state ? (
        <Detail state={state} signature={route.signature} origin={route.origin ?? null} onBack={nav.back} />
      ) : (
        <div className="flex h-full items-center justify-center bg-bg">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function Detail({ state, signature, origin, onBack }: { state: FullState; signature: string; origin: string | null; onBack: () => void }) {
  const nav = useNav();
  const [level, setLevel] = useState<DetailLevel>(state.settings.detailLevel);
  const [tab, setTab] = useState<Tab>('all');
  const [copied, setCopied] = useState(false);
  const result = useExplainLanded(signature, level);
  const expert = level === 'expert';

  const changeLevel = (v: DetailLevel) => {
    setLevel(v);
    void call({ type: 'settings:update', patch: { detailLevel: v } }).catch(() => {});
  };

  const ready = result.status === 'ok' && result.view.level === level;
  const view = ready ? (result.view as BatchView) : null;
  const warnings: Warning[] = view ? batchWarnings(view) : [];
  const failed = result.status === 'ok' && result.batch.steps[0]?.status === 'failed';
  const status = result.status === 'ok' ? `${failed ? 'Failed' : 'Confirmed'} · ${when(result.blockTime)}` : 'Loading…';
  const subtitle = expert ? <>{status} · <Pubkey value={signature} /></> : status;
  const explorer = explorerUrl(state, signature);

  let body;
  if (result.status === 'failed') {
    body = (
      <div className="flex flex-col gap-3.5 px-4 pt-5">
        <DangerCards warnings={[{ rule: 'could-not-explain', severity: 'danger', message: `Clef could not explain this transaction (${result.error}).` }]} />
      </div>
    );
  } else if (!view) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted">
        <Spinner size={18} />
        <span>Loading the transaction…</span>
      </div>
    );
  } else if (view.level === 'basic') {
    body = <BasicBody view={view} warnings={warnings} danger={hasDanger(warnings)} />;
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
        chain={`solana:${state.settings.network === 'custom' ? state.settings.customCluster : state.settings.network}`}
        warnings={warnings}
        onResimulate={() => {}}
      />
    );
  }

  const copy = () => {
    void navigator.clipboard?.writeText(signature).then(() => setCopied(true), () => {});
  };

  return (
    <ExplainSource.Provider value="chain">
      <IdlAdder.Provider value={(programId) => nav.go({ name: 'settings/idls', addFor: programId })}>
      <ApprovalFrame
        site={{ origin: origin ?? 'Transaction' }}
        subtitle={subtitle}
        headerRight={<DetailLevelSwitch value={level} onChange={changeLevel} compact />}
        width="fill"
        onBack={onBack}
        footer={
          <div className="flex gap-2.5 px-4 py-3">
            <Button variant="secondary" size="md" onClick={copy}>
              {copied ? 'Copied' : 'Copy signature'}
            </Button>
            {explorer && (
              <Button variant="secondary" size="md" onClick={() => void browser.tabs.create({ url: explorer })}>
                Explorer
              </Button>
            )}
          </div>
        }
      >
        <div className={`flex flex-col ${expert ? 'min-h-0 flex-1' : 'min-h-full pb-4'}`}>{body}</div>
      </ApprovalFrame>
      </IdlAdder.Provider>
    </ExplainSource.Provider>
  );
}
