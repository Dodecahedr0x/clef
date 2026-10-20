import { useEffect, useState, type ReactNode } from 'react';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import type { Holding } from '@clef/portfolio';
import { Avatar, EmptyState, Pill, PopupScreen, Spinner, Pubkey } from '../../../components';
import { formatUsd, shortAddress } from '../../../lib/format';
import { useActiveAccount, useHistory, usePortfolio } from '../../../lib/hooks';
import { actionGate, ViewOnlyHint } from './ViewOnly';
import { useNav } from '../../../lib/nav';
import { avatarTone } from './Portfolio';

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export async function associatedTokenAddress(owner: Address, mint: Address, program: 'token' | 'token-2022'): Promise<Address> {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(program === 'token' ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM), enc.encode(mint)],
  });
  return ata;
}

function useIsAta(owner: Address | null, h: Holding | undefined): boolean | null {
  const [isAta, setIsAta] = useState<boolean | null>(null);
  useEffect(() => {
    setIsAta(null);
    if (!owner || !h?.tokenAccount || h.program === 'native') return;
    let live = true;
    associatedTokenAddress(owner, h.mint as Address, h.program)
      .then((ata) => live && setIsAta(ata === h.tokenAccount))
      .catch(() => live && setIsAta(false));
    return () => {
      live = false;
    };
  }, [owner, h?.mint, h?.tokenAccount, h?.program]);
  return isAta;
}

function Row({ k, children, first }: { k: string; children: ReactNode; first?: boolean }) {
  const line = first ? '' : 'border-t border-line-soft';
  return (
    <>
      <dt className={`py-[7px] text-muted ${line}`}>{k}</dt>
      <dd className={`m-0 py-[7px] text-right ${line}`}>{children}</dd>
    </>
  );
}

function authority(value: string | null | undefined, set: string): ReactNode {
  if (value === undefined) return <span className="text-muted">Unknown</span>;
  return value === null ? <span className="text-ok">None</span> : <span className="text-warn">Set · {set}</span>;
}

export function TokenDetailScreen() {
  const nav = useNav();
  const route = nav.route.name === 'token' ? nav.route : null;
  const account = useActiveAccount();
  const viewOnly = account?.kind === 'watch';
  const owner = account?.address ?? null;
  const { data, loading } = usePortfolio(owner);
  const { items } = useHistory(owner);
  const h = data?.holdings.find((x) => x.mint === route?.mint);
  const isAta = useIsAta(owner, h);

  if (!h) {
    return (
      <PopupScreen title="Token" onBack={nav.back}>
        {loading ? <div className="p-6 flex justify-center"><Spinner /></div> : <EmptyState title="Token not found" body="This account holds no balance of this token." />}
      </PopupScreen>
    );
  }

  const native = h.program === 'native';
  const recent = items.filter((it) => it.deltas.some((d) => d.symbol === h.symbol)).slice(0, 5);

  return (
    <PopupScreen
      scroll
      onBack={nav.back}
      title={
        <span className="flex items-center gap-1.5">
          <Avatar text={h.symbol.slice(0, 1) || '?'} tone={avatarTone(h.mint)} size={28} src={h.logoUri} />
          <span>{h.name || h.symbol}</span>
        </span>
      }
      right={h.verified ? <Pill tone="primary">Verified mint</Pill> : <Pill tone="warn">Unverified mint</Pill>}
    >
      <section className="px-4 pt-5 pb-4 flex flex-col gap-1">
        <div className="text-[34px] font-semibold tracking-[-0.03em] tabular-nums">
          {h.uiAmount} <span className="text-[18px] text-muted font-medium">{h.symbol}</span>
        </div>
        <span className="text-[12px] text-muted tabular-nums">
          {h.usdValue === null ? 'No price available' : `≈ ${formatUsd(h.usdValue)} · price $${(h.usdPrice ?? 0).toFixed(4)}`}
        </span>
      </section>

      <nav aria-label="Token actions" className="px-4 pb-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => nav.go({ name: 'send', mint: h.mint })} {...actionGate('send', viewOnly)} className="h-11 bg-primary text-white border-0 rounded-[12px] text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-45">
          Send
        </button>
        <button type="button" onClick={() => nav.go({ name: 'receive' })} className="h-11 bg-surface text-ink border border-line rounded-[12px] text-[14px]">
          Receive
        </button>
        <button type="button" onClick={() => nav.go({ name: 'swap', inputMint: h.mint })} {...actionGate('swap', viewOnly)} className="h-11 bg-surface text-ink border border-line rounded-[12px] text-[14px] disabled:cursor-not-allowed disabled:opacity-45">
          Swap
        </button>
      </nav>
      {viewOnly && <ViewOnlyHint className="px-4 -mt-2 pb-4" />}

      <h2 className="mx-5 mt-2 mb-2 text-[12px] font-semibold text-muted uppercase tracking-[0.06em]">About this token</h2>
      <dl className="mx-3 my-0 px-3 py-1 bg-surface border border-line rounded-[12px] grid grid-cols-[120px_minmax(0,1fr)] text-[12px]">
        <Row k="Mint" first>
          {native ? <span className="font-mono">Native SOL</span> : <Pubkey value={h.mint} />}
        </Row>
        <Row k="Program">
          {native ? 'System' : h.program === 'token-2022' ? 'Token-2022' : 'Token'} · {h.decimals} decimals
        </Row>
        {!native && (
          <Row k="Your account">
            {h.tokenAccount ? <Pubkey value={h.tokenAccount} /> : <span className="font-mono">—</span>}{' '}
            {isAta === true && <span className="text-ok font-sans">✓ ATA</span>}
            {isAta === false && <span className="text-warn font-sans">Not the ATA</span>}
          </Row>
        )}
        {!native && <Row k="Mint authority">{authority(h.mintAuthority, 'supply can grow')}</Row>}
        {!native && <Row k="Freeze authority">{authority(h.freezeAuthority, 'issuer can freeze')}</Row>}
        {!native && (
          <Row k="Delegate">
            {h.delegate ? <Pubkey value={h.delegate} className="text-warn" /> : <span className="text-ok">None</span>}
          </Row>
        )}
      </dl>

      <h2 className="mx-5 mt-6 mb-2 text-[12px] font-semibold text-muted uppercase tracking-[0.06em]">Recent</h2>
      <ul className="list-none mx-3 mt-0 mb-4 px-3 bg-surface border border-line rounded-[12px] text-[14px]">
        {recent.length === 0 && <li className="h-11 flex items-center text-[12px] text-muted">No recent activity</li>}
        {recent.map((it, i) => {
          const d = it.deltas.find((x) => x.symbol === h.symbol)!;
          return (
            <li key={it.signature} className={`h-11 flex items-center gap-2 ${i ? 'border-t border-line-soft' : ''}`}>
              <span className="flex-1 truncate">{it.title}</span>
              <span className="text-[12px] text-muted">{it.blockTime ? dayLabel(it.blockTime * 1000) : ''}</span>
              <span className={`tabular-nums ${d.direction === 'in' ? 'text-ok' : 'text-danger-text'}`}>
                {d.direction === 'in' ? '+' : '−'}
                {d.amount}
              </span>
            </li>
          );
        })}
      </ul>
    </PopupScreen>
  );
}

export function dayLabel(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return 'Today';
  if (day(ms) === day(now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
