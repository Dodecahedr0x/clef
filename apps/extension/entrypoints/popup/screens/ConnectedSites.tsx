import { useState } from 'react';
import { Alert, Avatar, Button, EmptyState, PopupScreen, Spinner } from '../../../components';
import { call } from '../../../lib/api';
import { timeAgo } from '../../../lib/format';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const TONES = ['primary', 'ok', 'warn', 'info', 'violet'] as const;

function host(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function ConnectedSitesScreen() {
  const nav = useNav();
  const { state, refresh } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (origins: string[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const origin of origins) await call({ type: 'permissions:revoke', origin });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const sites = state?.permissions ?? [];
  const labelOf = (address: string) => state?.accounts.find((a) => a.address === address)?.label ?? `${address.slice(0, 4)}…${address.slice(-4)}`;

  return (
    <PopupScreen
      title="Connected sites"
      onBack={nav.back}
      scroll
      footer={
        sites.length > 0 ? (
          <div className="p-4">
            <Button variant="danger-outline" size="lg" block disabled={busy} onClick={() => void revoke(sites.map((s) => s.origin))}>
              Disconnect all
            </Button>
          </div>
        ) : undefined
      }
    >
      {!state ? (
        <Spinner />
      ) : (
        <>
          <p className="mx-5 mb-2.5 mt-3.5 text-xs leading-[1.45] text-muted">These sites can see an account’s address and ask you to sign. Disconnecting stops both.</p>
          {error && (
            <div className="mx-3 mb-2">
              <Alert severity="danger">{error}</Alert>
            </div>
          )}
          {sites.length === 0 ? (
            <EmptyState title="No connected sites" body="Sites you connect to appear here." />
          ) : (
            <ul className="mx-3 overflow-hidden rounded-2xl border border-line bg-surface" aria-label="Connected sites">
              {sites.map((p, i) => {
                const h = host(p.origin);
                return (
                  <li key={p.origin} className={`flex min-h-16 items-center gap-2.5 pl-3 pr-2 ${i ? 'border-t border-line-soft' : ''}`}>
                    <Avatar text={h.charAt(0).toUpperCase()} tone={TONES[i % TONES.length]} size={32} square />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{h}</span>
                      <span className="truncate text-xs text-muted">
                        {p.accounts.map(labelOf).join(', ')} · connected {timeAgo(p.connectedAt)}
                      </span>
                    </span>
                    <Button variant="secondary" size="sm" disabled={busy} aria-label={`Disconnect ${h}`} onClick={() => void revoke([p.origin])}>
                      Disconnect
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </PopupScreen>
  );
}
