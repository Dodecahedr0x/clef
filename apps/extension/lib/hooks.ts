import { explainBatch, explainLanded, viewForBatch, type BatchView, type DetailLevel, type ExplainedBatch } from '@clef/explain';
import { loadHistory, loadPortfolio, type HistoryItem, type Portfolio } from '@clef/portfolio';
import type { Contact, PublicAccount, UserIdl } from '@clef/wallet-core';
import { isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, type Address } from '@solana/kit';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { browser } from 'wxt/browser';
import { call, getState, type FullState } from './api';
import { ClientsContext, createExplainContext, type Clients, type ExplainExtras } from './clients';

/** Error text for the UI; RPC transport failures get a readable reason instead of a raw Solana error code. */
const message = (e: unknown): string => {
  if (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = e.context.statusCode;
    if (status === 429) return 'Your RPC is rate-limiting requests. Try again in a moment, or add your own provider URL in Settings → Network & RPC.';
    if (status === 401 || status === 403) return `Your RPC refused the request (HTTP ${status}). Check the RPC URL in Settings → Network & RPC.`;
    return `Your RPC request failed (HTTP ${status}).`;
  }
  const server = (e as { context?: { __serverMessage?: unknown } } | null)?.context?.__serverMessage;
  if (typeof server === 'string' && server) return `Your RPC answered: ${server}`;
  return e instanceof Error ? e.message : String(e);
};

// One wallet snapshot shared by every mounted useWallet; dropped when the last one unmounts.
type WalletSnapshot = { state: FullState | null; error: string | null };
const EMPTY: WalletSnapshot = { state: null, error: null };
let snapshot = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();

function publish(next: WalletSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

async function refreshWallet(): Promise<void> {
  const mine = ++seq;
  try {
    const state = await getState();
    if (mine === seq) publish({ state, error: null });
  } catch (e) {
    if (mine === seq) publish({ state: snapshot.state, error: message(e) });
  }
}

const onStorageChanged = () => void refreshWallet();

function subscribeWallet(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    browser.storage.onChanged.addListener(onStorageChanged);
    void refreshWallet();
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      browser.storage.onChanged.removeListener(onStorageChanged);
      seq++;
      snapshot = EMPTY;
    }
  };
}

export function useWallet(): { state: FullState | null; error: string | null; refresh(): Promise<void> } {
  const s = useSyncExternalStore(subscribeWallet, () => snapshot);
  return { state: s.state, error: s.error, refresh: refreshWallet };
}

export function useActiveAccount(): PublicAccount | null {
  const { state } = useWallet();
  if (!state) return null;
  return state.accounts.find((a) => a.address === state.activeAccount) ?? state.accounts[0] ?? null;
}

export function useClients(): Clients | null {
  const factory = useContext(ClientsContext);
  const settings = useWallet().state?.settings;
  const rpcUrl = settings?.rpcUrl;
  const apiKey = settings?.jupiterApiKey;
  // Rebuilt only when the endpoint or key changes, not on every state refetch.
  return useMemo(() => (settings ? factory(settings) : null), [factory, rpcUrl, apiKey]);
}

export function useCall<T>(
  type: string,
  params?: Record<string, unknown>,
  deps: unknown[] = [],
): { data: T | null; error: string | null; loading: boolean; reload(): void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    let live = true;
    setLoading(true);
    call<T>({ ...paramsRef.current, type })
      .then((v) => live && (setData(v), setError(null)))
      .catch((e: unknown) => live && setError(message(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [type, tick, ...deps]);

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function usePortfolio(owner: Address | null): { data: Portfolio | null; loading: boolean; error: string | null; refresh(): void } {
  const clients = useClients();
  const hideSpam = useWallet().state?.settings.hideSpam ?? true;
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!owner || !clients) return;
    let live = true;
    setLoading(true);
    loadPortfolio({ reader: clients.portfolio, chain: clients.chain, prices: clients.jupiter }, owner, { hideSpam })
      .then((p) => live && (setData(p), setError(null)))
      .catch((e: unknown) => live && setError(message(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [owner, clients, hideSpam, tick]);

  useEffect(() => setData(null), [owner, clients]);

  return { data: owner ? data : null, loading, error, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

const HISTORY_PAGE = 20;

function useExplainExtras(): ExplainExtras | null {
  const contacts = useCall<Contact[]>('contacts:list');
  const idls = useCall<UserIdl[]>('idls:list');
  const reloadIdls = idls.reload;
  // An IDL added elsewhere (Settings, the Add IDL link) applies to explanations on screen right away.
  useEffect(() => {
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'userIdls' in changes) reloadIdls();
    };
    browser.storage?.onChanged?.addListener(onChange);
    return () => browser.storage?.onChanged?.removeListener(onChange);
  }, [reloadIdls]);
  const loading = contacts.loading || idls.loading;
  // Labels and user IDLs are optional: explain without them rather than not at all.
  return useMemo(() => (loading ? null : { contacts: contacts.data ?? [], userIdls: idls.data ?? [] }), [loading, contacts.data, idls.data]);
}

export function useHistory(owner: Address | null): { items: HistoryItem[]; loading: boolean; error: string | null; loadMore(): void; retry(): void; hasMore: boolean } {
  const { state } = useWallet();
  const clients = useClients();
  const extras = useExplainExtras();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [next, setNext] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const ready = owner && clients && state && extras;

  const page = useCallback(
    (before: string | undefined) => {
      if (!owner || !clients || !state || !extras) return;
      const mine = run.current;
      setLoading(true);
      const explainCtx = createExplainContext(state, extras, clients.chain);
      loadHistory({ reader: clients.portfolio, chain: clients.chain, explainCtx }, owner, { ...(before ? { before } : {}), limit: HISTORY_PAGE })
        .then((r) => {
          if (mine !== run.current) return;
          setItems((prev) => (before ? [...prev, ...r.items] : r.items));
          setNext(r.next);
          setHasMore(r.next !== undefined);
          setError(null);
        })
        .catch((e: unknown) => mine === run.current && setError(message(e)))
        .finally(() => mine === run.current && setLoading(false));
    },
    [owner, clients, state, extras],
  );

  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    run.current++;
    setItems([]);
    setNext(undefined);
    setHasMore(false);
    setError(null);
    if (ready) pageRef.current(undefined);
  }, [owner, clients, Boolean(ready)]);

  const loadMore = useCallback(() => {
    if (next !== undefined && !loading) pageRef.current(next);
  }, [next, loading]);

  /** Loads again the page that failed: the first one, or the one after what is shown. */
  const retry = useCallback(() => {
    if (!loading) pageRef.current(items.length ? next : undefined);
  }, [items.length, next, loading]);

  return { items, loading, error, loadMore, retry, hasMore };
}

const HEALTH_POLL_MS = 15_000;

export function useHealth(): { slot: bigint | null; latencyMs: number | null } {
  const clients = useClients();
  const [health, setHealth] = useState<{ slot: bigint | null; latencyMs: number | null }>({ slot: null, latencyMs: null });

  useEffect(() => {
    if (!clients) return;
    let live = true;
    const probe = () =>
      clients.portfolio
        .getHealth()
        .then((h) => live && setHealth({ slot: h.slot, latencyMs: h.latencyMs }))
        .catch(() => live && setHealth({ slot: null, latencyMs: null }));
    void probe();
    const timer = setInterval(probe, HEALTH_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [clients]);

  return health;
}

export type ExplainBatchResult = { status: 'loading' } | { status: 'ok'; batch: ExplainedBatch; view: BatchView } | { status: 'failed'; error: string };

/** Fails closed: any error while explaining yields `failed`, which the approval UI treats as danger. */
export function useExplainBatch(wires: Uint8Array[] | null, level: DetailLevel): ExplainBatchResult {
  const { state } = useWallet();
  const clients = useClients();
  const extras = useExplainExtras();
  const [batch, setBatch] = useState<{ wires: Uint8Array[]; result: { ok: true; batch: ExplainedBatch } | { ok: false; error: string } } | null>(null);
  const ready = wires && state && clients && extras;

  useEffect(() => {
    if (!wires || !state || !clients || !extras) return;
    let live = true;
    (async () => {
      try {
        const ctx = createExplainContext(state, extras, clients.chain);
        const b = await explainBatch(
          wires.map((wire) => ({ wire })),
          ctx,
        );
        if (live) setBatch({ wires, result: { ok: true, batch: b } });
      } catch (e) {
        if (live) setBatch({ wires, result: { ok: false, error: message(e) || 'Explanation failed' } });
      }
    })();
    return () => {
      live = false;
    };
    // Re-explain on new wires or a new RPC endpoint, not on unrelated state refetches.
  }, [wires, clients, Boolean(ready), extras?.userIdls]);

  return useMemo<ExplainBatchResult>(() => {
    if (!batch || batch.wires !== wires) return { status: 'loading' };
    if (!batch.result.ok) return { status: 'failed', error: batch.result.error };
    try {
      return { status: 'ok', batch: batch.result.batch, view: viewForBatch(batch.result.batch, level) };
    } catch (e) {
      return { status: 'failed', error: message(e) || 'Explanation failed' };
    }
  }, [batch, wires, level]);
}

export type LandedResult = ExplainBatchResult & { blockTime?: number | null };

/** Explains a transaction already on chain (from its recorded meta) for the history detail; fails closed like useExplainBatch. */
export function useExplainLanded(signature: string, level: DetailLevel): LandedResult {
  const { state } = useWallet();
  const clients = useClients();
  const extras = useExplainExtras();
  const [run, setRun] = useState<{ ok: true; batch: ExplainedBatch; blockTime: number | null } | { ok: false; error: string } | null>(null);
  const ready = state && clients && extras;

  useEffect(() => {
    if (!state || !clients || !extras) return;
    let live = true;
    (async () => {
      try {
        const fetched = await clients.chain.getTransaction(signature);
        if (!fetched) throw new Error('Transaction not found on this network');
        if (!fetched.meta) throw new Error('This RPC returned the transaction without its result');
        const batch = await explainLanded({ wire: fetched.wire, meta: fetched.meta }, createExplainContext(state, extras, clients.chain));
        if (live) setRun({ ok: true, batch, blockTime: fetched.blockTime === null ? null : Number(fetched.blockTime) });
      } catch (e) {
        if (live) setRun({ ok: false, error: message(e) || 'Could not load the transaction' });
      }
    })();
    return () => {
      live = false;
    };
  }, [signature, clients, Boolean(ready), extras?.userIdls]);

  return useMemo<LandedResult>(() => {
    if (!run) return { status: 'loading' };
    if (!run.ok) return { status: 'failed', error: run.error };
    try {
      return { status: 'ok', batch: run.batch, view: viewForBatch(run.batch, level), blockTime: run.blockTime };
    } catch (e) {
      return { status: 'failed', error: message(e) || 'Explanation failed' };
    }
  }, [run, level]);
}
