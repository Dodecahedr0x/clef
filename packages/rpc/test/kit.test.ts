import { address, getAddressDecoder, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, SolanaError, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { KitChainReader, retryRateLimited } from '../src';

const OWNER = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function addr(i: number): Address {
  const bytes = new Uint8Array(32);
  bytes[0] = i & 0xff;
  bytes[1] = i >> 8;
  return getAddressDecoder().decode(bytes);
}

const reply = <T>(value: T) => ({ send: async () => value });
const fakeRpc = (methods: Record<string, (...args: never[]) => unknown>) =>
  methods as unknown as Rpc<SolanaRpcApi>;

describe('KitChainReader (offline)', () => {
  it('chunks getAccounts by 100 and preserves order and nulls', async () => {
    const sizes: number[] = [];
    const reader = new KitChainReader(
      fakeRpc({
        getMultipleAccounts: (chunk: Address[]) => {
          sizes.push(chunk.length);
          return reply({
            value: chunk.map((a) =>
              a === addr(7)
                ? null
                : { data: [btoa(a), 'base64'], owner: OWNER, lamports: 10n, executable: false },
            ),
          });
        },
      }),
    );
    const addresses = Array.from({ length: 250 }, (_, i) => addr(i));
    const out = await reader.getAccounts(addresses);

    expect(sizes).toEqual([100, 100, 50]);
    expect(out).toHaveLength(250);
    expect(out[7]).toBeNull();
    out.forEach((acc, i) => {
      if (i === 7) return;
      expect(acc?.address).toBe(addresses[i]);
      expect(new TextDecoder().decode(acc!.data)).toBe(addresses[i]);
      expect(acc?.lamports).toBe(10n);
    });
  });

  it('maps getTransaction results', async () => {
    const wire = new Uint8Array([1, 2, 3]);
    const responses: unknown[] = [
      {
        slot: 5n,
        blockTime: null,
        transaction: [btoa(String.fromCharCode(...wire)), 'base64'],
        meta: {
          err: null,
          fee: 5000n,
          preBalances: [10n],
          postBalances: [5n],
          preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: OWNER, uiTokenAmount: { amount: '123456789012345678901', decimals: 6 } }],
          postTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: '0', decimals: 6 } }],
          loadedAddresses: { writable: [MINT], readonly: [] },
          logMessages: ['log'],
          computeUnitsConsumed: 4242n,
          // base58 'EG' is the bytes [3, 1]; the second entry has no data and is dropped.
          innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 2n, accounts: [0n, 1n], data: 'EG', stackHeight: 2 }, { programIdIndex: 2, accounts: [] }] }],
        },
      },
      { slot: 6n, blockTime: 1700000000n, transaction: [btoa('x'), 'base64'], meta: null },
      null,
    ];
    const reader = new KitChainReader(fakeRpc({ getTransaction: () => reply(responses.shift()) }));

    const tx = await reader.getTransaction('sig1');
    expect(tx).toEqual({
      wire,
      slot: 5n,
      blockTime: null,
      meta: {
        err: null,
        fee: 5000n,
        preBalances: [10n],
        postBalances: [5n],
        preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: OWNER, amount: 123456789012345678901n, decimals: 6 }],
        postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: null, amount: 0n, decimals: 6 }],
        loadedAddresses: { writable: [MINT], readonly: [] },
        logMessages: ['log'],
        computeUnitsConsumed: 4242n,
        innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 2, accounts: [0, 1], data: new Uint8Array([3, 1]) }] }],
      },
    });

    const noMeta = await reader.getTransaction('sig2');
    expect(noMeta?.meta).toBeNull();
    expect(noMeta?.blockTime).toBe(1700000000n);

    expect(await reader.getTransaction('sig3')).toBeNull();
  });

  it('caches confirmed transactions per endpoint and retries an HTTP 429', async () => {
    const tx = { slot: 7n, blockTime: null, transaction: [btoa('y'), 'base64'], meta: null };
    let calls = 0;
    const limited = () => {
      calls++;
      if (calls === 1) throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'Too Many Requests', statusCode: 429 });
      return tx;
    };
    const url = `https://cache-test-${Math.random()}.example`;
    const a = new KitChainReader(fakeRpc({ getTransaction: () => ({ send: async () => limited() }) }), { url });
    expect((await retryRateLimited(() => a.getTransaction('cached'), [0, 0]))?.slot).toBe(7n);
    expect(calls).toBe(2);
    // Another reader on the same endpoint (another screen) gets it without asking the RPC again.
    const b = new KitChainReader(fakeRpc({ getTransaction: () => ({ send: async () => limited() }) }), { url });
    expect((await b.getTransaction('cached'))?.slot).toBe(7n);
    expect(calls).toBe(2);
  });

  it('gives up on a rate limit after the retries, and never retries other HTTP errors', async () => {
    const err = (statusCode: number) => new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'x', statusCode });
    let n = 0;
    await expect(retryRateLimited(async () => { n++; throw err(429); }, [0, 0])).rejects.toThrow();
    expect(n).toBe(3);
    n = 0;
    await expect(retryRateLimited(async () => { n++; throw err(500); }, [0, 0])).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('requests transactions up to version 1', async () => {
    const seen: unknown[] = [];
    const reader = new KitChainReader(
      fakeRpc({
        getTransaction: (_sig: string, config: unknown) => {
          seen.push(config);
          return reply(null);
        },
      }),
    );
    await reader.getTransaction('sig');
    expect(seen).toEqual([{ encoding: 'base64', maxSupportedTransactionVersion: 1 }]);
  });

  it('passes a v1 (message-first) wire to simulateTransaction unchanged', async () => {
    // Version byte 0x81, then the message; signatures trail it.
    const wire = new Uint8Array([0x81, 1, 0, 0, 0, 0, 0, 0, 9, 8, 7]);
    const sent: string[] = [];
    const reader = new KitChainReader(
      fakeRpc({
        simulateTransaction: (tx: string) => {
          sent.push(tx);
          return reply({ value: { err: null, logs: [], unitsConsumed: 1n, accounts: null } });
        },
      }),
    );
    await reader.simulate(wire, []);
    expect(sent).toEqual([btoa(String.fromCharCode(...wire))]);
  });

  it('maps simulate results and pads missing accounts with nulls', async () => {
    const results: unknown[] = [
      {
        err: null,
        logs: ['ok'],
        unitsConsumed: 42n,
        accounts: [{ data: [btoa('\x09'), 'base64'], owner: OWNER, lamports: 1n, executable: true }, null],
      },
      { err: { InstructionError: [0, 'Custom'] }, logs: null, unitsConsumed: undefined, accounts: null },
    ];
    const reader = new KitChainReader(
      fakeRpc({ simulateTransaction: () => reply({ value: results.shift() }) }),
    );
    const addresses = [addr(1), addr(2)];

    expect(await reader.simulate(new Uint8Array([0]), addresses)).toEqual({
      err: null,
      logs: ['ok'],
      unitsConsumed: 42n,
      postAccounts: [
        { address: addr(1), owner: OWNER, lamports: 1n, data: new Uint8Array([9]), executable: true },
        null,
      ],
    });

    const failed = await reader.simulate(new Uint8Array([0]), addresses);
    expect(failed.postAccounts).toEqual([null, null]);
    expect(failed.logs).toEqual([]);
    expect(failed.unitsConsumed).toBeNull();
  });

  it('reads accounts at confirmed commitment and reports the highest context slot', async () => {
    const seen: unknown[] = [];
    const slots = [7n, 9n, 8n];
    const reader = new KitChainReader(
      fakeRpc({
        getMultipleAccounts: (chunk: Address[], config: unknown) => {
          seen.push(config);
          return reply({ context: { slot: slots.shift()! }, value: chunk.map(() => null) });
        },
      }),
    );
    const { accounts, slot } = await reader.getAccountsWithSlot(Array.from({ length: 250 }, (_, i) => addr(i)));
    expect(accounts).toHaveLength(250);
    expect(slot).toBe(9n);
    expect(seen).toEqual([0, 1, 2].map(() => ({ encoding: 'base64', commitment: 'confirmed' })));
    slots.push(10n);
    await reader.getAccountsWithSlot([addr(1)], { minContextSlot: 9n });
    expect(seen[3]).toEqual({ encoding: 'base64', commitment: 'confirmed', minContextSlot: 9n });
  });

  it('simulates at confirmed commitment, no older than a given slot', async () => {
    const seen: Record<string, unknown>[] = [];
    const reader = new KitChainReader(
      fakeRpc({
        simulateTransaction: (_tx: string, config: Record<string, unknown>) => {
          seen.push(config);
          return reply({ context: { slot: 12n }, value: { err: null, logs: [], unitsConsumed: 1n, accounts: [null] } });
        },
      }),
    );
    expect((await reader.simulate(new Uint8Array([0]), [addr(1)], { minContextSlot: 9n })).slot).toBe(12n);
    await reader.simulate(new Uint8Array([0]), [addr(1)]);
    expect(seen[0]).toMatchObject({ commitment: 'confirmed', minContextSlot: 9n });
    expect(seen[1]).toMatchObject({ commitment: 'confirmed' });
    expect(seen[1]).not.toHaveProperty('minContextSlot');
  });
});
