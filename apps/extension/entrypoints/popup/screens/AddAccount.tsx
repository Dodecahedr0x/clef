import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Icon, IconButton } from '../../../components';
import { call } from '../../../lib/api';
import { useNav } from '../../../lib/nav';

type Option = { mark: string; title: string; desc: string; tint: string; run: () => void | Promise<void> };

export function AddAccountScreen() {
  const nav = useNav();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openHardware = (kind: 'ledger' | 'keystone') => void browser.tabs.create({ url: browser.runtime.getURL(`/hardware.html?kind=${kind}` as '/hardware.html') });

  const derive = async () => {
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'accounts:derive' });
      nav.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add an account');
    } finally {
      setBusy(false);
    }
  };

  const options: Option[] = [
    { mark: '+', title: 'New account', desc: 'Next address from your recovery phrase', tint: 'bg-primary-bg text-primary', run: derive },
    { mark: '↓', title: 'Import', desc: 'Another recovery phrase or a private key', tint: 'bg-surface-2 text-ink', run: () => nav.go({ name: 'import' }) },
    { mark: 'L', title: 'Ledger', desc: 'Connect over USB', tint: 'bg-violet-bg text-violet', run: () => openHardware('ledger') },
    { mark: 'K', title: 'Keystone', desc: 'Pair by scanning a QR code', tint: 'bg-surface-2 text-ink', run: () => openHardware('keystone') },
    { mark: 'S', title: 'Squads multisig', desc: 'Propose and vote with one of your accounts', tint: 'bg-warn-bg text-warn', run: () => nav.go({ name: 'accounts/squads' }) },
    { mark: '◎', title: 'Watch an address', desc: 'See balances and preview requests, no signing', tint: 'bg-info-bg text-info', run: () => nav.go({ name: 'import' }) },
  ];

  return (
    <div className="flex h-[600px] w-[360px] flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-line-soft pl-1.5 pr-3">
        <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 text-[18px] font-semibold">Add account</h1>
      </header>
      <ul className="m-3 list-none overflow-hidden rounded-[14px] border border-line bg-surface p-0">
        {options.map((o, i) => (
          <li key={o.title} className={i ? 'border-t border-line-soft' : ''}>
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
      {error && <p className="mx-4 text-[12px] text-danger-text">{error}</p>}
    </div>
  );
}
