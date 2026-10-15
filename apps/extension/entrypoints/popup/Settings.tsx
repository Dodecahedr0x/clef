import type { WalletState } from '@clef/wallet-core';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen } from '../../components/ui';
import { call } from '../../lib/api';

export function Settings({ state, refresh, onBack }: { state: WalletState; refresh: () => Promise<void>; onBack: () => void }) {
  const [rpcUrl, setRpcUrl] = useState(state.settings.rpcUrl);
  const [autoLock, setAutoLock] = useState(String(state.settings.autoLockMinutes));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = async (patch: Record<string, unknown>) => {
    setError(null);
    setSaved(false);
    try {
      await call({ type: 'settings:update', patch });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Screen title="Settings" onBack={onBack}>
      <label className="block space-y-1 text-sm">
        <span className="text-gray-400">Network</span>
        <select
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2"
          value={state.settings.network}
          onChange={async (e) => {
            await update({ network: e.target.value });
            setRpcUrl((await call<WalletState>({ type: 'state' })).settings.rpcUrl);
          }}
        >
          <option value="mainnet">Mainnet</option>
          <option value="devnet">Devnet</option>
        </select>
      </label>
      <Field label="RPC URL" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
      <Field label="Auto-lock after (minutes)" type="number" min={1} max={1440} value={autoLock} onChange={(e) => setAutoLock(e.target.value)} />
      <ErrorText error={error} />
      <Button onClick={() => update({ rpcUrl, autoLockMinutes: Number(autoLock) })}>{saved ? 'Saved' : 'Save'}</Button>

      <h2 className="pt-2 text-sm font-semibold text-gray-300">Connected sites</h2>
      {state.permissions.length === 0 && <p className="text-sm text-gray-500">No sites connected.</p>}
      <ul className="space-y-2">
        {state.permissions.map((p) => (
          <li key={p.origin} className="flex items-center justify-between rounded-lg bg-gray-900 px-3 py-2 text-sm">
            <span className="truncate">{p.origin}</span>
            <Button
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={async () => {
                await call({ type: 'permissions:revoke', origin: p.origin });
                await refresh();
              }}
            >
              Disconnect
            </Button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
