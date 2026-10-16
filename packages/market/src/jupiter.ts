import { assembleSwap, type BuildResponse } from './build';
import {
  JupiterError,
  WSOL_MINT,
  type JupiterConfig,
  type PriceQuote,
  type PriceSource,
  type SwapQuote,
  type TokenSearchResult,
} from './types';

const DEFAULT_HOST = 'https://api.jup.ag';
const PRICE_BATCH = 50;
const PRICE_TTL_MS = 60_000;

const resolveMint = (m: string) => (m === 'SOL' ? WSOL_MINT : m);

export class JupiterClient implements PriceSource {
  readonly #host: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #apiKey: string | null;
  readonly #priceCache = new Map<string, { at: number; quote: PriceQuote | null }>();

  constructor(cfg: JupiterConfig) {
    this.#host = (cfg.host ?? DEFAULT_HOST).replace(/\/+$/, '');
    this.#fetch = cfg.fetch ?? ((...a) => globalThis.fetch(...a));
    this.#now = cfg.now ?? Date.now;
    this.#apiKey = cfg.apiKey || null;
  }

  async prices(mints: readonly string[]): Promise<Record<string, PriceQuote>> {
    const now = this.#now();
    const wanted = [...new Set(mints.map(resolveMint))];
    const stale = wanted.filter((m) => {
      const hit = this.#priceCache.get(m);
      return !hit || now - hit.at >= PRICE_TTL_MS;
    });
    for (let i = 0; i < stale.length; i += PRICE_BATCH) {
      const batch = stale.slice(i, i + PRICE_BATCH);
      const body = await this.#get('/price/v3', { ids: batch.join(',') });
      const at = this.#now();
      const table = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      for (const m of batch) this.#priceCache.set(m, { at, quote: parsePrice(table[m]) });
    }
    const out: Record<string, PriceQuote> = {};
    for (const m of mints) {
      const quote = this.#priceCache.get(resolveMint(m))?.quote;
      if (quote) out[m] = quote;
    }
    return out;
  }

  async quoteAndBuild(p: {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    slippageBps: number;
    taker: string;
  }): Promise<{ quote: SwapQuote; wire: Uint8Array; lastValidBlockHeight: bigint }> {
    const res = (await this.#get('/swap/v2/build', {
      inputMint: resolveMint(p.inputMint),
      outputMint: resolveMint(p.outputMint),
      amount: p.amount.toString(),
      slippageBps: String(p.slippageBps),
      taker: p.taker,
    })) as BuildResponse;
    let quote: SwapQuote;
    try {
      quote = {
        inputMint: res.inputMint,
        outputMint: res.outputMint,
        inAmount: BigInt(res.inAmount),
        outAmount: BigInt(res.outAmount),
        minOutAmount: BigInt(res.otherAmountThreshold),
        slippageBps: res.slippageBps,
        priceImpactPct: Number(res.priceImpactPct) || 0,
        route: (res.routePlan ?? []).map((r) => ({ label: r.swapInfo?.label ?? 'Unknown', percent: r.percent })),
        raw: res,
      };
    } catch {
      throw new JupiterError('unavailable', 'Jupiter returned an unusable quote');
    }
    const { wire, lastValidBlockHeight } = assembleSwap(res, p.taker);
    return { quote, wire, lastValidBlockHeight };
  }

  async searchTokens(query: string): Promise<TokenSearchResult[]> {
    const body = await this.#get('/tokens/v2/search', { query });
    if (!Array.isArray(body)) return [];
    return body.flatMap((t: Record<string, unknown>) => {
      if (typeof t.id !== 'string' || typeof t.decimals !== 'number') return [];
      const tags = Array.isArray(t.tags) ? t.tags : [];
      const r: TokenSearchResult = {
        mint: t.id,
        symbol: typeof t.symbol === 'string' ? t.symbol : '',
        name: typeof t.name === 'string' ? t.name : '',
        decimals: t.decimals,
        verified: t.isVerified === true || tags.includes('verified'),
      };
      if (typeof t.icon === 'string' && t.icon) r.icon = t.icon;
      return [r];
    });
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.#host}${path}?${new URLSearchParams(params)}`;
    // A rejected key fails loudly (invalid-key); there is no silent keyless fallback.
    const res = await this.#send(url, this.#apiKey);
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new JupiterError('unavailable', 'Jupiter returned an invalid response');
      }
    }
    throw await this.#toError(res);
  }

  async #send(url: string, key: string | null): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (key) headers['x-api-key'] = key;
    try {
      return await this.#fetch(url, { headers });
    } catch {
      throw new JupiterError('unavailable', 'Jupiter is unreachable');
    }
  }

  async #toError(res: Response): Promise<JupiterError> {
    if (res.status === 401 || res.status === 403) {
      return new JupiterError('invalid-key', 'Jupiter rejected the API key');
    }
    if (res.status === 429) {
      return new JupiterError('rate-limited', 'Jupiter rate limit reached', this.#retryAfter(res.headers));
    }
    if (res.status === 400 || res.status === 422) {
      const text = await res.text().catch(() => '');
      return new JupiterError('bad-request', this.#scrub(serverMessage(text) ?? `Jupiter rejected the request (${res.status})`));
    }
    return new JupiterError('unavailable', `Jupiter is unavailable (${res.status})`);
  }

  #retryAfter(h: Headers): number | undefined {
    const reset = Number(h.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) {
      // Live responses carry epoch seconds; small values are read as a delay in seconds.
      return reset > 1e9 ? Math.max(0, reset * 1000 - this.#now()) : reset * 1000;
    }
    const after = Number(h.get('retry-after'));
    return Number.isFinite(after) && after > 0 ? after * 1000 : undefined;
  }

  #scrub(message: string): string {
    return this.#apiKey ? message.split(this.#apiKey).join('***') : message;
  }
}

function serverMessage(text: string): string | null {
  try {
    const b = JSON.parse(text) as Record<string, unknown>;
    for (const k of ['error', 'message', 'errorMessage']) {
      const v = b?.[k];
      if (typeof v === 'string' && v) return v.slice(0, 300);
    }
  } catch {
    /* not JSON */
  }
  return text ? text.slice(0, 300) : null;
}

function parsePrice(v: unknown): PriceQuote | null {
  if (!v || typeof v !== 'object') return null;
  const { usdPrice, priceChange24h } = v as Record<string, unknown>;
  if (typeof usdPrice !== 'number' || !Number.isFinite(usdPrice)) return null;
  return { usdPrice, priceChange24h: typeof priceChange24h === 'number' ? priceChange24h : null };
}
