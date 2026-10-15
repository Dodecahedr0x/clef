import type { WalletState } from '@clef/wallet-core';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen } from '../../components/ui';
import { call, shortAddress } from '../../lib/api';

const KIND_LABEL = { hd: 'HD', imported: 'Imported', watch: 'Watch' } as const;

type Mode = 'list' | 'import' | 'watch';

function useAction(refresh: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

export function Home({ state, refresh, onSettings }: { state: WalletState; refresh: () => Promise<void>; onSettings: () => void }) {
  const [mode, setMode] = useState<Mode>('list');
  const [copied, setCopied] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState('');
  const [watchAddress, setWatchAddress] = useState('');
  const [watchLabel, setWatchLabel] = useState('');
  const { error, busy, run } = useAction(refresh);

  if (mode === 'import') {
    return (
      <Screen title="Import a private key" onBack={() => setMode('list')}>
        <Field label="Private key (base58 or JSON array)" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
        <ErrorText error={error} />
        <Button
          disabled={!secretKey || busy}
          onClick={async () => {
            if (await run(() => call({ type: 'accounts:import', secretKey }))) {
              setSecretKey('');
              setMode('list');
            }
          }}
        >
          Import
        </Button>
      </Screen>
    );
  }
  if (mode === 'watch') {
    return (
      <Screen title="Watch an address" onBack={() => setMode('list')}>
        <Field label="Address" value={watchAddress} onChange={(e) => setWatchAddress(e.target.value.trim())} />
        <Field label="Label" value={watchLabel} maxLength={32} onChange={(e) => setWatchLabel(e.target.value)} />
        <ErrorText error={error} />
        <Button
          disabled={!watchAddress || busy}
          onClick={async () => {
            if (await run(() => call({ type: 'accounts:watch', address: watchAddress, label: watchLabel || 'Watch' }))) {
              setWatchAddress('');
              setWatchLabel('');
              setMode('list');
            }
          }}
        >
          Add
        </Button>
      </Screen>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-800 p-4">
        <span className="text-lg font-bold text-violet-300">Clef</span>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs uppercase text-gray-300">{state.settings.network}</span>
      </header>
      <ul className="flex-1 space-y-2 overflow-y-auto p-4">
        {state.accounts.map((a) => (
          <li key={a.address} className="flex items-center justify-between rounded-lg bg-gray-900 px-3 py-2">
            <div>
              <div className="text-sm font-medium">{a.label}</div>
              <div className="font-mono text-xs text-gray-400">{shortAddress(a.address)}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase text-gray-400">{KIND_LABEL[a.kind]}</span>
              <button
                className="text-xs text-violet-300 hover:text-violet-200"
                onClick={async () => {
                  await navigator.clipboard.writeText(a.address);
                  setCopied(a.address);
                  setTimeout(() => setCopied(null), 1500);
                }}
              >
                {copied === a.address ? 'Copied' : 'Copy'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-gray-800 p-4">
        <ErrorText error={error} />
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(() => call({ type: 'accounts:derive' }))}>
            New
          </Button>
          <Button variant="secondary" onClick={() => setMode('import')}>
            Import
          </Button>
          <Button variant="secondary" onClick={() => setMode('watch')}>
            Watch
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onSettings}>
            Settings
          </Button>
          <Button variant="secondary" onClick={() => run(() => call({ type: 'vault:lock' }))}>
            Lock
          </Button>
        </div>
      </div>
    </div>
  );
}
