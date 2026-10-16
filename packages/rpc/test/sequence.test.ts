import { address, getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { FixtureChainReader, KitChainReader, MemoryChainReader, RecordingChainReader, UnsupportedMethodError } from '../src';
import { mockFetch } from './mock-fetch';

const SYS = address('11111111111111111111111111111111');
const URL = 'http://rpc.test';

function addr(i: number): Address {
  const bytes = new Uint8Array(32);
  bytes[0] = i;
  return getAddressDecoder().decode(bytes);
}
const acc = (lamports: number, data = '') => ({ lamports, data: [data, 'base64'], owner: SYS, executable: false, rentEpoch: 0, space: 0 });
const W1 = new Uint8Array([1, 2, 3]);
const W2 = new Uint8Array([4, 5]);

describe('KitChainReader.simulateSequence', () => {
  it('sends one simulateBundle with base64 wires, per-tx base64 account configs, no sig verify, replaced blockhash', async () => {
    const m = mockFetch(() => ({ result: { context: { slot: 88 }, value: { summary: 'succeeded', transactionResults: [] } } }));
    const reader = new KitChainReader(URL, { fetch: m.fetch });
    await reader.simulateSequence([W1, W2], [[addr(1), addr(2)], [addr(2)]]);
    expect(m.requests).toEqual([
      {
        method: 'simulateBundle',
        params: [
          { encodedTransactions: ['AQID', 'BAU='] },
          {
            preExecutionAccountsConfigs: [
              { encoding: 'base64', addresses: [addr(1), addr(2)] },
              { encoding: 'base64', addresses: [addr(2)] },
            ],
            postExecutionAccountsConfigs: [
              { encoding: 'base64', addresses: [addr(1), addr(2)] },
              { encoding: 'base64', addresses: [addr(2)] },
            ],
            skipSigVerify: true,
            replaceRecentBlockhash: true,
          },
        ],
      },
    ]);
  });

  it('maps per-transaction pre/post accounts, logs and units; zero-lamport accounts are absent', async () => {
    const m = mockFetch(() => ({
      result: {
        context: { slot: 88 },
        value: {
          summary: 'succeeded',
          transactionResults: [
            { err: null, logs: ['a'], unitsConsumed: 150, preExecutionAccounts: [acc(10), acc(0)], postExecutionAccounts: [acc(5), acc(4, 'CQ==')] },
            { err: null, logs: null, unitsConsumed: null, preExecutionAccounts: [acc(4, 'CQ==')], postExecutionAccounts: [acc(0)] },
          ],
        },
      },
    }));
    const out = await new KitChainReader(URL, { fetch: m.fetch }).simulateSequence([W1, W2], [[addr(1), addr(2)], [addr(2)]]);
    expect(out.failedIndex).toBeNull();
    expect(out.slot).toBe(88n);
    expect(out.results[0]).toEqual({
      err: null,
      logs: ['a'],
      unitsConsumed: 150n,
      pre: [{ address: addr(1), owner: SYS, lamports: 10n, data: new Uint8Array(), executable: false }, null],
      postAccounts: [
        { address: addr(1), owner: SYS, lamports: 5n, data: new Uint8Array(), executable: false },
        { address: addr(2), owner: SYS, lamports: 4n, data: new Uint8Array([9]), executable: false },
      ],
    });
    expect(out.results[1]).toEqual({
      err: null,
      logs: [],
      unitsConsumed: null,
      pre: [{ address: addr(2), owner: SYS, lamports: 4n, data: new Uint8Array([9]), executable: false }],
      postAccounts: [null],
    });
  });

  it('stops at the failing transaction: its error, null accounts, later results null', async () => {
    const m = mockFetch(() => ({
      result: {
        context: { slot: 3 },
        value: {
          summary: { failed: { error: { TransactionFailure: [[1], 'boom'] }, tx_signature: 'x' } },
          transactionResults: [
            { err: null, logs: [], unitsConsumed: 1, preExecutionAccounts: [acc(1)], postExecutionAccounts: [acc(1)] },
            { err: 'AccountNotFound', logs: [], unitsConsumed: 0, preExecutionAccounts: null, postExecutionAccounts: null },
          ],
        },
      },
    }));
    const out = await new KitChainReader(URL, { fetch: m.fetch }).simulateSequence([W1, W2, W1], [[addr(1)], [addr(2)], [addr(3)]]);
    expect(out.failedIndex).toBe(1);
    expect(out.results[1]).toMatchObject({ err: 'AccountNotFound', pre: [null], postAccounts: [null] });
    expect(out.results[2]).toBeNull();
  });

  it('uses the summary error when the failing transaction has no result', async () => {
    const error = { TransactionFailure: [[1], 'boom'] };
    const m = mockFetch(() => ({
      result: { value: { summary: { failed: { error } }, transactionResults: [{ err: null, logs: [], unitsConsumed: 1, preExecutionAccounts: null, postExecutionAccounts: null }] } },
    }));
    const out = await new KitChainReader(URL, { fetch: m.fetch }).simulateSequence([W1, W2, W1], [[], [addr(2)], []]);
    expect(out.failedIndex).toBe(1);
    expect(out.results[1]).toEqual({ err: error, logs: [], unitsConsumed: null, pre: [null], postAccounts: [null] });
    expect(out.results[2]).toBeNull();
    expect(out.slot).toBeUndefined();
  });

  it.each([
    ['HTTP 410', { status: 410 }],
    ['JSON-RPC -32601', { error: { code: -32601, message: 'Method not found' } }],
  ])('%s -> UnsupportedMethodError, remembered without asking again', async (_name, answer) => {
    const m = mockFetch(() => answer);
    const reader = new KitChainReader(URL, { fetch: m.fetch });
    await expect(reader.simulateSequence([W1], [[]])).rejects.toBeInstanceOf(UnsupportedMethodError);
    await expect(reader.simulateSequence([W1], [[]])).rejects.toMatchObject({ method: 'simulateBundle' });
    expect(m.requests).toHaveLength(1);
  });

  it('other RPC errors throw without caching unsupported', async () => {
    let n = 0;
    const m = mockFetch(() => (n++ === 0 ? { error: { code: -32602, message: 'duplicate' } } : { result: { value: { summary: 'succeeded', transactionResults: [] } } }));
    const reader = new KitChainReader(URL, { fetch: m.fetch });
    await expect(reader.simulateSequence([W1], [[]])).rejects.toThrow(/duplicate/);
    await expect(reader.simulateSequence([W1], [[]])).resolves.toMatchObject({ failedIndex: null });
  });

  it('a reader built from an Rpc object without a url cannot bundle', async () => {
    const reader = new KitChainReader({} as never);
    await expect(reader.simulateSequence([W1], [[]])).rejects.toBeInstanceOf(UnsupportedMethodError);
  });
});

describe('test readers simulateSequence', () => {
  const A = addr(1);
  it('memory reader chains state through simulateImpl and stops at a failure', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: SYS, lamports: 10n, data: new Uint8Array() });
    let step = 0;
    mem.simulateImpl = async (_w, addresses) => {
      step++;
      if (step === 3) return { err: 'boom', logs: [], unitsConsumed: null, postAccounts: addresses.map(() => null) };
      return { err: null, logs: [], unitsConsumed: null, postAccounts: [{ address: A, owner: SYS, lamports: 10n - BigInt(step), data: new Uint8Array(), executable: false }] };
    };
    const out = await mem.simulateSequence([W1, W1, W1, W1], [[A], [A], [A], [A]]);
    expect(out.results.map((r) => r?.pre[0]?.lamports)).toEqual([10n, 9n, 8n, undefined]);
    expect(out.failedIndex).toBe(2);
    expect(out.results[3]).toBeNull();
  });

  it('memory reader acts like an RPC without bundles when the impl is null', async () => {
    const mem = new MemoryChainReader();
    mem.simulateSequenceImpl = null;
    await expect(mem.simulateSequence([W1], [[A]])).rejects.toBeInstanceOf(UnsupportedMethodError);
  });

  it('records and replays sequences, including unsupported answers', async () => {
    const mem = new MemoryChainReader();
    mem.setAccount({ address: A, owner: SYS, lamports: 10n, data: new Uint8Array([7]) });
    const rec = new RecordingChainReader(mem);
    const live = await rec.simulateSequence([W1, W2], [[A], [A]]);
    const replay = FixtureChainReader.fromJson(rec.toFixture());
    expect(await replay.simulateSequence([W1, W2], [[A], [A]])).toEqual(live);
    await expect(replay.simulateSequence([W2], [[A]])).rejects.toThrow(/fixture miss/);

    mem.simulateSequenceImpl = null;
    const rec2 = new RecordingChainReader(mem);
    await expect(rec2.simulateSequence([W1], [[A]])).rejects.toBeInstanceOf(UnsupportedMethodError);
    await expect(FixtureChainReader.fromJson(rec2.toFixture()).simulateSequence([W1], [[A]])).rejects.toBeInstanceOf(UnsupportedMethodError);
  });

  it('old fixtures without any sequence call replay as unsupported', async () => {
    const replay = FixtureChainReader.fromJson('{"version":1,"calls":{}}');
    await expect(replay.simulateSequence([W1], [[A]])).rejects.toBeInstanceOf(UnsupportedMethodError);
  });
});
