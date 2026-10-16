import type { BatchView, DetailLevel, Warning } from '@clef/explain';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ApprovalFrame, Button, DetailLevelSwitch, Spinner } from '../../components';
import { call, type FullState } from '../../lib/api';
import { shortAddress } from '../../lib/format';
import { useExplainLanded, useWallet } from '../../lib/hooks';
import { BasicBody } from '../approval/tx/BasicBody';
import { ExpertBody } from '../approval/tx/ExpertBody';
import { IntermediateBody } from '../approval/tx/IntermediateBody';
import { batchWarnings, hasDanger, type Tab } from '../approval/tx/model';
import { DangerCards } from '../approval/tx/parts';
import { ExplainSource } from '../approval/tx/source';

const params = new URLSearchParams(location.search);
const signature = params.get('sig') ?? '';
/** The dApp that asked for it, when Clef's request log knows; otherwise the frame names the transaction. */
const origin = params.get('origin');

async function resizeWindow(width: number) {
  try {
    const w = await browser.windows.getCurrent();
    if (w.id !== undefined && w.type === 'popup') await browser.windows.update(w.id, { width });
  } catch {
    // Not in an extension window (tests, a tab): nothing to resize.
  }
}

function explorerUrl(state: FullState): string | null {
  const s = state.settings;
  const cluster = s.network === 'custom' ? s.customCluster : s.network;
  if (cluster === 'localnet') return null;
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

const when = (t: number | null | undefined) =>
  t ? new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'time unknown';

/** A past transaction from History, shown with the approval view's bodies (from its recorded meta, read only). */
export function TxDetail() {
  const { state } = useWallet();
  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner />
      </div>
    );
  }
  return <Detail state={state} />;
}

function Detail({ state }: { state: FullState }) {
  const [level, setLevel] = useState<DetailLevel>(state.settings.detailLevel);
  const [tab, setTab] = useState<Tab>('all');
  const [copied, setCopied] = useState(false);
  const result = useExplainLanded(signature, level);
  const expert = level === 'expert';

  useEffect(() => {
    void resizeWindow(expert ? 760 : 400);
  }, [expert]);

  const changeLevel = (v: DetailLevel) => {
    setLevel(v);
    void call({ type: 'settings:update', patch: { detailLevel: v } }).catch(() => {});
  };

  const ready = result.status === 'ok' && result.view.level === level;
  const view = ready ? (result.view as BatchView) : null;
  const warnings: Warning[] = view ? batchWarnings(view) : [];
  const failed = result.status === 'ok' && result.batch.steps[0]?.status === 'failed';
  const status = result.status === 'ok' ? `${failed ? 'Failed' : 'Confirmed'} · ${when(result.blockTime)}` : 'Loading…';
  const subtitle = expert ? `${status} · ${shortAddress(signature)}` : status;
  const explorer = explorerUrl(state);

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
      <ApprovalFrame
        site={{ origin: origin ?? 'Transaction' }}
        subtitle={subtitle}
        headerRight={<DetailLevelSwitch value={level} onChange={changeLevel} compact={!expert} />}
        width={expert ? 760 : 400}
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
            <Button size="md" className="ml-auto" onClick={() => window.close()}>
              Close
            </Button>
          </div>
        }
      >
        <div className={`flex flex-col ${expert ? 'min-h-0 flex-1' : 'min-h-full pb-4'}`}>{body}</div>
      </ApprovalFrame>
    </ExplainSource.Provider>
  );
}
