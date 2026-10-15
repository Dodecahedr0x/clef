import { address, getAddressDecoder, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { KitChainReader } from '../src';

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
      },
    });

    const noMeta = await reader.getTransaction('sig2');
    expect(noMeta?.meta).toBeNull();
    expect(noMeta?.blockTime).toBe(1700000000n);

    expect(await reader.getTransaction('sig3')).toBeNull();
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
});
