import { DEFAULT_RPC, type Network, type Settings } from '@clef/wallet-core';
import { useState } from 'react';
import { Alert, Button, ListGroup, PopupScreen, Segmented, Spinner, TextField, Toggle } from '../../../components';
import { useHealth, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
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
  const rows: { network: Network; url: string }[] = [
    { network: 'mainnet', url: s.network === 'mainnet' ? s.rpcUrl : DEFAULT_RPC.mainnet },
    { network: 'devnet', url: s.network === 'devnet' ? s.rpcUrl : DEFAULT_RPC.devnet },
    { network: 'localnet', url: s.network === 'localnet' ? s.rpcUrl : DEFAULT_RPC.localnet },
  ];
  if (s.network === 'custom') rows.push({ network: 'custom', url: s.rpcUrl });

  const draftUrl = url ?? (s.network === 'custom' ? s.rpcUrl : '');
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
          const active = s.network === r.network;
          return (
            <label
              key={r.network}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 ${active ? 'border-[1.5px] border-primary' : 'border border-line'}`}
            >
              <input
                type="radio"
                name="net"
                className="h-[18px] w-[18px] accent-primary"
                checked={active}
                onChange={() => void save(r.network === 'custom' ? { network: 'custom' } : { network: r.network, rpcUrl: DEFAULT_RPC[r.network] })}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">
                  {NETWORK_LABEL[r.network]}
                  {r.network === 'custom' && <span className="font-normal text-muted"> · {NETWORK_LABEL[s.customCluster]}</span>}
                </span>
                <span className="truncate font-mono text-xs text-muted">{rpcHost(r.url)}</span>
              </span>
              {active && <Status latencyMs={latencyMs} das={das} />}
            </label>
          );
        })}
        {!customOpen ? (
          <button type="button" className="min-h-8 self-start px-1 text-xs text-info" onClick={() => setCustomOpen(true)}>
            {s.network === 'custom' ? 'Edit custom RPC' : '+ Add custom RPC'}
          </button>
        ) : (
          <section aria-label="Custom RPC" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
            <TextField
              label="Custom RPC URL"
              mono
              spellCheck={false}
              autoComplete="off"
              placeholder="https://"
              value={draftUrl}
              error={urlError}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
            />
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
            label="Network switch in header"
            description={
              <>
                On by default in Expert · <span className="font-mono">⌥N</span> toggles
              </>
            }
            checked={s.networkSwitchInHeader}
            onChange={(networkSwitchInHeader) => void save({ networkSwitchInHeader })}
          />
          <Toggle
            label="Tint the wallet on devnet"
            description="Amber edge so test funds never look real"
            checked={s.devnetTint}
            onChange={(devnetTint) => void save({ devnetTint })}
          />
        </ListGroup>
      </div>
    </PopupScreen>
  );
}
