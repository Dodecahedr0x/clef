import { DEFAULT_RPC, type Network, type Settings } from '@clef/wallet-core';
import { useState } from 'react';
import { Alert, Button, Icon, ListGroup, PopupScreen, Segmented, Spinner, TextField, Toggle } from '../../../components';
import { useHealth, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { customRpcLabels } from './NetworkPicker';
import { NETWORK_LABEL, rpcHost, useDas, useSettingsPatch } from './Settings';

type Cluster = Settings['customCluster'];

/** Null when `text` is an acceptable RPC URL: https anywhere, http only for localhost. */
export function rpcUrlError(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return 'Enter a full URL, like https://rpc.example.com';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (local && url.protocol === 'http:')) return null;
  return 'RPC URL must use https (http only for localhost)';
}

function Status({ latencyMs, das }: { latencyMs: number | null; das: boolean | null }) {
  return (
    <span className="flex flex-col items-end text-xs">
      {latencyMs === null ? <span className="text-muted">offline</span> : <span className="text-ok">{latencyMs} ms</span>}
      {das && <span className="text-ok-ink">DAS</span>}
    </span>
  );
}

export function NetworkRpcScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const { save, error } = useSettingsPatch();
  const das = useDas();
  const { latencyMs } = useHealth();
  const [customOpen, setCustomOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  if (!state) {
    return (
      <PopupScreen title="Network & RPC" onBack={nav.back}>
        <Spinner />
      </PopupScreen>
    );
  }
  const s = state.settings;
  const customs = s.customRpcs ?? [];
  const labels = customRpcLabels(customs);
  const rows: { network: Network; url: string; cluster?: Cluster; label: string }[] = [
    { network: 'mainnet', url: s.network === 'mainnet' ? s.rpcUrl : DEFAULT_RPC.mainnet, label: NETWORK_LABEL.mainnet },
    { network: 'devnet', url: s.network === 'devnet' ? s.rpcUrl : DEFAULT_RPC.devnet, label: NETWORK_LABEL.devnet },
    { network: 'localnet', url: s.network === 'localnet' ? s.rpcUrl : DEFAULT_RPC.localnet, label: NETWORK_LABEL.localnet },
    ...customs.map((c, i) => ({ network: 'custom' as const, url: c.url, cluster: c.cluster, label: labels[i]! })),
  ];

  const draftUrl = url ?? '';
  const draftCluster = cluster ?? s.customCluster;

  const saveCustom = async () => {
    const err = rpcUrlError(draftUrl);
    setUrlError(err);
    if (err) return;
    if (await save({ network: 'custom', rpcUrl: draftUrl.trim(), customCluster: draftCluster })) {
      setCustomOpen(false);
      setUrl(null);
    }
  };

  return (
    <PopupScreen title="Network & RPC" onBack={nav.back} scroll>
      <fieldset className="mx-3 mt-3.5 flex flex-col gap-2 border-0 p-0">
        <legend className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Network</legend>
        {rows.map((r) => {
          const active = s.network === r.network && (r.network !== 'custom' || s.rpcUrl === r.url);
          return (
            <label
              key={r.network === 'custom' ? r.url : r.network}
              className={`flex cursor-pointer items-center gap-2.5 rounded-2xl bg-surface px-3 py-2.5 ${active ? 'border-[1.5px] border-primary' : 'border border-line'}`}
            >
              <input
                type="radio"
                name="net"
                className="h-[18px] w-[18px] accent-primary"
                checked={active}
                aria-label={r.network === 'custom' ? `Custom RPC ${r.label}` : r.label}
                onChange={() =>
                  void save(r.network === 'custom' ? { network: 'custom', rpcUrl: r.url, customCluster: r.cluster } : { network: r.network, rpcUrl: DEFAULT_RPC[r.network] })
                }
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{r.network === 'custom' ? 'Custom' : r.label}</span>
                <span className="truncate font-mono text-xs text-muted">{r.network === 'custom' ? r.label : rpcHost(r.url)}</span>
              </span>
              {active && <Status latencyMs={latencyMs} das={das} />}
              {r.network === 'custom' && !active && (
                <button
                  type="button"
                  aria-label={`Remove ${r.label}`}
                  className="-my-1 -mr-1 flex size-9 flex-none items-center justify-center rounded-lg text-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    void save({ customRpcs: customs.filter((c) => c.url !== r.url) });
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </label>
          );
        })}
        {!customOpen ? (
          <button type="button" className="min-h-8 self-start px-1 text-xs text-info" onClick={() => setCustomOpen(true)}>
            + Add custom RPC
          </button>
        ) : (
          <section aria-label="Custom RPC" className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
            <TextField
              label="Custom RPC URL"
              mono
              spellCheck={false}
              autoComplete="off"
              placeholder="https://mainnet.helius-rpc.com/?api-key=…"
              value={draftUrl}
              error={urlError}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
            />
            <p className="m-0 text-xs leading-normal text-muted">
              Paste the URL from your RPC provider. Free tiers from Helius or QuickNode are enough for one wallet and unlock token holdings and full history on mainnet.
            </p>
            <Segmented<Cluster>
              ariaLabel="Cluster served by the custom RPC"
              size="sm"
              fill
              options={[
                { value: 'mainnet', label: 'Mainnet' },
                { value: 'devnet', label: 'Devnet' },
              ]}
              value={draftCluster}
              onChange={setCluster}
            />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCustomOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveCustom()}>
                Use this RPC
              </Button>
            </div>
          </section>
        )}
        <p className="m-0 px-1 text-xs leading-[1.45] text-muted">
          Your addresses and transactions are sent to <span className="font-mono">{rpcHost(s.rpcUrl)}</span>.
        </p>
      </fieldset>
      {error && (
        <div className="mx-3 mt-2">
          <Alert severity="danger">{error}</Alert>
        </div>
      )}
      <div className="mx-3 mb-3 mt-2.5">
        <ListGroup>
          <Toggle
            label="Network picker on the home screen"
            description={
              <>
                Pick the network from the home screen · <span className="font-mono">⌥N</span> toggles Mainnet and Devnet
              </>
            }
            checked={s.networkSwitchInHeader}
            onChange={(networkSwitchInHeader) => void save({ networkSwitchInHeader })}
          />
          <Toggle
            label="Tint the wallet on test networks"
            description="Amber edge on devnet and localnet, so test funds never look real"
            checked={s.devnetTint}
            onChange={(devnetTint) => void save({ devnetTint })}
          />
        </ListGroup>
      </div>
    </PopupScreen>
  );
}
