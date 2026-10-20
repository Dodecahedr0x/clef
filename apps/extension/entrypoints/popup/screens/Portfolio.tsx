import { useEffect, useState } from 'react';
import { DEFAULT_RPC, type Settings } from '@clef/wallet-core';
import type { Holding, Portfolio } from '@clef/portfolio';
import { Avatar, ErrorNote, Icon, Logo, NetworkSwitch, Spinner, Tabs, tabPanelProps, type IconName, Pubkey } from '../../../components';
import { call } from '../../../lib/api';
import { loadErrorText } from '../../../lib/error-text';
import { formatPct, formatUsd, shortAddress, timeAgo } from '../../../lib/format';
import { showSpamForSession, useActiveAccount, useHealth, useHistory, usePortfolio, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { clusterOf, networkLabel } from '../../../lib/network';
import { PanelButton, TabButton } from './PanelButton';
import { RpcNotice } from './RpcNotice';
import { actionGate, ViewOnlyHint } from './ViewOnly';

const LEVEL_LABEL = { basic: 'Basic', intermediate: 'Intermediate', expert: 'Expert' } as const;
const AVATAR_TONES = ['violet', 'info', 'primary', 'ok', 'warn'] as const;

export const avatarTone = (seed: string) => AVATAR_TONES[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length]!;

/** Every decimal place, no grouping: what Expert users compare against explorers. */
export function exactUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export const programLabel = (h: Pick<Holding, 'program'>) =>
  h.program === 'native' ? 'Native' : h.program === 'token-2022' ? 'Token-2022' : 'Token';

/** Mainnet/devnet only: switching away from localnet or a custom RPC would silently drop the user's URL. */
export const switchValue = (s: Settings): 'mainnet' | 'devnet' | null =>
  s.network === 'mainnet' || s.network === 'devnet' ? s.network : null;

export async function switchNetwork(to: 'mainnet' | 'devnet') {
  await call({ type: 'settings:update', patch: { network: to, rpcUrl: DEFAULT_RPC[to] } });
}

function changeLine(p: Portfolio): { text: string; tone: 'ok' | 'danger' | 'muted' } | null {
  if (p.change24hUsd === null || p.totalUsd === null) return null;
  const base = p.totalUsd - p.change24hUsd;
  const pct = base > 0 ? (p.change24hUsd / base) * 100 : 0;
  const sign = p.change24hUsd > 0 ? '+' : p.change24hUsd < 0 ? '−' : '';
  return {
    text: `${sign}${formatUsd(Math.abs(p.change24hUsd))} · ${Math.abs(pct).toFixed(1)}% today`,
    tone: p.change24hUsd > 0 ? 'ok' : p.change24hUsd < 0 ? 'danger' : 'muted',
  };
}

function useSpam(portfolio: Portfolio | null) {
  const [show, setShow] = useState(false);
  const spamHere = portfolio?.holdings.filter((h) => h.spam).length ?? 0;
  const hidden = show ? 0 : Math.max(portfolio?.hiddenSpam ?? 0, spamHere);
  const visible = portfolio?.holdings.filter((h) => show || !h.spam) ?? [];
  const reveal = () => {
    setShow(true);
    // The loader dropped them entirely: load them again for this session only (the filter setting stays on).
    if (spamHere === 0) showSpamForSession();
  };
  return { hidden, visible, reveal };
}

function SpamRow({ count, onShow }: { count: number; onShow: () => void }) {
  if (count === 0) return null;
  return (
    <li className="h-11 px-2 flex items-center gap-2 text-xs text-muted">
      <Icon name="eye-off" size={14} />
      <span>{count} spam token{count === 1 ? '' : 's'} hidden</span>
      <button type="button" onClick={onShow} className="ml-auto text-xs text-info hover:text-info-ink bg-transparent border-0 underline">
        Show
      </button>
    </li>
  );
}

function SigningFooter({ level, expert, onOpen }: { level: Settings['detailLevel']; expert: boolean; onOpen: () => void }) {
  if (expert) {
    return (
      <footer className="mt-auto h-10 px-4 flex items-center gap-2 border-t border-line-soft text-xs text-muted shrink-0">
        <button type="button" onClick={onOpen} className="flex items-center gap-2 bg-transparent border-0 p-0 text-muted">
          <span>Signing detail</span>
        </button>
        <span className="ml-auto text-ink font-semibold">{LEVEL_LABEL[level]}</span>
        <span>· switch network</span>
        <kbd className="font-mono px-[5px] py-px border border-line-strong rounded-sm bg-surface">⌥N</kbd>
      </footer>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-auto h-11 w-full px-4 flex items-center gap-2 border-0 border-t border-solid border-line-soft bg-transparent text-xs text-muted shrink-0"
    >
      <Icon name="sliders" size={14} />
      <span>Signing detail</span>
      <span className="ml-auto text-ink font-medium">{LEVEL_LABEL[level]}</span>
      <Icon name="chevron-right" size={12} />
    </button>
  );
}

function TokenRow({ h, onOpen }: { h: Holding; onOpen: () => void }) {
  const ch = h.change24h;
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full h-14 px-2 flex items-center gap-3 rounded-xl bg-transparent border-0 text-left text-ink hover:bg-surface-2">
        <Avatar text={h.symbol.slice(0, 1) || '?'} tone={avatarTone(h.mint)} size={34} src={h.logoUri} />
        <span className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{h.name || h.symbol}</span>
          <span className="text-xs text-muted tabular-nums truncate">
            {h.uiAmount} {h.symbol}
          </span>
        </span>
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-sm font-medium">{h.usdValue === null ? '—' : formatUsd(h.usdValue)}</span>
          {ch !== null && (
            <span className={`text-xs ${ch > 0 ? 'text-ok' : ch < 0 ? 'text-danger-text' : 'text-muted'}`}>
              {formatPct(ch)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

const ACTIONS: { label: string; icon: IconName; route: 'send' | 'receive' | 'swap' | 'history' }[] = [
  { label: 'Send', icon: 'send', route: 'send' },
  { label: 'Receive', icon: 'receive', route: 'receive' },
  { label: 'Swap', icon: 'swap', route: 'swap' },
  { label: 'History', icon: 'history', route: 'history' },
];

function ActivityTab({ owner }: { owner: Parameters<typeof useHistory>[0] }) {
  const nav = useNav();
  const rpcUrl = useWallet().state?.settings.rpcUrl;
  const { items, loading, error, retry } = useHistory(owner);
  if (loading && items.length === 0) return <div className="p-6 flex justify-center"><Spinner /></div>;
  if (error)
    return (
      <div className="px-4 py-3">
        <ErrorNote text={loadErrorText(error, rpcUrl)} onRetry={retry} onRpc={() => nav.go({ name: 'settings/network' })} />
      </div>
    );
  if (items.length === 0) return <p className="px-4 py-3 text-xs text-muted">No activity yet.</p>;
  return (
    <>
      {items.slice(0, 5).map((it) => (
        <li key={it.signature} className="h-14 px-2 flex items-center gap-3">
          <span className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">{it.title}</span>
            <span className="text-xs text-muted truncate">{it.blockTime ? timeAgo(it.blockTime * 1000) : it.subtitle}</span>
          </span>
          <span className="flex flex-col items-end text-xs tabular-nums">
            {it.deltas.map((d, i) => (
              <span key={i} className={d.direction === 'in' ? 'text-ok' : 'text-danger-text'}>
                {d.direction === 'in' ? '+' : '−'}
                {d.amount} {d.symbol}
              </span>
            ))}
          </span>
        </li>
      ))}
      <li className="px-2 py-2">
        <button type="button" onClick={() => nav.go({ name: 'history' })} className="text-xs text-info bg-transparent border-0 underline">
          See all activity
        </button>
      </li>
    </>
  );
}

function SitesTab() {
  const nav = useNav();
  const { state } = useWallet();
  const sites = state?.permissions ?? [];
  return (
    <>
      {sites.length === 0 && <p className="px-4 py-3 text-xs text-muted">No connected sites.</p>}
      {sites.map((p) => (
        <li key={p.origin} className="h-11 px-2 flex items-center text-sm truncate">
          {p.origin.replace(/^https?:\/\//, '')}
        </li>
      ))}
      <li className="px-2 py-2">
        <button type="button" onClick={() => nav.go({ name: 'settings/sites' })} className="text-xs text-info bg-transparent border-0 underline">
          Manage connected sites
        </button>
      </li>
    </>
  );
}

function useNetworkShortcut(settings: Settings | undefined) {
  useEffect(() => {
    if (!settings || settings.detailLevel !== 'expert' || !settings.networkSwitchInHeader) return;
    const current = switchValue(settings);
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyN') return;
      e.preventDefault();
      void switchNetwork(current === 'mainnet' ? 'devnet' : 'mainnet');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings]);
}

export function PortfolioScreen() {
  const { state } = useWallet();
  const settings = state?.settings;
  useNetworkShortcut(settings);
  if (settings?.detailLevel === 'expert') return <ExpertPortfolio />;
  return <BasicPortfolio />;
}

/** Prices are missing because Jupiter rejected the configured key; say so instead of showing blanks. */
function PriceKeyHint() {
  const nav = useNav();
  return (
    <div className="text-xs text-danger-text">
      No prices: Jupiter rejected your API key.{' '}
      <button type="button" onClick={() => nav.go({ name: 'settings', section: 'swaps' })} className="text-xs text-info bg-transparent border-0 underline p-0">
        Fix it in Settings
      </button>
    </div>
  );
}

function BasicPortfolio() {
  const nav = useNav();
  const { state } = useWallet();
  const account = useActiveAccount();
  const viewOnly = account?.kind === 'watch';
  const { data, loading, error, refresh } = usePortfolio(account?.address ?? null);
  const [tab, setTab] = useState<'tokens' | 'activity' | 'sites'>('tokens');
  const spam = useSpam(data);
  const settings = state?.settings;
  const change = data ? changeLine(data) : null;
  const sol = data?.holdings.find((h) => h.mint === 'SOL');

  return (
    <div className="w-(--popup-w) h-(--popup-h) bg-bg text-ink font-sans flex flex-col overflow-hidden">
      <header className="group h-14 pl-4 pr-3 flex items-center gap-2 border-b border-line-soft shrink-0">
        <span className="flex items-center gap-2">
          <Logo size={22} staff />
          {/* The popup is too narrow for the wordmark next to the side-panel button. */}
          <span className="font-mono font-semibold text-lg tracking-[-0.02em] group-has-[[data-panel-button]]:hidden">clef</span>
        </span>
        <button
          type="button"
          aria-label="Switch account"
          onClick={() => nav.go({ name: 'accounts' })}
          className="ml-1.5 flex-1 min-w-0 h-9 flex items-center gap-1.5 px-2 bg-surface border border-line rounded-xl text-ink"
        >
          <span className="w-[18px] h-[18px] rounded-full bg-info-dot shrink-0" />
          <span className="text-sm font-medium truncate">{account?.label ?? 'No account'}</span>
          {/* No room for the address in the 360px popup next to the name; the side panel and tab show it. */}
          {account && <Pubkey value={account.address} className="max-[399px]:hidden text-xs text-muted whitespace-nowrap shrink-0" />}
          <span className="ml-auto text-muted"><Icon name="chevron-down" size={14} /></span>
        </button>
        <TabButton />
        <PanelButton />
        <button type="button" aria-label="Settings" onClick={() => nav.go({ name: 'settings' })} className="w-9 h-11 flex-none flex items-center justify-center bg-transparent border-0 rounded-xl text-muted">
          <Icon name="settings" size={20} />
        </button>
      </header>

      <section className="px-5 pt-[22px] pb-[18px] flex flex-col gap-1 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Total balance</span>
          {settings && (
            <span className="inline-flex items-center gap-[5px] px-2 py-0.5 rounded-full bg-surface border border-line text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${clusterOf(settings) === 'mainnet' ? 'bg-ok' : 'bg-warn'}`} />
              {networkLabel(settings)}
            </span>
          )}
        </div>
        <div className="text-5xl font-semibold tracking-[-0.03em] tabular-nums" data-testid="total-balance">
          {data ? (data.totalUsd !== null ? formatUsd(data.totalUsd) : `${sol ? sol.uiAmount : '0'} SOL`) : loading ? <Spinner size={24} /> : '—'}
        </div>
        {change && <div className={`text-sm tabular-nums ${change.tone === 'ok' ? 'text-ok' : change.tone === 'danger' ? 'text-danger-text' : 'text-muted'}`}>{change.text}</div>}
        {error && <ErrorNote text={loadErrorText(error, settings?.rpcUrl)} onRetry={refresh} onRpc={() => nav.go({ name: 'settings/network' })} />}
        {data?.priceError === 'invalid-key' && <PriceKeyHint />}
      </section>

      <nav aria-label="Wallet actions" className="px-4 pb-[18px] grid grid-cols-4 gap-2 shrink-0">
        {ACTIONS.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => nav.go({ name: a.route })}
            {...actionGate(a.route, viewOnly)}
            className={`h-16 flex flex-col items-center justify-center gap-1.5 rounded-3xl text-xs disabled:cursor-not-allowed disabled:opacity-45 ${i === 0 ? 'bg-primary text-white border-0 font-semibold' : 'bg-surface text-ink border border-line font-medium'}`}
          >
            <Icon name={a.icon} size={18} />
            {a.label}
          </button>
        ))}
      </nav>
      {viewOnly && <ViewOnlyHint className="px-4 -mt-2 pb-3" />}
      <RpcNotice tokensUnavailable={!!data?.tokensUnavailable} />

      <div className="px-4 border-b border-line-soft shrink-0">
        <Tabs
          ariaLabel="Portfolio sections"
          tabs={[{ id: 'tokens', label: 'Tokens' }, { id: 'activity', label: 'Activity' }, { id: 'sites', label: 'Sites' }]}
          value={tab}
          onChange={setTab}
          panelId="portfolio-panel"
        />
      </div>

      <div {...tabPanelProps('portfolio-panel', tab)} className="flex min-h-0 flex-1 flex-col">
      <ul className="list-none m-0 px-2 py-1.5 flex flex-col flex-1 overflow-y-auto">
        {tab === 'tokens' && (
          <>
            {spam.visible.map((h) => (
              <TokenRow key={h.mint} h={h} onOpen={() => nav.go({ name: 'token', mint: h.mint })} />
            ))}
            <SpamRow count={spam.hidden} onShow={spam.reveal} />
          </>
        )}
        {tab === 'activity' && <ActivityTab owner={account?.address ?? null} />}
        {tab === 'sites' && <SitesTab />}
      </ul>
      </div>

      {settings && <SigningFooter level={settings.detailLevel} expert={false} onOpen={() => nav.go({ name: 'settings' })} />}
    </div>
  );
}

function ExpertPortfolio() {
  const nav = useNav();
  const { state } = useWallet();
  const account = useActiveAccount();
  const viewOnly = account?.kind === 'watch';
  const health = useHealth();
  const { data, error, refresh } = usePortfolio(account?.address ?? null);
  const spam = useSpam(data);
  const settings = state!.settings;
  const sw = switchValue(settings);
  const sol = data?.holdings.find((h) => h.mint === 'SOL');
  const tokens = spam.visible.filter((h) => h.program !== 'native');

  return (
    <div className="w-(--popup-w) h-(--popup-h) bg-bg text-ink font-sans flex flex-col overflow-hidden">
      <header className="h-14 pl-3.5 pr-2 flex items-center gap-1.5 border-b border-line-soft shrink-0">
        <Logo size={22} staff />
        <button
          type="button"
          aria-label="Switch account"
          onClick={() => nav.go({ name: 'accounts' })}
          className="h-9 shrink-0 flex items-center gap-1.5 px-2 bg-surface border border-line rounded-xl text-ink"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-info-dot" />
          {account ? <Pubkey value={account.address} className="text-xs whitespace-nowrap" /> : <span className="font-mono text-xs">—</span>}
        </button>
        <div className="ml-auto">
          {settings.networkSwitchInHeader && sw && <NetworkSwitch compact value={sw} onChange={(v) => void switchNetwork(v)} />}
        </div>
        <TabButton />
        <PanelButton />
        <button type="button" aria-label="Settings" onClick={() => nav.go({ name: 'settings' })} className="w-10 h-11 flex items-center justify-center bg-transparent border-0 text-muted">
          <Icon name="settings" size={20} />
        </button>
      </header>

      <div className="font-mono px-3.5 py-1.5 flex gap-2.5 text-xs text-muted bg-surface border-b border-line-soft shrink-0" data-testid="rpc-strip">
        <span className="truncate min-w-0">{settings.rpcUrl}</span>
        <span className="ml-auto whitespace-nowrap">{health.slot !== null ? `slot ${health.slot.toLocaleString('en-US')}` : 'slot —'}</span>
        <span className={`whitespace-nowrap ${health.latencyMs === null ? 'text-danger-text' : health.latencyMs < 500 ? 'text-ok' : 'text-warn'}`}>
          {health.latencyMs !== null ? `${health.latencyMs} ms` : 'offline'}
        </span>
      </div>

      <section className="px-4 pt-4 pb-3 flex flex-col gap-0.5 shrink-0">
        <span className="text-xs text-muted">Total balance</span>
        <div className="text-4xl font-semibold tracking-[-0.03em] tabular-nums" data-testid="total-balance">
          {data?.totalUsd != null ? formatUsd(data.totalUsd) : '—'}
        </div>
        <div className="font-mono text-xs text-muted">
          {exactUnits(sol?.amount ?? 0n, 9)} SOL · {(sol?.amount ?? 0n).toLocaleString('en-US')} lamports
        </div>
        {error && <ErrorNote text={loadErrorText(error, settings?.rpcUrl)} onRetry={refresh} onRpc={() => nav.go({ name: 'settings/network' })} />}
        {data?.priceError === 'invalid-key' && <PriceKeyHint />}
      </section>

      <nav aria-label="Wallet actions" className="px-4 pb-3 grid grid-cols-4 gap-2 shrink-0">
        {ACTIONS.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => nav.go({ name: a.route })}
            {...actionGate(a.route, viewOnly)}
            className={`h-11 rounded-2xl text-xs disabled:cursor-not-allowed disabled:opacity-45 ${i === 0 ? 'bg-primary text-white border-0 font-semibold' : 'bg-surface text-ink border border-line'}`}
          >
            {a.label}
          </button>
        ))}
      </nav>
      {viewOnly && <ViewOnlyHint className="px-4 -mt-2 pb-3" />}
      <RpcNotice tokensUnavailable={!!data?.tokensUnavailable} />

      <div className="px-4 pb-1.5 flex items-center text-xs text-muted shrink-0">
        <span className="font-semibold uppercase tracking-[0.06em]">Token accounts</span>
        <span className="ml-auto">Token + Token-2022</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        <ul className="list-none mx-3 my-0 p-0 bg-surface border border-line rounded-2xl flex flex-col overflow-hidden" aria-label="Token accounts">
          {tokens.length === 0 && <li className="px-3 py-2 text-xs text-muted">No token accounts</li>}
          {tokens.map((t, i) => (
            <li key={t.tokenAccount ?? t.mint} className={`px-3 py-2 grid grid-cols-[minmax(0,1fr)_auto] gap-y-0.5 ${i ? 'border-t border-line-soft' : ''}`}>
              <button type="button" onClick={() => nav.go({ name: 'token', mint: t.mint })} className="text-left bg-transparent border-0 p-0 text-ink text-sm font-medium">
                {t.symbol} <span className="text-xs font-normal text-muted">{programLabel(t)}</span>
              </button>
              <span className="text-sm font-medium text-right tabular-nums">{t.usdValue === null ? '—' : formatUsd(t.usdValue)}</span>
              <span className="font-mono text-xs text-muted truncate">
                mint <Pubkey value={t.mint} /> · ata {t.tokenAccount ? <Pubkey value={t.tokenAccount} /> : '—'}
              </span>
              <span className="font-mono text-xs text-muted text-right">
                {t.amount.toString()} · {t.decimals} dp
              </span>
            </li>
          ))}
        </ul>
        <ul className="list-none m-0 px-2">
          <SpamRow count={spam.hidden} onShow={spam.reveal} />
        </ul>
      </div>

      <SigningFooter level={settings.detailLevel} expert onOpen={() => nav.go({ name: 'settings' })} />
    </div>
  );
}
