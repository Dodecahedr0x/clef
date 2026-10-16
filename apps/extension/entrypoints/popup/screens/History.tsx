import { useMemo, useState, type ReactNode } from 'react';
import type { RequestLogEntry } from '@clef/wallet-core';
import type { HistoryItem } from '@clef/portfolio';
import { Button, Chips, EmptyState, Icon, PopupScreen, Spinner, type IconName } from '../../../components';
import { shortAddress } from '../../../lib/format';
import { useActiveAccount, useCall, useHistory } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { dayLabel } from './TokenDetail';

type Filter = 'all' | 'sent' | 'received' | 'swaps' | 'blocked';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
  { id: 'swaps', label: 'Swaps' },
  { id: 'blocked', label: 'Blocked' },
];
const INTERNAL_ORIGIN = 'clef://wallet';
/** Relative tolerance for "what you saw" vs the on-chain result before flagging a difference. */
export const MATCH_TOLERANCE = 0.01;

type Row =
  | { type: 'tx'; at: number; item: HistoryItem; log?: RequestLogEntry }
  | { type: 'log'; at: number; entry: RequestLogEntry };

export const originLabel = (origin: string) => (origin === INTERNAL_ORIGIN ? 'Clef' : origin.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, ''));
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const num = (s: string) => Math.abs(Number(s.replace(/[−−]/g, '-').replace(/[^0-9.\-]/g, '')));

export type Comparison = { lines: { asset: string; saw: string; got: string }[]; matches: boolean; extra: number };

/** Pairs the balance changes shown at approval with the deltas observed on-chain, per asset. */
export function compareSnapshot(entry: RequestLogEntry, item: HistoryItem, mine: (owner: string) => boolean): Comparison | null {
  const seen = entry.snapshot?.balanceChanges?.filter((c) => mine(c.owner));
  if (!seen || seen.length === 0) return null;
  let matches = true;
  const lines = seen.map((c) => {
    const d = item.deltas.find((x) => x.symbol === c.asset);
    const saw = `${c.amount.replace(/^[+\-−]/, '')} ${c.asset}`;
    if (!d) {
      matches = false;
      return { asset: c.asset, saw, got: 'no change' };
    }
    const a = num(c.amount);
    const b = num(d.amount);
    if (Math.abs(a - b) > Math.max(a, b) * MATCH_TOLERANCE) matches = false;
    return { asset: c.asset, saw, got: `${d.amount} ${d.symbol}` };
  });
  const extra = item.deltas.filter((d) => !seen.some((c) => c.asset === d.symbol)).length;
  return { lines, matches: matches && extra === 0, extra };
}

function Shell({ tone, icon, children }: { tone: 'neutral' | 'danger' | 'ok' | 'warn' | 'emph'; icon: ReactNode; children: ReactNode }) {
  const box =
    tone === 'danger' ? 'bg-danger-bg border-danger-line' : tone === 'emph' ? 'bg-surface border-line-strong' : 'bg-surface border-line';
  const dot = tone === 'danger' ? 'bg-danger-bg-2' : tone === 'ok' ? 'bg-ok-bg' : tone === 'warn' ? 'bg-warn-bg' : 'bg-surface-2';
  return (
    <article className={`border rounded-[12px] overflow-hidden ${box}`}>
      <div className="min-h-14 px-3 py-2.5 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${dot}`}>{icon}</span>
        {children}
      </div>
    </article>
  );
}

const KIND_ICON: Record<HistoryItem['kind'], IconName> = { send: 'send', receive: 'receive', swap: 'swap', other: 'details' };

function TxRow({ item, log, mine }: { item: HistoryItem; log?: RequestLogEntry; mine: (o: string) => boolean }) {
  const failed = item.status === 'failed';
  const when = item.blockTime ? ` · ${clock(item.blockTime * 1000)}` : '';
  const source = log ? originLabel(log.origin) : item.subtitle;
  const cmp = log ? compareSnapshot(log, item, mine) : null;
  const tone = failed ? 'warn' : item.kind === 'receive' ? 'ok' : 'neutral';
  const body = (
    <>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-[14px] font-medium truncate">{item.title}</span>
        <span className="text-[12px] text-muted truncate">
          {source}
          {when}
          {failed && ' · nothing moved'}
        </span>
      </div>
      {failed ? (
        <span className="text-[12px] text-muted tabular-nums">fee {item.fee}</span>
      ) : (
        <div className="flex flex-col items-end text-[12px] tabular-nums">
          {item.deltas.map((d, i) => (
            <span key={i} className={d.direction === 'in' ? 'text-ok' : 'text-danger-text'}>
              {d.direction === 'in' ? '+' : '−'}
              {d.amount} {d.symbol}
            </span>
          ))}
        </div>
      )}
    </>
  );
  const icon = <Icon name={failed ? 'warn' : KIND_ICON[item.kind]} size={16} />;
  if (!cmp) return <Shell tone={tone} icon={icon}>{body}</Shell>;
  return (
    <article className="bg-surface border border-line-strong rounded-[12px] overflow-hidden" data-testid="saw-vs-happened">
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center shrink-0">{icon}</span>
        {body}
      </div>
      <div className="px-3 py-2.5 bg-surface-3 border-t border-line-soft flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-muted">What you saw → what happened</span>
        {cmp.lines.map((l) => (
          <div key={l.asset} className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] gap-1.5 items-center text-[12px] tabular-nums">
            <span>~{l.saw}</span>
            <Icon name="chevron-right" size={14} />
            <span>{l.got}</span>
          </div>
        ))}
        {cmp.matches ? (
          <span className="text-[12px] text-ok">✓ Matches what you approved · no other changes</span>
        ) : (
          <span className="text-[12px] text-warn">
            Differs from what you approved{cmp.extra ? ` · ${cmp.extra} other change${cmp.extra === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </div>
    </article>
  );
}

const OUTCOME = { rejected: 'Rejected', blocked: 'Blocked', failed: 'Failed', approved: 'Approved' } as const;

function LogRow({ entry }: { entry: RequestLogEntry }) {
  const danger = entry.outcome === 'blocked' || entry.dangerRules.length > 0;
  const what = entry.dangerRules[0] ?? entry.summary;
  return (
    <Shell tone={danger ? 'danger' : 'neutral'} icon={<Icon name={danger ? 'shield-x' : 'close'} size={16} />}>
      <div className="flex flex-col flex-1 min-w-0">
        <span className={`text-[14px] font-medium truncate ${danger ? 'text-danger-ink' : ''}`}>
          {OUTCOME[entry.outcome]} · {what}
        </span>
        <span className={`text-[12px] truncate ${danger ? 'text-danger-ink-2' : 'text-muted'}`}>
          {originLabel(entry.origin)} · {clock(entry.at)} · not sent
        </span>
      </div>
    </Shell>
  );
}

function matchesFilter(r: Row, f: Filter): boolean {
  if (f === 'all') return true;
  if (r.type === 'log') return f === 'blocked';
  return (f === 'sent' && r.item.kind === 'send') || (f === 'received' && r.item.kind === 'receive') || (f === 'swaps' && r.item.kind === 'swap');
}

export function HistoryScreen() {
  const nav = useNav();
  const account = useActiveAccount();
  const owner = account?.address ?? null;
  const history = useHistory(owner);
  const log = useCall<RequestLogEntry[]>('log:list', { limit: 500 });
  const [filter, setFilter] = useState<Filter>('all');

  const mine = (o: string) => !!account && (o === account.address || o === account.label || /^you\b/i.test(o));

  const rows = useMemo<Row[]>(() => {
    const entries = (log.data ?? []).filter((e) => !e.account || !owner || e.account === owner);
    const bySig = new Map<string, RequestLogEntry>();
    for (const e of entries) for (const s of e.signatures ?? []) bySig.set(s, e);
    const tx: Row[] = history.items.map((item) => ({ type: 'tx', at: (item.blockTime ?? 0) * 1000, item, log: bySig.get(item.signature) }));
    const notSent: Row[] = entries.filter((e) => e.outcome !== 'approved').map((entry) => ({ type: 'log', at: entry.at, entry }));
    return [...tx, ...notSent].sort((a, b) => b.at - a.at);
  }, [history.items, log.data, owner]);

  const shown = rows.filter((r) => matchesFilter(r, filter));
  const groups: { label: string; rows: Row[] }[] = [];
  for (const r of shown) {
    const label = r.at ? dayLabel(r.at) : 'Pending';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }

  return (
    <PopupScreen
      title="History"
      onBack={nav.back}
      scroll
      right={account && <span className="text-[12px] text-muted">{account.label} · {shortAddress(account.address)}</span>}
    >
      <div className="px-4 py-2.5 border-b border-line-soft">
        <Chips ariaLabel="Filter" chips={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <div className="px-3 pt-3 pb-4 flex flex-col gap-1.5">
        {history.error && <p className="m-0 text-[12px] text-danger-text">{history.error}</p>}
        {history.loading && rows.length === 0 && (
          <div className="p-6 flex justify-center">
            <Spinner />
          </div>
        )}
        {!history.loading && shown.length === 0 && <EmptyState title="Nothing here yet" />}
        {groups.map((g, gi) => (
          <section key={g.label + gi} className="flex flex-col gap-1.5">
            <h2 className={`mx-1 mb-0.5 ${gi ? 'mt-2' : 'mt-0'} text-[12px] font-semibold text-muted uppercase tracking-[0.06em]`}>{g.label}</h2>
            {g.rows.map((r) =>
              r.type === 'tx' ? <TxRow key={r.item.signature} item={r.item} log={r.log} mine={mine} /> : <LogRow key={r.entry.id} entry={r.entry} />,
            )}
          </section>
        ))}
        {history.hasMore && filter !== 'blocked' && (
          <Button variant="ghost" size="sm" onClick={history.loadMore} disabled={history.loading}>
            Load more
          </Button>
        )}
      </div>
    </PopupScreen>
  );
}
