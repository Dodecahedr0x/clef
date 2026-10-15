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
import type { ChainReader, FetchedTransaction, RawAccount, ReadOptions, SimulateOptions, SimulationResult, TokenBalance } from './types';

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

export class KitChainReader implements ChainReader {
  private readonly rpc: Rpc<SolanaRpcApi>;

  constructor(urlOrRpc: string | Rpc<SolanaRpcApi>) {
    this.rpc = typeof urlOrRpc === 'string' ? createSolanaRpc(urlOrRpc) : urlOrRpc;
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
}
