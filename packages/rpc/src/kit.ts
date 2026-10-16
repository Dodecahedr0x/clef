import {
  createSolanaRpc,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedWireTransaction,
  type Rpc,
  type SolanaRpcApi,
  type Signature,
} from '@solana/kit';
import { rpcCall, toBig, type FetchFn } from './json-rpc';
import type { SendOptions, TransactionSender } from './sender';
import {
  UnsupportedMethodError,
  type ChainReader,
  type FetchedTransaction,
  type RawAccount,
  type ReadOptions,
  type SequenceResult,
  type SimulateOptions,
  type SimulationResult,
  type TokenBalance,
} from './types';

const MAX_ACCOUNTS_PER_CALL = 100;

type EncodedAccount = { data: readonly [string, string]; owner: Address; lamports: bigint | number; executable: boolean };

function toRaw(address: Address, acc: EncodedAccount): RawAccount {
  return {
    address,
    owner: acc.owner,
    lamports: BigInt(acc.lamports),
    data: new Uint8Array(getBase64Encoder().encode(acc.data[0])),
    executable: acc.executable,
  };
}

type RpcTokenBalance = {
  accountIndex: number;
  mint: Address;
  owner?: Address;
  uiTokenAmount: { amount: string; decimals: number };
};

function toTokenBalance(t: RpcTokenBalance): TokenBalance {
  return {
    accountIndex: t.accountIndex,
    mint: t.mint,
    owner: t.owner ?? null,
    amount: BigInt(t.uiTokenAmount.amount),
    decimals: t.uiTokenAmount.decimals,
  };
}

type BundleAccount = { data: readonly [string, string]; owner: Address; lamports: number | bigint; executable: boolean } | null;
type BundleTxResult = {
  err: unknown;
  logs: string[] | null;
  preExecutionAccounts: BundleAccount[] | null;
  postExecutionAccounts: BundleAccount[] | null;
  unitsConsumed: number | bigint | null;
};
type BundleResponse = {
  context?: { slot: number | bigint };
  value: { summary: 'succeeded' | { failed: { error: unknown; tx_signature?: string | null } }; transactionResults: BundleTxResult[] };
};

// Bundle simulation reports missing accounts as empty zero-lamport accounts; a zero-lamport account does not exist.
function bundleAccounts(addresses: readonly Address[], accs: BundleAccount[] | null): (RawAccount | null)[] {
  return addresses.map((a, i) => {
    const acc = accs?.[i];
    return acc && toBig(acc.lamports) > 0n ? toRaw(a, acc as EncodedAccount) : null;
  });
}

export type KitChainReaderOptions = {
  /** JSON-RPC endpoint for methods outside `SolanaRpcApi` (`simulateBundle`); defaults to the string passed. */
  url?: string;
  fetch?: FetchFn;
};

export class KitChainReader implements ChainReader, TransactionSender {
  private readonly rpc: Rpc<SolanaRpcApi>;
  private readonly url: string | null;
  private readonly fetchFn: FetchFn;
  private bundleSupported: boolean | undefined;

  constructor(urlOrRpc: string | Rpc<SolanaRpcApi>, opts: KitChainReaderOptions = {}) {
    this.rpc = typeof urlOrRpc === 'string' ? createSolanaRpc(urlOrRpc) : urlOrRpc;
    this.url = opts.url ?? (typeof urlOrRpc === 'string' ? urlOrRpc : null);
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
  }

  /**
   * Jito `simulateBundle`: each transaction runs on the state the previous ones left, nothing is persisted.
   * Signatures are not verified and blockhashes are replaced, so unsigned wires simulate. Throws
   * `UnsupportedMethodError` when the RPC lacks the method; that answer is remembered for this reader.
   */
  async simulateSequence(
    wires: readonly Uint8Array[],
    addresses: readonly (readonly Address[])[],
    _options?: SimulateOptions,
  ): Promise<SequenceResult> {
    if (wires.length !== addresses.length) throw new Error('simulateSequence: one address list per transaction');
    if (this.bundleSupported === false || this.url === null) throw new UnsupportedMethodError('simulateBundle');
    const configs = addresses.map((list) => ({ encoding: 'base64', addresses: [...list] }));
    let res: BundleResponse;
    try {
      res = await rpcCall<BundleResponse>(this.fetchFn, this.url, 'simulateBundle', [
        { encodedTransactions: wires.map((w) => getBase64Decoder().decode(w)) },
        {
          preExecutionAccountsConfigs: configs,
          postExecutionAccountsConfigs: configs,
          skipSigVerify: true,
          replaceRecentBlockhash: true,
        },
      ]);
    } catch (e) {
      if (e instanceof UnsupportedMethodError) this.bundleSupported = false;
      throw e;
    }
    this.bundleSupported = true;

    const { summary, transactionResults } = res.value;
    const summaryError = summary === 'succeeded' ? null : summary.failed.error;
    let failedIndex: number | null = null;
    const results: SequenceResult['results'] = wires.map((_w, i) => {
      const r = transactionResults[i];
      if (failedIndex !== null || !r) return null;
      if (r.err !== null && r.err !== undefined) failedIndex = i;
      return {
        err: r.err ?? null,
        logs: [...(r.logs ?? [])],
        unitsConsumed: r.unitsConsumed === null || r.unitsConsumed === undefined ? null : toBig(r.unitsConsumed),
        pre: bundleAccounts(addresses[i]!, failedIndex === i ? null : r.preExecutionAccounts),
        postAccounts: bundleAccounts(addresses[i]!, failedIndex === i ? null : r.postExecutionAccounts),
      };
    });
    if (failedIndex === null && summaryError !== null) {
      // The failing transaction is the first one without a result.
      const i = Math.min(transactionResults.length, wires.length - 1);
      failedIndex = i;
      results[i] = { err: summaryError, logs: [], unitsConsumed: null, pre: addresses[i]!.map(() => null), postAccounts: addresses[i]!.map(() => null) };
      for (let j = i + 1; j < results.length; j++) results[j] = null;
    }
    return { results, failedIndex, ...(res.context?.slot !== undefined && { slot: toBig(res.context.slot) }) };
  }

  async getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]> {
    return (await this.getAccountsWithSlot(addresses)).accounts;
  }

  /** Reads at `confirmed` commitment; `slot` is the highest context slot of the (chunked) reads. */
  async getAccountsWithSlot(addresses: readonly Address[], options: ReadOptions = {}): Promise<{ accounts: (RawAccount | null)[]; slot: bigint }> {
    const accounts: (RawAccount | null)[] = [];
    let slot = 0n;
    for (let i = 0; i < addresses.length; i += MAX_ACCOUNTS_PER_CALL) {
      const chunk = addresses.slice(i, i + MAX_ACCOUNTS_PER_CALL);
      const { context, value } = await this.rpc
        .getMultipleAccounts(chunk, {
          encoding: 'base64',
          commitment: 'confirmed',
          ...(options.minContextSlot !== undefined && { minContextSlot: options.minContextSlot }),
        })
        .send();
      const at = context?.slot === undefined ? 0n : BigInt(context.slot);
      if (at > slot) slot = at;
      value.forEach((acc, j) => accounts.push(acc ? toRaw(chunk[j]!, acc as EncodedAccount) : null));
    }
    return { accounts, slot };
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    const res = await this.rpc
      .getTransaction(signature as Signature, { encoding: 'base64', maxSupportedTransactionVersion: 1 })
      .send();
    if (!res) return null;
    const m = res.meta;
    return {
      wire: new Uint8Array(getBase64Encoder().encode(res.transaction[0])),
      slot: BigInt(res.slot),
      blockTime: res.blockTime === null ? null : BigInt(res.blockTime),
      meta: m && {
        err: m.err,
        fee: BigInt(m.fee),
        preBalances: m.preBalances.map((v) => BigInt(v)),
        postBalances: m.postBalances.map((v) => BigInt(v)),
        preTokenBalances: (m.preTokenBalances ?? []).map((t) => toTokenBalance(t as RpcTokenBalance)),
        postTokenBalances: (m.postTokenBalances ?? []).map((t) => toTokenBalance(t as RpcTokenBalance)),
        loadedAddresses: {
          writable: [...(m.loadedAddresses?.writable ?? [])],
          readonly: [...(m.loadedAddresses?.readonly ?? [])],
        },
        logMessages: [...(m.logMessages ?? [])],
      },
    };
  }

  async simulate(wire: Uint8Array, addresses: readonly Address[], options: SimulateOptions = {}): Promise<SimulationResult> {
    const encoded = getBase64Decoder().decode(wire) as Base64EncodedWireTransaction;
    const { context, value } = await this.rpc
      .simulateTransaction(encoded, {
        encoding: 'base64',
        commitment: 'confirmed',
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: 'base64', addresses: [...addresses] },
        ...(options.minContextSlot !== undefined && { minContextSlot: options.minContextSlot }),
      })
      .send();
    return {
      err: value.err,
      logs: [...(value.logs ?? [])],
      unitsConsumed: value.unitsConsumed ?? null,
      postAccounts: value.accounts
        ? value.accounts.map((acc, i) => (acc ? toRaw(addresses[i]!, acc as unknown as EncodedAccount) : null))
        : addresses.map(() => null),
      ...(context?.slot !== undefined && { slot: BigInt(context.slot) }),
    };
  }

  async send(wire: Uint8Array, options: SendOptions = {}): Promise<string> {
    const encoded = getBase64Decoder().decode(wire) as Base64EncodedWireTransaction;
    return this.rpc
      .sendTransaction(encoded, {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
        skipPreflight: options.skipPreflight ?? false,
        ...(options.maxRetries !== undefined && { maxRetries: BigInt(options.maxRetries) }),
        ...(options.minContextSlot !== undefined && { minContextSlot: options.minContextSlot }),
      })
      .send();
  }
}
