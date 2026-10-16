import { address, getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { KitPortfolioReader, RpcError, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, UnsupportedMethodError, decodeTokenAccount } from '../src';
import { mockFetch, type RpcRequest } from './mock-fetch';

const URL = 'http://rpc.test';
const OWNER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');

function addr(i: number): Address {
  const bytes = new Uint8Array(32);
  bytes[0] = i;
  bytes[31] = 1;
  return getAddressDecoder().decode(bytes);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function tokenAccount(p: { mint: Address; owner: Address; amount: bigint; delegate?: Address; delegated?: bigint; state?: number; extra?: number }): string {
  const data = new Uint8Array(165 + (p.extra ?? 0));
  const view = new DataView(data.buffer);
  const enc = getAddressEncoder();
  data.set(enc.encode(p.mint), 0);
  data.set(enc.encode(p.owner), 32);
  view.setBigUint64(64, p.amount, true);
  if (p.delegate) {
    view.setUint32(72, 1, true);
    data.set(enc.encode(p.delegate), 76);
  }
  data[108] = p.state ?? 1;
  view.setBigUint64(121, p.delegated ?? 0n, true);
  return b64(data);
}
function mintAccount(decimals: number): string {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1;
  return b64(data);
}
const ui = (data: string, owner: Address = TOKEN_PROGRAM) => ({ data: [data, 'base64'], owner, lamports: 2039280, executable: false });
const ctx = (value: unknown) => ({ result: { context: { slot: 1 }, value } });

describe('KitPortfolioReader', () => {
  it('getBalance asks at confirmed and keeps integers beyond 2^53 exact', async () => {
    const reqs: RpcRequest[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      reqs.push(JSON.parse(String(init.body)));
      return new Response('{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":18446744073709551615}}');
    }) as typeof fetch;
    expect(await new KitPortfolioReader(URL, { fetch: fetchFn }).getBalance(OWNER)).toBe(18446744073709551615n);
    expect(reqs[0]).toMatchObject({ method: 'getBalance', params: [OWNER, { commitment: 'confirmed' }] });
  });

  it('getTokenAccounts decodes Token and Token-2022 accounts locally with mint decimals in one batched read', async () => {
    const [mintA, mintB, del] = [addr(1), addr(2), addr(3)];
    const m = mockFetch(({ method, params }) => {
      if (method === 'getTokenAccountsByOwner') {
        const program = (params as [string, { programId: string }])[1].programId;
        return program === TOKEN_PROGRAM
          ? ctx([
              { pubkey: addr(10), account: ui(tokenAccount({ mint: mintA, owner: OWNER, amount: 123n, delegate: del, delegated: 50n })) },
              { pubkey: addr(11), account: ui(tokenAccount({ mint: mintA, owner: OWNER, amount: 0n, state: 0 })) },
            ])
          : ctx([{ pubkey: addr(12), account: ui(tokenAccount({ mint: mintB, owner: OWNER, amount: 7n, state: 2, extra: 70 }), TOKEN_2022_PROGRAM) }]);
      }
      if (method === 'getMultipleAccounts') return ctx([ui(mintAccount(6)), ui(mintAccount(9), TOKEN_2022_PROGRAM)]);
      throw new Error(method);
    });
    const out = await new KitPortfolioReader(URL, { fetch: m.fetch }).getTokenAccounts(OWNER);
    expect(out).toEqual([
      { address: addr(10), mint: mintA, owner: OWNER, amount: 123n, decimals: 6, program: TOKEN_PROGRAM, delegate: del, delegatedAmount: 50n, state: 'initialized' },
      { address: addr(12), mint: mintB, owner: OWNER, amount: 7n, decimals: 9, program: TOKEN_2022_PROGRAM, delegate: null, delegatedAmount: 0n, state: 'frozen' },
    ]);
    const tokenReqs = m.requests.filter((r) => r.method === 'getTokenAccountsByOwner');
    expect(tokenReqs.map((r) => r.params)).toEqual([
      [OWNER, { programId: TOKEN_PROGRAM }, { encoding: 'base64', commitment: 'confirmed' }],
      [OWNER, { programId: TOKEN_2022_PROGRAM }, { encoding: 'base64', commitment: 'confirmed' }],
    ]);
    expect(m.requests.filter((r) => r.method === 'getMultipleAccounts').map((r) => r.params)).toEqual([[[mintA, mintB], { encoding: 'base64', commitment: 'confirmed' }]]);
  });

  it('decodeTokenAccount rejects short and uninitialized data', () => {
    expect(decodeTokenAccount(new Uint8Array(100))).toBeNull();
    expect(decodeTokenAccount(new Uint8Array(165))).toBeNull();
  });

  it('hasDas probes once and caches a yes', async () => {
    const m = mockFetch(() => ({ result: { items: [], total: 0 } }));
    const reader = new KitPortfolioReader(URL, { fetch: m.fetch });
    expect(await reader.hasDas()).toBe(true);
    expect(await reader.hasDas()).toBe(true);
    expect(m.requests).toEqual([{ method: 'getAssetsByOwner', params: { ownerAddress: '11111111111111111111111111111111', page: 1, limit: 1 } }]);
  });

  it.each([
    ['-32601', { error: { code: -32601, message: 'Method not found' } }],
    ['410', { status: 410 }],
    ['404', { status: 404 }],
  ])('hasDas caches a no on %s, and getAssetsByOwner then throws UnsupportedMethodError', async (_n, answer) => {
    const m = mockFetch(() => answer);
    const reader = new KitPortfolioReader(URL, { fetch: m.fetch });
    expect(await reader.hasDas()).toBe(false);
    await expect(reader.getAssetsByOwner(OWNER)).rejects.toBeInstanceOf(UnsupportedMethodError);
    expect(m.requests).toHaveLength(1);
  });

  it('hasDas does not cache rate limits or server errors', async () => {
    let n = 0;
    const m = mockFetch(() => (n++ === 0 ? { status: 429 } : { result: { items: [] } }));
    const reader = new KitPortfolioReader(URL, { fetch: m.fetch });
    await expect(reader.hasDas()).rejects.toBeInstanceOf(RpcError);
    expect(await reader.hasDas()).toBe(true);
  });

  it('getAssetsByOwner pages through fungibles and maps metadata and token info', async () => {
    const fungible = (i: number) => ({
      id: addr(i),
      interface: 'FungibleToken',
      content: { metadata: { name: `Tok ${i}`, symbol: `T${i}` }, links: { image: `https://img/${i}.png` } },
      token_info: { balance: 5 + i, decimals: 6, token_program: TOKEN_PROGRAM, mint_authority: null, freeze_authority: 'Frz' },
    });
    const m = mockFetch(({ params }) => {
      const p = params as { page: number; limit: number };
      if (p.limit === 1) return { result: { items: [] } };
      if (p.page === 1) return { result: { items: [...Array.from({ length: 999 }, (_, i) => fungible(i % 200)), { id: addr(250), interface: 'V1_NFT' }] } };
      return { result: { items: [{ id: addr(251), interface: 'FungibleAsset', content: { files: [{ uri: 'https://f/x' }] }, token_info: { symbol: 'FA', decimals: 0 } }] } };
    });
    const out = await new KitPortfolioReader(URL, { fetch: m.fetch }).getAssetsByOwner(OWNER);
    expect(out).toHaveLength(1000);
    expect(out[3]).toEqual({ id: addr(3), interface: 'FungibleToken', name: 'Tok 3', symbol: 'T3', image: 'https://img/3.png', decimals: 6, balance: 8n, tokenProgram: TOKEN_PROGRAM, mintAuthority: null, freezeAuthority: 'Frz' });
    expect(out[999]).toEqual({ id: addr(251), interface: 'FungibleAsset', symbol: 'FA', image: 'https://f/x', decimals: 0 });
    expect(m.requests[1]).toEqual({
      method: 'getAssetsByOwner',
      params: { ownerAddress: OWNER, page: 1, limit: 1000, options: { showFungible: true, showZeroBalance: false } },
    });
    expect(m.requests).toHaveLength(3);
  });

  it('getSignatures passes before/limit and maps entries', async () => {
    const m = mockFetch(() => ({ result: [{ signature: 's1', slot: 9, blockTime: 1700000000, err: null, memo: null }, { signature: 's2', slot: 8, blockTime: null, err: { InstructionError: [0, 'X'] } }] }));
    const reader = new KitPortfolioReader(URL, { fetch: m.fetch });
    expect(await reader.getSignatures(OWNER, { before: 's0', limit: 2 })).toEqual([
      { signature: 's1', slot: 9n, blockTime: 1700000000, err: null },
      { signature: 's2', slot: 8n, blockTime: null, err: { InstructionError: [0, 'X'] } },
    ]);
    await reader.getSignatures(OWNER, { limit: 5 });
    expect(m.requests.map((r) => r.params)).toEqual([
      [OWNER, { limit: 2, commitment: 'confirmed', before: 's0' }],
      [OWNER, { limit: 5, commitment: 'confirmed' }],
    ]);
  });

  it('getHealth reports the slot and a latency', async () => {
    const m = mockFetch(() => ({ result: 4242 }));
    const h = await new KitPortfolioReader(URL, { fetch: m.fetch }).getHealth();
    expect(h.slot).toBe(4242n);
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    expect(m.requests[0]?.method).toBe('getSlot');
  });

  it('getLatestBlockhash maps the confirmed blockhash', async () => {
    const m = mockFetch(() => ctx({ blockhash: 'BH', lastValidBlockHeight: 300 }));
    expect(await new KitPortfolioReader(URL, { fetch: m.fetch }).getLatestBlockhash()).toEqual({ blockhash: 'BH', lastValidBlockHeight: 300n });
    expect(m.requests[0]).toEqual({ method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] });
  });

  describe('confirm (polling, no websockets)', () => {
    function chain(statuses: unknown[], heights: number[]) {
      return mockFetch(({ method }) => {
        if (method === 'getSignatureStatuses') return ctx([statuses.length > 1 ? statuses.shift() : statuses[0]]);
        if (method === 'getBlockHeight') return { result: heights.length > 1 ? heights.shift() : heights[0] };
        throw new Error(method);
      });
    }

    it('confirmed after processed', async () => {
      const m = chain([null, { err: null, confirmationStatus: 'processed' }, { err: null, confirmationStatus: 'confirmed' }], [10]);
      expect(await new KitPortfolioReader(URL, { fetch: m.fetch }).confirm('sig', 100n, { pollMs: 0 })).toBe('confirmed');
      expect(m.requests.filter((r) => r.method === 'getSignatureStatuses')).toHaveLength(3);
      expect(m.requests[0]).toEqual({ method: 'getSignatureStatuses', params: [['sig'], { searchTransactionHistory: false }] });
    });

    it('failed when the status carries an error', async () => {
      const m = chain([{ err: { InstructionError: [0, 'X'] }, confirmationStatus: 'processed' }], [10]);
      expect(await new KitPortfolioReader(URL, { fetch: m.fetch }).confirm('sig', 100n, { pollMs: 0 })).toBe('failed');
    });

    it('expired once the block height passes lastValidBlockHeight', async () => {
      const m = chain([null], [99, 100, 101]);
      expect(await new KitPortfolioReader(URL, { fetch: m.fetch }).confirm('sig', 100n, { pollMs: 0 })).toBe('expired');
      expect(m.requests.filter((r) => r.method === 'getBlockHeight')).toHaveLength(3);
    });
  });
});
