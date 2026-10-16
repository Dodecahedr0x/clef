import { useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, PopupScreen } from '../../components';
import { call, type FullState } from '../../lib/api';
import { createClients } from '../../lib/clients';
import { formatToken, shortAddress } from '../../lib/format';

export type Candidate = { address: string; path: string; index: string };

export const closeTab = () => window.close();

export function HardwareShell(p: { title: string; children: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="overflow-hidden rounded-[20px] border border-line-soft shadow-[0_8px_30px_rgba(20,23,31,0.08)]">
        <PopupScreen title={p.title} onBack={closeTab} footer={p.footer} scroll={p.scroll}>
          {p.children}
        </PopupScreen>
      </div>
    </div>
  );
}

/** Wallet state (for the RPC and already-added accounts) and SOL balances of the listed addresses. */
export function useBalances(addresses: string[]) {
  const [state, setState] = useState<FullState | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint | null>>({});
  useEffect(() => {
    call<FullState>({ type: 'state' }).then(setState, () => {});
  }, []);
  const key = addresses.join(',');
  useEffect(() => {
    if (!state) return;
    const portfolio = createClients(state.settings).portfolio;
    let live = true;
    for (const a of addresses) {
      if (a in balances) continue;
      portfolio.getBalance(a as never).then(
        (b) => live && setBalances((m) => ({ ...m, [a]: b })),
        () => live && setBalances((m) => ({ ...m, [a]: null })),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, key]);
  const added = new Set((state?.accounts ?? []).map((a) => a.address as string));
  return { balances, added };
}

function balanceText(b: bigint | null | undefined) {
  if (b === undefined) return <span className="text-faint">…</span>;
  if (b === null) return <span className="text-faint">unavailable</span>;
  if (b === 0n) return <span className="text-muted">empty</span>;
  return <span>{formatToken(b, 9)} SOL</span>;
}

export function CandidateList(p: {
  items: Candidate[];
  selected: Set<string>;
  onToggle: (c: Candidate) => void;
  balances: Record<string, bigint | null>;
  added: Set<string>;
}) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-[12px] border border-line bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-line-soft">
      {p.items.map((c) => {
        const already = p.added.has(c.address);
        return (
          <li key={c.path}>
            <label className={`flex min-h-12 items-center gap-2.5 px-3 ${already ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                className="m-0 size-[18px] accent-primary"
                checked={already || p.selected.has(c.path)}
                disabled={already}
                onChange={() => p.onToggle(c)}
                aria-label={`${c.index} ${shortAddress(c.address)}`}
              />
              <span className="w-6 font-mono text-[12px] text-muted">{c.index}</span>
              <span className="flex-1 font-mono text-[14px]" title={c.address}>
                {shortAddress(c.address)}
              </span>
              <span className="text-[12px]">{already ? <span className="text-muted">added</span> : balanceText(p.balances[c.address])}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export const addLabel = (n: number) => `Add ${n} account${n === 1 ? '' : 's'}`;

export function AddedView(p: { count: number; device: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-ok-bg text-ok">
        <Icon name="check" size={24} />
      </span>
      <p className="m-0 text-[18px] font-semibold">
        {p.count} account{p.count === 1 ? '' : 's'} added
      </p>
      <p className="m-0 text-[14px] leading-[1.45] text-muted">Your {p.device} accounts are in Clef. Open the Clef popup to use them.</p>
    </div>
  );
}

export const doneButton = (
  <Button block onClick={closeTab}>
    Done
  </Button>
);
