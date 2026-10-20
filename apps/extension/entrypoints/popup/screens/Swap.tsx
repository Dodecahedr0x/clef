import { useEffect, useMemo, useState } from 'react';
import type { SwapQuote } from '@clef/market';
import { tokenAccountRent, WALLET_RENT_MIN } from '@clef/portfolio';
import { Alert, Avatar, Button, ErrorNote, Icon, PopupScreen, Segmented, Sheet, Spinner } from '../../../components';
import { call } from '../../../lib/api';
import { createClients } from '../../../lib/clients';
import { sendErrorText, type ErrorText } from '../../../lib/error-text';
import { formatToken, formatUsd, shortAddress } from '../../../lib/format';
import { useActiveAccount, usePortfolio, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';
import { avatarTone } from './Portfolio';
import { SendStatus } from './SendStatus';
import { TokenButton, errorMessage, parseAmount, toBase64, unitsToInput } from './Send';

/**
 * SOL that MAX keeps back when swapping SOL: Jupiter's priority fee (well under 0.001 SOL), the wrapped-SOL account
 * it opens for the swap (refunded) and the output token account if it is new, while the wallet stays above the
 * minimum it must hold. About 0.006 SOL.
 */
export const SWAP_SOL_RESERVE = 1_000_000n + 2n * tokenAccountRent('token') + WALLET_RENT_MIN;

export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const REFRESH_SECONDS = 15;
const SLIPPAGES = [10, 50, 100, 300] as const;

type TokenMeta = { mint: string; symbol: string; name: string; decimals: number; logoUri?: string };
const DEFAULT_META: Record<string, TokenMeta> = {
  SOL: { mint: 'SOL', symbol: 'SOL', name: 'Solana', decimals: 9 },
  [USDC]: { mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
};

const jupMint = (m: string) => (m === 'SOL' ? WSOL : m);
const units = (a: bigint, decimals: number) => Number(a) / 10 ** decimals;

/**
 * Words for a failed swap. Quote failures come from Jupiter; rate limits and key problems point at the Jupiter key
 * (Settings → Swaps). Anything else happened while sending, and reads like a failed send.
 */
export type SwapErrorText = ErrorText & { jupiterKey?: boolean };
export function swapErrorText(e: unknown, opts: { rpcUrl?: string; slippageBps?: number } = {}): SwapErrorText {
  const code = (e as { code?: unknown } | null)?.code;
  const retry = (e as { retryAfterMs?: number } | null)?.retryAfterMs;
  const detail = errorMessage(e) || undefined;
  switch (code) {
    case 'rate-limited':
      return {
        tone: 'danger',
        title: 'Jupiter is rate-limiting quotes',
        body: `Keyless access is shared and limited.${retry ? ` Try again in ${Math.ceil(retry / 1000)} s,` : ' Try again shortly,'} or add a free Jupiter API key in Settings → Swaps.`,
        jupiterKey: true,
      };
    case 'invalid-key':
      return { tone: 'danger', title: 'Jupiter rejected your API key', body: 'Check the key in Settings → Swaps, or remove it to use keyless access.', jupiterKey: true };
    case 'bad-request':
      return { tone: 'danger', title: 'No quote for this swap', body: 'Jupiter could not price this swap. Try another amount or token.', detail };
    case 'unavailable':
      return { tone: 'danger', title: 'Jupiter is unavailable', body: 'Quotes could not be fetched. Try again in a moment.', detail };
    default: {
      const t = sendErrorText(e, opts);
      return t.tone === 'neutral' ? { ...t, title: 'Cancelled. Nothing was swapped.' } : t;
    }
  }
}

function fmtRate(n: number): string {
  return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : n.toPrecision(4);
}

function Picker({
  title,
  options,
  search,
  onPick,
  onClose,
}: {
  title: string;
  options: (TokenMeta & { balance?: string })[];
  search: ((q: string) => Promise<TokenMeta[]>) | null;
  onPick: (t: TokenMeta) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<TokenMeta[] | null>(null);
  useEffect(() => {
    if (!search || q.trim().length < 2) return setFound(null);
    let live = true;
    const t = setTimeout(() => {
      search(q.trim())
        .then((r) => live && setFound(r))
        .catch(() => live && setFound([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const local = options.filter((o) => !q || `${o.symbol} ${o.name}`.toLowerCase().includes(q.toLowerCase()));
  const list: (TokenMeta & { balance?: string })[] = found ? [...local, ...found.filter((f) => !local.some((l) => jupMint(l.mint) === f.mint))] : local;
  return (
    <Sheet title={title} onClose={onClose}>
      {search && (
        <div className="px-4 pt-3">
          <input
            aria-label="Search tokens"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or symbol"
            className="w-full h-11 px-3 bg-surface border border-field-line rounded-[12px] text-[14px] outline-none"
          />
        </div>
      )}
      <ul className="list-none m-0 p-2 overflow-y-auto">
        {list.map((t) => (
          <li key={t.mint}>
            <button type="button" onClick={() => onPick(t)} className="w-full h-14 px-2 flex items-center gap-3 bg-transparent border-0 rounded-[10px] text-left text-ink hover:bg-surface-2">
              <Avatar text={t.symbol.slice(0, 1) || '?'} tone={avatarTone(t.mint)} size={30} src={t.logoUri} />
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-[14px] font-medium">{t.symbol}</span>
                <span className="text-[12px] text-muted truncate">{t.name}</span>
              </span>
              {t.balance !== undefined && <span className="text-[12px] text-muted tabular-nums">{t.balance}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function SwapScreen() {
  const nav = useNav();
  const route = nav.route.name === 'swap' ? nav.route : null;
  const { state } = useWallet();
  const account = useActiveAccount();
  const settings = state?.settings ?? null;
  const { data } = usePortfolio(account?.address ?? null);
  const clients = useMemo(() => (settings ? createClients(settings) : null), [settings?.rpcUrl, settings?.network, settings?.jupiterApiKey]);
  const jupiter = clients?.jupiter ?? null;

  const [inMint, setInMint] = useState(route?.inputMint ?? 'SOL');
  const [outMint, setOutMint] = useState(route?.outputMint ?? (route?.inputMint === USDC ? 'SOL' : USDC));
  const [extra, setExtra] = useState<Record<string, TokenMeta>>({});
  const [amountText, setAmountText] = useState('');
  const [slippageBps, setSlippageBps] = useState(100);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [picking, setPicking] = useState<'in' | 'out' | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [secs, setSecs] = useState(REFRESH_SECONDS);
  const [nonce, setNonce] = useState(0);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ signature: string; lastValidBlockHeight?: bigint; what: string } | null>(null);

  const holding = (m: string) => data?.holdings.find((h) => h.mint === m);
  const meta = (m: string): TokenMeta | undefined => {
    const h = holding(m);
    if (h) return { mint: h.mint, symbol: h.symbol, name: h.name, decimals: h.decimals, logoUri: h.logoUri };
    return extra[m] ?? DEFAULT_META[m];
  };
  const inMeta = meta(inMint);
  const outMeta = meta(outMint);
  const inHolding = holding(inMint);
  const amount = inMeta ? parseAmount(amountText, inMeta.decimals) : null;
  const tooMuch = amount !== null && amount > (inHolding?.amount ?? 0n);
  const cluster = settings?.network === 'custom' ? settings.customCluster : settings?.network;
  const supported = cluster === 'mainnet' || cluster === 'localnet';
  const ready = !!jupiter && !!account && !!inMeta && !!outMeta && inMint !== outMint && amount !== null && amount > 0n && supported;

  useEffect(() => {
    if (!jupiter || !supported) return;
    let live = true;
    jupiter
      .prices([jupMint(inMint), jupMint(outMint)])
      .then((p) => live && setPrices(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.usdPrice]))))
      .catch(() => live && setPrices({}));
    return () => {
      live = false;
    };
  }, [jupiter, inMint, outMint, supported]);

  useEffect(() => {
    if (!ready) {
      setQuote(null);
      setError(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await jupiter!.quoteAndBuild({ inputMint: jupMint(inMint), outputMint: jupMint(outMint), amount: amount!, slippageBps, taker: account!.address });
        if (!live) return;
        setQuote(r.quote);
        setError(null);
        setSecs(REFRESH_SECONDS);
      } catch (e) {
        if (!live) return;
        setQuote(null);
        setError(e);
      } finally {
        if (live) setQuoting(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ready, jupiter, inMint, outMint, amount, slippageBps, account?.address, nonce]);

  useEffect(() => {
    if (!quote || busy) return;
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [quote, busy]);

  useEffect(() => {
    if (quote && secs === 0 && !busy) setNonce((n) => n + 1);
  }, [secs]);

  const flip = () => {
    setInMint(outMint);
    setOutMint(inMint);
    setAmountText('');
  };
  const max = () => {
    if (!inHolding) return;
    const v = inHolding.program === 'native' ? (inHolding.amount > SWAP_SOL_RESERVE ? inHolding.amount - SWAP_SOL_RESERVE : 0n) : inHolding.amount;
    setAmountText(unitsToInput(v, inHolding.decimals));
  };

  const review = async () => {
    if (!ready || tooMuch) return;
    setBusy(true);
    setError(null);
    try {
      // Build again: the transaction must carry a fresh blockhash and the latest route.
      const r = await jupiter!.quoteAndBuild({ inputMint: jupMint(inMint), outputMint: jupMint(outMint), amount: amount!, slippageBps, taker: account!.address });
      setQuote(r.quote);
      const res = await call<{ signatures?: string[] }>({
        type: 'wallet:submit',
        account: account!.address,
        transactions: [toBase64(r.wire)],
        send: true,
        purpose: 'swap',
      });
      const what = `${amountText} ${inMeta?.symbol ?? ''} → ${outMeta?.symbol ?? ''}`;
      setDone({ signature: res.signatures?.[0] ?? '', ...(account!.kind !== 'squads' && { lastValidBlockHeight: r.lastValidBlockHeight }), what });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <SendStatus
        kind="swap"
        what={done.what}
        signature={done.signature}
        {...(done.lastValidBlockHeight !== undefined && { lastValidBlockHeight: done.lastValidBlockHeight })}
        confirmer={clients?.portfolio ?? null}
        onDone={() => nav.reset({ name: 'home' })}
        onRetry={() => setDone(null)}
      />
    );
  }

  const inUsd = amount !== null && inMeta && prices[jupMint(inMint)] != null ? units(amount, inMeta.decimals) * prices[jupMint(inMint)]! : null;
  const outUi = quote && outMeta ? units(quote.outAmount, outMeta.decimals) : null;
  const outUsd = outUi !== null && prices[jupMint(outMint)] != null ? outUi * prices[jupMint(outMint)]! : null;
  const rate = quote && inMeta && outMeta ? units(quote.outAmount, outMeta.decimals) / units(quote.inAmount, inMeta.decimals) : null;
  const impact = quote ? (quote.priceImpactPct < 0.01 ? '<0.01%' : `${quote.priceImpactPct.toFixed(2)}%`) : null;
  const err = error ? swapErrorText(error, { rpcUrl: settings?.rpcUrl, slippageBps }) : null;
  const pickerOptions = (data?.holdings.filter((h) => !h.spam) ?? []).map((h) => ({
    mint: h.mint,
    symbol: h.symbol,
    name: h.name,
    decimals: h.decimals,
    logoUri: h.logoUri,
    balance: h.uiAmount,
  }));

  return (
    <PopupScreen
      title="Swap"
      onBack={nav.back}
      right={
        <button
          type="button"
          aria-label={`Slippage settings, currently ${(slippageBps / 100).toFixed(1)}%`}
          onClick={() => setSlippageOpen((o) => !o)}
          className="h-9 flex items-center gap-1.5 px-3 bg-surface border border-line rounded-full text-ink text-[12px]"
        >
          <Icon name="sliders" size={14} />
          <span>{(slippageBps / 100).toFixed(1)}%</span>
        </button>
      }
      footer={
        <div className="px-4 pt-3 pb-4 flex flex-col gap-2">
          <Button block size="lg" disabled={!ready || !quote || tooMuch || busy} onClick={() => void review()}>
            {busy ? 'Waiting for approval…' : 'Review swap'}
          </Button>
          <span className="text-[12px] text-muted text-center">You’ll see what the transaction does before signing</span>
        </div>
      }
    >
      <div className="relative px-4 pt-4 flex flex-col flex-1">
        {slippageOpen && (
          <div className="mb-3 p-3 bg-surface border border-line rounded-[14px] flex flex-col gap-2">
            <span className="text-[12px] text-muted">Max slippage</span>
            <Segmented
              ariaLabel="Max slippage"
              fill
              size="sm"
              options={SLIPPAGES.map((b) => ({ value: String(b), label: `${(b / 100).toFixed(1)}%` }))}
              value={String(slippageBps)}
              onChange={(v) => {
                setSlippageBps(Number(v));
                setSlippageOpen(false);
              }}
            />
          </div>
        )}
        {!supported && settings && <Alert severity="info">Swaps use Jupiter and are only available on Mainnet.</Alert>}

        <div className="relative flex flex-col gap-1.5">
          <section className="p-3.5 bg-surface border border-field-line rounded-[14px] flex flex-col gap-2">
            <div className="flex items-center text-[12px] text-muted">
              <label htmlFor="swap-pay">You pay</label>
              <span className="ml-auto tabular-nums">Balance {inHolding ? formatToken(inHolding.amount, inHolding.decimals) : '0'}</span>
              <button type="button" onClick={max} className="ml-2 h-7 px-2.5 bg-transparent border border-line-strong rounded-full text-ink text-[12px] font-semibold">
                MAX
              </button>
            </div>
            <div className="flex items-center gap-2.5">
              <input
                id="swap-pay"
                value={amountText}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={tooMuch || undefined}
                aria-describedby={tooMuch ? 'swap-pay-error' : undefined}
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ink text-[30px] font-semibold tracking-[-0.02em] tabular-nums"
              />
              <TokenButton h={inMeta} label="Choose token to pay" onClick={() => setPicking('in')} />
            </div>
            <span className="text-[12px] text-muted tabular-nums">{inUsd !== null ? `≈ ${formatUsd(inUsd)}` : ' '}</span>
          </section>

          <button
            type="button"
            aria-label="Switch tokens"
            onClick={flip}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-surface border border-line-strong rounded-[12px] shadow-[0_0_0_4px_var(--color-bg)] z-[1]"
          >
            <Icon name="swap" size={16} />
          </button>

          <section className="p-3.5 bg-surface border border-line rounded-[14px] flex flex-col gap-2">
            <div className="flex items-center text-[12px] text-muted">
              <span>You receive</span>
              <span className="ml-auto tabular-nums">Balance {holding(outMint) ? formatToken(holding(outMint)!.amount, holding(outMint)!.decimals) : '0'}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span data-testid="swap-out" className="flex-1 min-w-0 text-[30px] font-semibold tracking-[-0.02em] tabular-nums truncate">
                {quote && outMeta ? formatToken(quote.outAmount, outMeta.decimals) : quoting ? <Spinner size={20} /> : '0'}
              </span>
              <TokenButton h={outMeta} label="Choose token to receive" onClick={() => setPicking('out')} />
            </div>
            <span className="text-[12px] text-muted tabular-nums">
              {quote ? `${outUsd !== null ? `≈ ${formatUsd(outUsd)} · ` : ''}price impact ${impact}` : ' '}
            </span>
          </section>
        </div>

        {tooMuch && (
          <span id="swap-pay-error" role="alert" className="mt-2 text-[12px] text-danger-text">
            More than your balance
          </span>
        )}

        {err && (
          <div className="mt-3.5">
            {err.jupiterKey ? (
              <Alert severity="warn" title={err.title}>
                {err.body}
                <button type="button" onClick={() => nav.go({ name: 'settings' })} className="block mt-1 p-0 bg-transparent border-0 text-info underline text-[12px]">
                  Open Settings
                </button>
              </Alert>
            ) : (
              <ErrorNote text={err} onRpc={() => nav.go({ name: 'settings/network' })} />
            )}
          </div>
        )}

        {quote && inMeta && outMeta && (
          <dl className="mt-3.5 mb-0 mx-0 px-3.5 py-3 bg-surface border border-line rounded-[14px] grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 gap-x-3 text-[12px] tabular-nums">
            <dt className="text-muted">Rate</dt>
            <dd className="m-0 text-right">
              1 {inMeta.symbol} = {rate !== null ? fmtRate(rate) : '—'} {outMeta.symbol}
            </dd>
            <dt className="text-muted">Minimum received</dt>
            <dd className="m-0 text-right">
              {formatToken(quote.minOutAmount, outMeta.decimals)} {outMeta.symbol}
            </dd>
            <dt className="text-muted">Route</dt>
            <dd className="m-0 text-right">
              {quote.route.map((r) => r.label).join(' → ') || 'Direct'} <span className="text-muted">via Jupiter</span>
            </dd>
            <dt className="text-muted">Network fee</dt>
            <dd className="m-0 text-right">Shown before signing</dd>
            <dt className="text-muted">Clef fee</dt>
            <dd className="m-0 text-right text-ok">None</dd>
          </dl>
        )}

        {quote && (
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="mt-auto pt-3 flex items-center gap-2 bg-transparent border-0 p-0 text-[12px] text-muted text-left"
          >
            <Icon name="refresh" size={14} />
            <span>Quote refreshes in {secs} s</span>
          </button>
        )}
        {!quote && <span className="mt-auto pt-3 text-[12px] text-muted">Quotes by Jupiter</span>}
      </div>
      {picking && (
        <Picker
          title={picking === 'in' ? 'You pay' : 'You receive'}
          options={pickerOptions}
          search={
            picking === 'out' && jupiter
              ? async (q) =>
                  (await jupiter.searchTokens(q)).map((t) => ({ mint: t.mint === WSOL ? 'SOL' : t.mint, symbol: t.symbol, name: t.name, decimals: t.decimals, logoUri: t.icon }))
              : null
          }
          onClose={() => setPicking(null)}
          onPick={(t) => {
            setExtra((x) => ({ ...x, [t.mint]: t }));
            if (picking === 'in') setInMint(t.mint);
            else setOutMint(t.mint);
            setPicking(null);
          }}
        />
      )}
    </PopupScreen>
  );
}
