import type { PublicAccount } from '@clef/wallet-core';
import { loadPortfolio } from '@clef/portfolio';
import { fetchMultisig } from '@clef/squads';
import type { Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../../components';
import { call } from '../../../lib/api';
import { formatUsd, shortAddress } from '../../../lib/format';
import { useClients, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const GROUPS: { title: string; kinds: PublicAccount['kind'][] }[] = [
  { title: 'Recovery phrase', kinds: ['hd'] },
  { title: 'Imported', kinds: ['imported'] },
  { title: 'Hardware', kinds: ['ledger', 'keystone'] },
  { title: 'Multisig', kinds: ['squads'] },
  { title: 'Watch-only', kinds: ['watch'] },
];

const SWATCH: Record<PublicAccount['kind'], string> = {
  hd: 'bg-info-dot',
  imported: 'bg-ok',
  ledger: 'bg-violet',
  keystone: 'bg-ink',
  squads: 'bg-warn',
  watch: 'bg-faint',
};

export function AccountsScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const clients = useClients();
  const [usd, setUsd] = useState<Record<string, number | null>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const accounts = state?.accounts ?? [];
  const key = accounts.map((a) => a.address).join(',');

  useEffect(() => {
    if (!clients || !state) return;
    let live = true;
    const deps = { reader: clients.portfolio, chain: clients.chain, prices: clients.jupiter };
    for (const a of accounts) {
      loadPortfolio(deps, a.address, { hideSpam: state.settings.hideSpam })
        .then((p) => p.totalUsd)
        .catch(() => null)
        .then((v) => live && setUsd((m) => ({ ...m, [a.address]: v })));
      if (a.kind === 'squads' && a.multisig) {
        fetchMultisig(clients.chain, a.multisig)
          .then((ms) => ms && live && setThresholds((m) => ({ ...m, [a.address]: `${ms.threshold} of ${ms.members.length}` })))
          .catch(() => undefined);
      }
    }
    return () => {
      live = false;
    };
  }, [clients, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const phrases = [...new Set(accounts.flatMap((a) => (a.kind === 'hd' && a.phrase ? [a.phrase] : [])))].sort((x, y) => x - y);
  const byPhrase = (state?.phrases ?? 1) > 1 && phrases.length > 0;
  const groups: { title: string; match: (a: PublicAccount) => boolean }[] = GROUPS.flatMap((g) =>
    g.kinds.includes('hd') && byPhrase
      ? phrases.map((n) => ({ title: `Recovery phrase ${n}`, match: (a: PublicAccount) => a.kind === 'hd' && a.phrase === n }))
      : [{ title: g.title, match: (a: PublicAccount) => g.kinds.includes(a.kind) }],
  );

  const signing = accounts.filter((a) => a.kind !== 'watch');
  const total = signing.every((a) => a.address in usd) ? signing.reduce((s, a) => s + (usd[a.address] ?? 0), 0) : null;

  const select = async (address: Address) => {
    setError(null);
    try {
      await call({ type: 'accounts:select', address });
      nav.reset({ name: 'home' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch account');
    }
  };

  const tag = (a: PublicAccount): string => {
    if (a.address === state?.activeAccount) return '✓ selected';
    switch (a.kind) {
      case 'hd': return `#${a.index ?? 0}`;
      case 'imported': return 'imported';
      case 'ledger': return 'Ledger';
      case 'keystone': return 'Keystone';
      case 'watch': return 'view only';
      case 'squads': {
        const via = accounts.find((m) => m.address === a.member)?.label;
        const t = thresholds[a.address] ?? 'Squads';
        return via ? `${t} · via ${via}` : t;
      }
    }
  };

  return (
    <div className="flex h-[600px] w-[360px] flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-line-soft pl-1.5 pr-3">
        <IconButton label="Close" icon="close" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 text-[18px] font-semibold">Accounts</h1>
        <span className="ml-auto text-[12px] text-muted">Total {total === null ? '…' : formatUsd(total)}</span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pt-2">
        {groups.map((g) => {
          const items = accounts.filter(g.match);
          if (!items.length) return null;
          return (
            <section key={g.title}>
              <h2 className="mx-1.5 mb-1 mt-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{g.title}</h2>
              <ul className="m-0 list-none overflow-hidden rounded-[12px] border border-line bg-surface p-0">
                {items.map((a, i) => {
                  const current = a.address === state?.activeAccount;
                  const value = a.address in usd ? formatUsd(usd[a.address] ?? null) : '…';
                  return (
                    <li key={a.address} className={`flex items-center ${i ? 'border-t border-line-soft' : ''} ${current ? 'bg-primary-bg' : ''}`}>
                      <button
                        type="button"
                        aria-current={current ? 'true' : 'false'}
                        onClick={() => void select(a.address)}
                        className="flex min-h-[50px] min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-3 text-left text-ink"
                      >
                        <span className={`size-6 flex-none ${a.kind === 'squads' ? 'rounded-[6px]' : 'rounded-full'} ${SWATCH[a.kind]}`} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] font-medium">{a.label}</span>
                          <span className="font-mono text-[12px] text-muted">{shortAddress(a.address)}</span>
                        </span>
                        <span className="flex flex-col items-end">
                          <span className="text-[14px] tabular-nums">{value}</span>
                          <span className="text-[12px] text-muted">{tag(a)}</span>
                        </span>
                      </button>
                      {a.kind === 'squads' && a.multisig && (
                        <IconButton label={`Proposals for ${a.label}`} icon="chevron-right" size={40} onClick={() => nav.go({ name: 'proposals', multisig: a.multisig! })} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {error && <p className="mt-2 text-[12px] text-danger-text">{error}</p>}
      </div>
      <div className="px-4 pb-4 pt-3">
        <Button block variant="secondary" icon="plus" className="font-semibold" onClick={() => nav.go({ name: 'accounts/add' })}>Add account</Button>
      </div>
    </div>
  );
}
