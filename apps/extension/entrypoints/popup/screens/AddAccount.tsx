import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Icon, IconButton } from '../../../components';
import { call } from '../../../lib/api';
import { HARDWARE_ENABLED } from '../../../lib/features';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

type Scheme = 'standard' | 'legacy';
const PATHS: { value: Scheme; title: string; path: string }[] = [
  { value: 'standard', title: 'Standard (Phantom, Solflare)', path: "m/44'/501'/n'/0'" },
  { value: 'legacy', title: 'Legacy (older wallets)', path: "m/44'/501'/n'" },
];

type Option = { mark: string; title: string; desc: string; tint: string; run: () => void | Promise<void> };

export function AddAccountScreen() {
  const nav = useNav();
  const state = useWallet().state;
  const phrases = state?.phrases ?? 1;
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<{ phrase?: number; scheme: Scheme } | null>(null);
  const [busy, setBusy] = useState(false);
  const openHardware = (kind: 'ledger' | 'keystone') => void browser.tabs.create({ url: browser.runtime.getURL(`/hardware.html?kind=${kind}` as '/hardware.html') });

  const derive = async (phrase?: number, scheme?: Scheme) => {
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'accounts:derive', ...(phrase && { phrase }), ...(scheme && { scheme }) });
      nav.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add an account');
    } finally {
      setBusy(false);
    }
  };

  // A phrase with legacy-path accounts asks which path; the default is its most recent account's.
  const newAccount = (phrase?: number) => {
    const hd = (state?.accounts ?? []).filter((a) => a.kind === 'hd' && (a.phrase ?? 1) === (phrase ?? 1));
    if (!hd.some((a) => a.scheme === 'legacy')) return derive(phrase);
    setError(null);
    setChoosing({ ...(phrase && { phrase }), scheme: hd.at(-1)?.scheme === 'legacy' ? 'legacy' : 'standard' });
  };

  const options: Option[] = [
    // A wallet started from a private key or watch-only has no phrase yet: the first new account makes one, shown and checked.
    ...(phrases === 0
      ? [{ mark: '+', title: 'New account', desc: 'Create a recovery phrase for new accounts', tint: 'bg-primary-bg text-primary', run: () => nav.go({ name: 'accounts/new-phrase' }) }]
      : phrases > 1
      ? Array.from({ length: phrases }, (_, i) => ({ mark: '+', title: 'New account', desc: `Next address from Recovery phrase ${i + 1}`, tint: 'bg-primary-bg text-primary', run: () => newAccount(i + 1) }))
        : [{ mark: '+', title: 'New account', desc: 'Next address from your recovery phrase', tint: 'bg-primary-bg text-primary', run: () => newAccount() }]),
    { mark: '↓', title: 'Import', desc: 'Another recovery phrase or a private key', tint: 'bg-surface-2 text-ink', run: () => nav.go({ name: 'import' }) },
    ...(HARDWARE_ENABLED
      ? [
          { mark: 'L', title: 'Ledger', desc: 'Connect over USB', tint: 'bg-violet-bg text-violet', run: () => openHardware('ledger') },
          { mark: 'K', title: 'Keystone', desc: 'Pair by scanning a QR code', tint: 'bg-surface-2 text-ink', run: () => openHardware('keystone') },
        ]
      : []),
    { mark: 'S', title: 'Squads multisig', desc: 'Propose and vote with one of your accounts', tint: 'bg-warn-bg text-warn', run: () => nav.go({ name: 'accounts/squads' }) },
    { mark: '◎', title: 'Watch an address', desc: 'See balances and preview requests, no signing', tint: 'bg-info-bg text-info', run: () => nav.go({ name: 'import', tab: 'watch' }) },
  ];

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-line-soft pl-1.5 pr-3">
        <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 text-[18px] font-semibold">Add account</h1>
      </header>
      {choosing ? (
        <div className="flex flex-1 flex-col gap-3 px-4 pt-4">
          <p className="m-0 text-[14px] font-semibold">New account from {choosing.phrase ? `Recovery phrase ${choosing.phrase}` : 'your recovery phrase'}</p>
          <p className="m-0 text-[12px] leading-[1.45] text-muted">This phrase has accounts on both paths. Pick the one the wallet you came from uses.</p>
          <div role="radiogroup" aria-label="Derivation path" className="overflow-hidden rounded-[12px] border border-line bg-surface">
            {PATHS.map((p, i) => {
              const on = choosing.scheme === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChoosing({ ...choosing, scheme: p.value })}
                  className={`flex min-h-12 w-full items-center gap-2.5 border-0 px-3 text-left text-ink ${i ? 'border-t border-line-soft' : ''} ${on ? 'bg-primary-bg' : 'bg-transparent'}`}
                >
                  <span aria-hidden="true" className={`size-[18px] flex-none rounded-full border-2 ${on ? 'border-primary bg-primary' : 'border-line-strong'}`} />
                  <span className="flex flex-1 flex-col">
                    <span className="text-[14px] font-medium">{p.title}</span>
                    <span className="font-mono text-[12px] text-muted">{p.path}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {error && <p className="m-0 text-[12px] text-danger-text">{error}</p>}
          <div className="mt-auto flex flex-col gap-2 pb-4">
            <Button block disabled={busy} onClick={() => void derive(choosing.phrase, choosing.scheme)}>Add account on this path</Button>
            <Button block variant="ghost" disabled={busy} onClick={() => setChoosing(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <ul className="m-3 list-none overflow-hidden rounded-[14px] border border-line bg-surface p-0">
          {options.map((o, i) => (
            <li key={`${o.title}|${o.desc}`} className={i ? 'border-t border-line-soft' : ''}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void o.run()}
                className="flex min-h-[72px] w-full items-center gap-3 border-0 bg-transparent px-3.5 text-left text-ink hover:bg-surface-3 disabled:opacity-60"
              >
                <span aria-hidden="true" className={`flex size-9 flex-none items-center justify-center rounded-[10px] text-[14px] font-semibold ${o.tint}`}>{o.mark}</span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{o.title}</span>
                  <span className="text-[12px] text-muted">{o.desc}</span>
                </span>
                <Icon name="chevron-right" size={14} className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!choosing && error && <p className="mx-4 text-[12px] text-danger-text">{error}</p>}
    </div>
  );
}
