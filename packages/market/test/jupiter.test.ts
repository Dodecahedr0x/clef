import {
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type CompiledTransactionMessageWithLifetime,
  type V0CompiledTransactionMessage,
} from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { JupiterClient, JupiterError, WSOL_MINT } from '../src';
import build from './fixtures/build-sol-usdc.json';
import search from './fixtures/search-usdc.json';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TAKER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const KEY = 'secret-key-123';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

function mockFetch(...replies: Reply[]) {
  const queue = [...replies];
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const r = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  });
  return fn;
}

const urlOf = (call: unknown[]) => new URL(String(call[0]));
const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers);

function priceBody(mints: string[]) {
  return Object.fromEntries(mints.map((m, i) => [m, { usdPrice: i + 1, priceChange24h: 0.5, decimals: 6, liquidity: 1, blockId: 1 }]));
}

describe('JupiterClient headers', () => {
  it('sends x-api-key only when a key is set', async () => {
    const f1 = mockFetch({ body: {} });
    await new JupiterClient({ apiKey: KEY, fetch: f1 }).prices([USDC]);
    expect(headersOf(f1.mock.calls[0]!).get('x-api-key')).toBe(KEY);

    const f2 = mockFetch({ body: {} });
    await new JupiterClient({ apiKey: null, fetch: f2 }).prices([USDC]);
    expect(headersOf(f2.mock.calls[0]!).has('x-api-key')).toBe(false);
  });

  it('uses https://api.jup.ag by default and a configurable host', async () => {
    const f1 = mockFetch({ body: {} });
    await new JupiterClient({ apiKey: null, fetch: f1 }).prices([USDC]);
    expect(urlOf(f1.mock.calls[0]!).origin + urlOf(f1.mock.calls[0]!).pathname).toBe('https://api.jup.ag/price/v3');

    const f2 = mockFetch({ body: {} });
    await new JupiterClient({ apiKey: null, host: 'http://localhost:9999/', fetch: f2 }).prices([USDC]);
    expect(urlOf(f2.mock.calls[0]!).origin).toBe('http://localhost:9999');
  });
});

describe('JupiterClient error mapping', () => {
  async function failure(p: Promise<unknown>): Promise<JupiterError> {
    const e = await p.then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(JupiterError);
    return e as JupiterError;
  }

  it('401/403 with a key: one keyless retry, then invalid-key', async () => {
    for (const status of [401, 403]) {
      const f = mockFetch({ status, body: { code: status, message: 'Unauthorized' } });
      const e = await failure(new JupiterClient({ apiKey: KEY, fetch: f }).prices([USDC]));
      expect(e.code).toBe('invalid-key');
      expect(f).toHaveBeenCalledTimes(2);
      expect(headersOf(f.mock.calls[0]!).get('x-api-key')).toBe(KEY);
      expect(headersOf(f.mock.calls[1]!).has('x-api-key')).toBe(false);
      expect(e.message).not.toContain(KEY);
    }
  });

  it('401 with a key and a successful keyless retry: returns data and stops sending the key', async () => {
    const f = mockFetch({ status: 401, body: { message: 'Unauthorized' } }, { body: priceBody([USDC]) }, { body: {} });
    const client = new JupiterClient({ apiKey: KEY, fetch: f });
    const prices = await client.prices([USDC]);
    expect(prices[USDC]?.usdPrice).toBe(1);
    expect(client.keyRejected).toBe(true);
    await client.prices(['other']);
    expect(f).toHaveBeenCalledTimes(3);
    expect(headersOf(f.mock.calls[2]!).has('x-api-key')).toBe(false);
  });

  it('401 without a key: invalid-key, no retry', async () => {
    const f = mockFetch({ status: 401, body: {} });
    const e = await failure(new JupiterClient({ apiKey: null, fetch: f }).prices([USDC]));
    expect(e.code).toBe('invalid-key');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429: rate-limited with retryAfterMs from x-ratelimit-reset (epoch seconds)', async () => {
    const now = 1_792_140_600_000;
    const f = mockFetch({ status: 429, body: {}, headers: { 'x-ratelimit-reset': '1792140610' } });
    const e = await failure(new JupiterClient({ apiKey: null, fetch: f, now: () => now }).prices([USDC]));
    expect(e.code).toBe('rate-limited');
    expect(e.retryAfterMs).toBe(10_000);
  });

  it('429: a small x-ratelimit-reset is read as seconds from now', async () => {
    const f = mockFetch({ status: 429, body: {}, headers: { 'x-ratelimit-reset': '3' } });
    const e = await failure(new JupiterClient({ apiKey: null, fetch: f, now: () => 0 }).prices([USDC]));
    expect(e.retryAfterMs).toBe(3_000);
  });

  it('400/422: bad-request with the server message', async () => {
    const f1 = mockFetch({ status: 400, body: { error: 'Invalid amount' } });
    const e1 = await failure(new JupiterClient({ apiKey: null, fetch: f1 }).quoteAndBuild({ inputMint: 'SOL', outputMint: USDC, amount: 0n, slippageBps: 50, taker: TAKER }));
    expect(e1.code).toBe('bad-request');
    expect(e1.message).toBe('Invalid amount');

    const f2 = mockFetch({ status: 422, body: { message: 'missing taker' } });
    const e2 = await failure(new JupiterClient({ apiKey: null, fetch: f2 }).searchTokens('x'));
    expect(e2.code).toBe('bad-request');
    expect(e2.message).toBe('missing taker');
  });

  it('5xx and network errors: unavailable', async () => {
    const f1 = mockFetch({ status: 503, body: {} });
    expect((await failure(new JupiterClient({ apiKey: null, fetch: f1 }).prices([USDC]))).code).toBe('unavailable');
    const f2 = mockFetch(new TypeError('fetch failed'));
    expect((await failure(new JupiterClient({ apiKey: KEY, fetch: f2 }).prices([USDC]))).code).toBe('unavailable');
  });

  it('never echoes the API key in error messages', async () => {
    const f = mockFetch({ status: 400, body: { error: `bad key ${KEY}` } });
    const e = await failure(new JupiterClient({ apiKey: KEY, fetch: f }).prices([USDC]));
    expect(e.message).not.toContain(KEY);
  });
});

describe('JupiterClient.prices', () => {
  it('batches 50 ids per request', async () => {
    const mints = Array.from({ length: 120 }, (_, i) => `mint${i}`);
    const f = vi.fn(async (url: string | URL | Request) => {
      const ids = new URL(String(url)).searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify(priceBody(ids)));
    });
    const out = await new JupiterClient({ apiKey: null, fetch: f }).prices(mints);
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('ids')!.split(',').length)).toEqual([50, 50, 20]);
    expect(Object.keys(out)).toHaveLength(120);
  });

  it('caches for 60 s with the injected clock, including missing mints', async () => {
    let t = 1_000_000;
    const f = vi.fn(async () => new Response(JSON.stringify(priceBody([USDC]))));
    const client = new JupiterClient({ apiKey: null, fetch: f, now: () => t });
    expect(await client.prices([USDC, 'missing'])).toEqual({ [USDC]: { usdPrice: 1, priceChange24h: 0.5 } });
    t += 59_999;
    await client.prices([USDC, 'missing']);
    expect(f).toHaveBeenCalledTimes(1);
    t += 1;
    await client.prices([USDC]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("accepts 'SOL' as an alias of wSOL and keys results by the requested id", async () => {
    const f = mockFetch({ body: { [WSOL_MINT]: { usdPrice: 106.5, priceChange24h: null } } });
    const out = await new JupiterClient({ apiKey: null, fetch: f }).prices(['SOL', WSOL_MINT]);
    expect(urlOf(f.mock.calls[0]!).searchParams.get('ids')).toBe(WSOL_MINT);
    expect(out).toEqual({ SOL: { usdPrice: 106.5, priceChange24h: null }, [WSOL_MINT]: { usdPrice: 106.5, priceChange24h: null } });
  });

  it('omits entries without a numeric usdPrice', async () => {
    const f = mockFetch({ body: { [USDC]: { usdPrice: null }, other: null } });
    expect(await new JupiterClient({ apiKey: null, fetch: f }).prices([USDC, 'other'])).toEqual({});
  });

  it('makes no request for an empty list', async () => {
    const f = mockFetch({ body: {} });
    expect(await new JupiterClient({ apiKey: null, fetch: f }).prices([])).toEqual({});
    expect(f).not.toHaveBeenCalled();
  });
});

describe('JupiterClient.quoteAndBuild', () => {
  async function run() {
    const f = mockFetch({ body: build });
    const client = new JupiterClient({ apiKey: null, fetch: f });
    const res = await client.quoteAndBuild({ inputMint: 'SOL', outputMint: USDC, amount: 10_000_000n, slippageBps: 50, taker: TAKER });
    return { f, res };
  }

  it('calls GET /swap/v2/build with the swap parameters', async () => {
    const { f } = await run();
    const u = urlOf(f.mock.calls[0]!);
    expect(u.pathname).toBe('/swap/v2/build');
    expect(Object.fromEntries(u.searchParams)).toEqual({ inputMint: WSOL_MINT, outputMint: USDC, amount: '10000000', slippageBps: '50', taker: TAKER });
  });

  it('maps the quote', async () => {
    const { res } = await run();
    expect(res.quote).toMatchObject({
      inputMint: WSOL_MINT, outputMint: USDC, inAmount: 10_000_000n, outAmount: 1_067_611n, minOutAmount: 1_062_273n,
      slippageBps: 50, priceImpactPct: 0, route: [{ label: 'BisonFi', percent: 100 }],
    });
    expect(res.lastValidBlockHeight).toBe(435_612_662n);
  });

  it('assembles an unsigned v0 wire with the taker as fee payer', async () => {
    const { res } = await run();
    const tx = getTransactionDecoder().decode(res.wire);
    expect(Object.keys(tx.signatures)).toEqual([TAKER]);
    expect(Object.values(tx.signatures)).toEqual([null]);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as V0CompiledTransactionMessage & CompiledTransactionMessageWithLifetime;
    expect(msg.version).toBe(0);
    expect(res.wire.length).toBeLessThanOrEqual(1232);
    expect(msg.staticAccounts[0]).toBe(TAKER);
    expect(msg.header.numSignerAccounts).toBe(1);

    const programs = msg.instructions.map((ix) => msg.staticAccounts[ix.programAddressIndex]);
    const expected = [
      ...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction, build.cleanupInstruction,
    ].map((ix) => ix.programId);
    expect(programs).toEqual(expected);

    const luts = Object.keys(build.addressesByLookupTableAddress);
    for (const l of msg.addressTableLookups ?? []) expect(luts).toContain(l.lookupTableAddress);
    expect((msg.addressTableLookups ?? []).length).toBeGreaterThan(0);
  });

  it('uses the blockhash from blockhashWithMetadata', async () => {
    const { res } = await run();
    const tx = getTransactionDecoder().decode(res.wire);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as CompiledTransactionMessageWithLifetime;
    expect(msg.lifetimeToken).toBe(getBase58Decoder().decode(Uint8Array.from(build.blockhashWithMetadata.blockhash)));
  });

  it('rejects a response without a swap instruction as unavailable', async () => {
    const f = mockFetch({ body: { ...build, swapInstruction: null } });
    const e = await new JupiterClient({ apiKey: null, fetch: f })
      .quoteAndBuild({ inputMint: 'SOL', outputMint: USDC, amount: 1n, slippageBps: 50, taker: TAKER })
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(JupiterError);
    expect((e as JupiterError).code).toBe('unavailable');
  });
});

describe('JupiterClient.searchTokens', () => {
  it('maps /tokens/v2/search results', async () => {
    const f = mockFetch({ body: search });
    const out = await new JupiterClient({ apiKey: null, fetch: f }).searchTokens('usdc');
    const u = urlOf(f.mock.calls[0]!);
    expect(u.pathname).toBe('/tokens/v2/search');
    expect(u.searchParams.get('query')).toBe('usdc');
    expect(out[0]).toEqual({ mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: expect.stringContaining('https://'), verified: true });
    expect(out.find((t) => t.mint === '4gzEcpFzKDaWJjSYP3XdgUYdfY18Q5T9LApJESSbpump')?.verified).toBe(false);
  });
});
