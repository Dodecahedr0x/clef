import { useEffect, useMemo, useState } from 'react';
import { isAddress, type Address } from '@solana/kit';
import type { Contact } from '@clef/wallet-core';
import { buildSendTransaction, classifyRecipient, hasTokenAccount, maxSolSend, sendCosts, tokenAccountRent, WALLET_RENT_MIN, type Holding, type RecipientKind, type SendProblem } from '@clef/portfolio';
import { Alert, Avatar, Button, EmptyState, Icon, PopupScreen, Spinner, Pubkey } from '../../../components';
import { call } from '../../../lib/api';
import { createClients } from '../../../lib/clients';
import { formatToken, formatUsd, shortAddress } from '../../../lib/format';
import { useActiveAccount, useCall, usePortfolio, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { avatarTone } from './Portfolio';

/** Decimal string -> base units; null when malformed or more precise than the token allows. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, '');
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  return BigInt(m[1] || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Base units -> plain decimal string for an input field (no grouping, no truncation). */
export function unitsToInput(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Suggestion = { address: Address; name: string; source: 'Address book' | 'Your account' };

const RECIPIENT_NOTE: Partial<Record<RecipientKind, { severity: 'warn' | 'danger' | 'info'; title: string; body: string }>> = {
  'token-account': {
    severity: 'danger',
    title: 'This is a token account, not a wallet',
    body: 'Tokens sent here may be lost. Ask the recipient for their wallet address.',
  },
  program: {
    severity: 'danger',
    title: 'This is a program, not a wallet',
    body: 'Funds sent to a program address are usually unrecoverable.',
  },
  new: { severity: 'info', title: 'New address', body: 'This address has no activity on-chain yet. Double-check it before sending.' },
};

function TokenPicker({ holdings, onPick, onClose }: { holdings: Holding[]; onPick: (mint: string) => void; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Choose token" className="absolute inset-0 z-10 bg-bg flex flex-col">
      <div className="h-14 px-4 flex items-center border-b border-line-soft">
        <h2 className="m-0 text-[18px] font-semibold">Choose token</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto w-11 h-11 flex items-center justify-center bg-transparent border-0">
          <Icon name="close" size={20} />
        </button>
      </div>
      <ul className="list-none m-0 p-2 overflow-y-auto">
        {holdings.map((h) => (
          <li key={h.mint}>
            <button type="button" onClick={() => onPick(h.mint)} className="w-full h-14 px-2 flex items-center gap-3 bg-transparent border-0 rounded-[10px] text-left text-ink hover:bg-surface-2">
              <Avatar text={h.symbol.slice(0, 1) || '?'} tone={avatarTone(h.mint)} size={30} src={h.logoUri} />
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-[14px] font-medium">{h.symbol}</span>
                <span className="text-[12px] text-muted truncate">{h.name}</span>
              </span>
              <span className="text-[12px] text-muted tabular-nums">{h.uiAmount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TokenButton({ h, onClick, label }: { h: { symbol: string; mint: string; logoUri?: string } | undefined; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-10 flex items-center gap-2 pl-1.5 pr-2.5 bg-surface-2 border border-line rounded-full text-ink shrink-0"
    >
      {h && <Avatar text={h.symbol.slice(0, 1) || '?'} tone={avatarTone(h.mint)} size={26} src={h.logoUri} />}
      <span className="text-[14px] font-medium">{h?.symbol ?? 'Select'}</span>
      <span className="text-muted"><Icon name="chevron-down" size={14} /></span>
    </button>
  );
}

/** Exact SOL, e.g. '0.000005' (amounts this small must not round away). */
const sol = (lamports: bigint) => unitsToInput(lamports, 9);

function problemText(p: SendProblem, asset: 'sol' | 'token', symbol: string, deposit: bigint): string {
  switch (p.kind) {
    case 'fee':
      if (asset === 'sol') return `Not enough SOL left for the network fee (${sol(p.need)} SOL). MAX sends everything minus the fee.`;
      return deposit
        ? `Not enough SOL: sending ${symbol} here costs ${sol(p.need)} SOL (the network fee and a deposit to open their ${symbol} account). This account has ${sol(p.have)} SOL.`
        : `Not enough SOL for the network fee: it needs ${sol(p.need)} SOL and this account has ${sol(p.have)} SOL.`;
    case 'dust':
      return asset === 'sol'
        ? `This would leave ${sol(p.left)} SOL, less than the ${sol(WALLET_RENT_MIN)} SOL a wallet must keep. Send everything (MAX) or keep at least ${sol(WALLET_RENT_MIN)} SOL.`
        : `After the fees this account would keep ${sol(p.left)} SOL, less than the ${sol(WALLET_RENT_MIN)} SOL a wallet must hold. Add SOL to it first.`;
    case 'recipient-min':
      return `This address has no account yet: it needs at least ${sol(p.min)} SOL to open. Send at least that much.`;
  }
}

/** Whether the recipient already has a token account for the mint; false means the send opens one, at the sender's cost. */
function useHasTokenAccount(to: Address | null, h: Holding | undefined, rpcKey: unknown, chainFor: () => Parameters<typeof hasTokenAccount>[0]) {
  const [exists, setExists] = useState<boolean | 'checking' | null>(null);
  const program = h && h.program !== 'native' ? h.program : null;
  useEffect(() => {
    if (!to || !h || !program) return setExists(null);
    let live = true;
    setExists('checking');
    hasTokenAccount(chainFor(), to, h.mint as Address, program)
      .then((x) => live && setExists(x))
      // Unknown: assume the deposit, so the check never lets an unaffordable send through.
      .catch(() => live && setExists(false));
    return () => {
      live = false;
    };
  }, [to, h?.mint, program, rpcKey]);
  return exists;
}

function useRecipientKind(to: Address | null, rpcKey: unknown, chainFor: () => Parameters<typeof classifyRecipient>[0]) {
  const [kind, setKind] = useState<RecipientKind | 'checking' | null>(null);
  useEffect(() => {
    if (!to) return setKind(null);
    let live = true;
    setKind('checking');
    classifyRecipient(chainFor(), to)
      .then((k) => live && setKind(k))
      .catch(() => live && setKind('unknown'));
    return () => {
      live = false;
    };
  }, [to, rpcKey]);
  return kind;
}

export function SendScreen() {
  const nav = useNav();
  const route = nav.route.name === 'send' ? nav.route : null;
  const { state } = useWallet();
  const account = useActiveAccount();
  const settings = state?.settings ?? null;
  const { data } = usePortfolio(account?.address ?? null);
  const contacts = useCall<Contact[]>('contacts:list');
  const clients = useMemo(() => (settings ? createClients(settings) : null), [settings?.rpcUrl, settings?.network, settings?.jupiterApiKey]);

  const [mint, setMint] = useState<string>(route?.mint ?? 'SOL');
  const [amountText, setAmountText] = useState('');
  const [toText, setToText] = useState(route?.to ?? '');
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const holdings = data?.holdings.filter((h) => !h.spam || h.mint === mint) ?? [];
  const h = data?.holdings.find((x) => x.mint === mint);

  const suggestions = useMemo<Suggestion[]>(() => {
    const own: Suggestion[] = (state?.accounts ?? [])
      .filter((a) => a.address !== account?.address && a.kind !== 'watch')
      .map((a) => ({ address: a.address, name: a.label, source: 'Your account' }));
    const book: Suggestion[] = (contacts.data ?? []).map((c) => ({ address: c.address, name: c.name, source: 'Address book' }));
    const q = toText.trim().toLowerCase();
    const all = [...book, ...own];
    if (!q) return all.slice(0, 4);
    return all.filter((s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().startsWith(q)).slice(0, 4);
  }, [state?.accounts, contacts.data, toText, account?.address]);

  const to: Address | null = picked ? picked.address : isAddress(toText.trim()) ? (toText.trim() as Address) : null;
  const kind = useRecipientKind(to, clients, () => clients!.chain);

  const amount = h ? parseAmount(amountText, h.decimals) : null;
  const tooMuch = h !== undefined && amount !== null && amount > h.amount;
  const usd = h?.usdPrice != null && amount !== null ? (Number(amount) / 10 ** h.decimals) * h.usdPrice : null;
  const note = kind && kind !== 'checking' ? RECIPIENT_NOTE[kind] : undefined;

  // SOL the send costs on top of the amount (fee, and the deposit for a recipient token account it opens), and why
  // it can't go through: caught here rather than as a failed simulation.
  const asset = h?.program === 'native' ? 'sol' : 'token';
  const solBalance = data?.holdings.find((x) => x.program === 'native')?.amount ?? 0n;
  const hasAccount = useHasTokenAccount(to, h, clients, () => clients!.chain);
  const deposit = h && h.program !== 'native' && hasAccount === false ? tokenAccountRent(h.program) : 0n;
  const costs = h && to && amount !== null && amount > 0n && !tooMuch ? sendCosts({ asset, amount, solBalance, recipientIsNew: kind === 'new', deposit }) : null;
  const canReview =
    !!account && !!h && !!to && amount !== null && amount > 0n && !tooMuch && !busy && kind !== 'checking' && hasAccount !== 'checking' && !costs?.problem && to !== account.address;

  const max = () => {
    if (!h) return;
    setAmountText(unitsToInput(h.program === 'native' ? maxSolSend(h.amount) : h.amount, h.decimals));
  };

  const review = async () => {
    if (!canReview || !clients) return;
    setBusy(true);
    setError(null);
    try {
      const { wire } = await buildSendTransaction(
        { chain: clients.chain, reader: clients.portfolio },
        { from: account.address, to, mint: mint === 'SOL' ? 'SOL' : (mint as Address), amount },
      );
      const res = await call<{ signatures?: string[] }>({
        type: 'wallet:submit',
        account: account.address,
        transactions: [toBase64(wire)],
        send: true,
        purpose: 'send',
      });
      setSent(res.signatures?.[0] ?? '');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent !== null) {
    return (
      <PopupScreen title="Send" onBack={() => nav.reset({ name: 'home' })}>
        <EmptyState
          title="Sent"
          body={
            <span>
              {amountText} {h?.symbol} to {picked?.name ?? shortAddress(to ?? '')}
              {sent && <span className="block mt-1"><Pubkey value={sent} className="text-[12px] text-muted" /></span>}
            </span>
          }
          action={<Button onClick={() => nav.reset({ name: 'home' })}>Done</Button>}
        />
      </PopupScreen>
    );
  }

  return (
    <PopupScreen
      title="Send"
      onBack={nav.back}
      footer={
        <div className="p-4">
          <Button block size="lg" disabled={!canReview} onClick={() => void review()}>
            {busy ? 'Waiting for approval…' : 'Review'}
          </Button>
        </div>
      }
    >
      <div className="relative px-4 pt-5 flex flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <label htmlFor="send-amount" className="text-[12px] text-muted">Amount</label>
          <div className="p-3.5 bg-surface border border-line rounded-[14px] flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <input
                id="send-amount"
                value={amountText}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => setAmountText(e.target.value)}
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ink text-[32px] font-semibold tracking-[-0.02em] tabular-nums"
              />
              <TokenButton h={h} label="Choose token" onClick={() => setPicking(true)} />
            </div>
            <div className="flex items-center text-[12px] text-muted tabular-nums">
              <span>{usd !== null ? `≈ ${formatUsd(usd)}` : ''}</span>
              <span className="ml-auto">Balance {h ? formatToken(h.amount, h.decimals) : '—'}</span>
              <button type="button" onClick={max} className="ml-2 h-7 px-2.5 bg-transparent border border-line-strong rounded-full text-ink text-[12px] font-semibold">
                MAX
              </button>
            </div>
          </div>
          {tooMuch && <span className="text-[12px] text-danger-text">More than your balance</span>}
          {amountText && amount === null && <span className="text-[12px] text-danger-text">Enter a valid amount</span>}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="send-to" className="text-[12px] text-muted">To</label>
          <div className={`h-12 px-3.5 bg-surface border rounded-[12px] flex items-center ${toText ? 'border-primary' : 'border-line'}`}>
            <input
              id="send-to"
              value={picked ? picked.name : toText}
              placeholder="Address or contact name"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setPicked(null);
                setToText(e.target.value);
              }}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ink text-[14px]"
            />
            {kind === 'checking' && <Spinner size={14} />}
          </div>
          {!picked && !to && suggestions.length > 0 && (
            <ul aria-label="Suggestions" className="list-none m-0 p-1 bg-surface border border-line rounded-[12px] flex flex-col">
              {suggestions.map((s) => (
                <li key={s.address}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(s);
                      setToText(s.name);
                    }}
                    className="w-full min-h-[52px] px-2.5 flex items-center gap-2.5 bg-transparent border-0 rounded-[8px] text-left text-ink hover:bg-surface-2"
                  >
                    <Avatar text={s.name.slice(0, 1).toUpperCase() || '?'} tone={s.source === 'Your account' ? 'info' : 'ok'} size={30} />
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className="text-[14px] font-medium truncate">{s.name}</span>
                      <span className="font-mono text-[12px] text-muted">
                        <Pubkey value={s.address} /> · {s.source}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <span className="font-mono text-[12px] text-muted">
              <Pubkey value={picked.address} /> · {picked.source}
            </span>
          )}
          {toText && !picked && !to && suggestions.length === 0 && <span className="text-[12px] text-danger-text">Not a Solana address</span>}
          {to && to === account?.address && <span className="text-[12px] text-danger-text">This is the sending account</span>}
        </div>

        {note ? (
          <Alert severity={note.severity} title={note.title} label={note.severity === 'danger' ? 'WARN' : undefined}>
            {note.body}
          </Alert>
        ) : (
          !to && <Alert severity="warn">Pasting an address? Clef warns if it is a token account or a program rather than a wallet.</Alert>
        )}
        {costs && h && (
          <div className="flex flex-col gap-1 text-[12px] tabular-nums">
            <span className="text-muted">
              Network fee {sol(costs.fee)} SOL
              {costs.deposit > 0n && ` · ${sol(costs.deposit)} SOL deposit to open their ${h.symbol} account`}
            </span>
            {costs.problem && <span role="alert" className="text-danger-text">{problemText(costs.problem, asset, h.symbol, costs.deposit)}</span>}
          </div>
        )}
        {error && <Alert severity="danger">{error}</Alert>}
      </div>
      {picking && (
        <TokenPicker
          holdings={holdings}
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setMint(m);
            setPicking(false);
          }}
        />
      )}
    </PopupScreen>
  );
}
