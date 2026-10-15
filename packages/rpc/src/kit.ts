import {
  createSolanaRpc,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedWireTransaction,
  type Signature,
} from '@solana/kit';
import type { ChainReader, FetchedTransaction, RawAccount, SimulationResult, TokenBalance } from './types';

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
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  constructor(url: string) {
    this.rpc = createSolanaRpc(url);
  }

  async getAccounts(addresses: readonly Address[]): Promise<(RawAccount | null)[]> {
    const out: (RawAccount | null)[] = [];
    for (let i = 0; i < addresses.length; i += MAX_ACCOUNTS_PER_CALL) {
      const chunk = addresses.slice(i, i + MAX_ACCOUNTS_PER_CALL);
      const { value } = await this.rpc.getMultipleAccounts(chunk, { encoding: 'base64' }).send();
      value.forEach((acc, j) => out.push(acc ? toRaw(chunk[j]!, acc as EncodedAccount) : null));
    }
    return out;
  }

  async getTransaction(signature: string): Promise<FetchedTransaction | null> {
    const res = await this.rpc
      .getTransaction(signature as Signature, { encoding: 'base64', maxSupportedTransactionVersion: 0 })
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

  async simulate(wire: Uint8Array, addresses: readonly Address[]): Promise<SimulationResult> {
    const encoded = getBase64Decoder().decode(wire) as Base64EncodedWireTransaction;
    const { value } = await this.rpc
      .simulateTransaction(encoded, {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: 'base64', addresses: [...addresses] },
      })
      .send();
    return {
      err: value.err,
      logs: [...(value.logs ?? [])],
      unitsConsumed: value.unitsConsumed ?? null,
      postAccounts: (value.accounts ?? []).map((acc, i) =>
        acc ? toRaw(addresses[i]!, acc as unknown as EncodedAccount) : null,
      ),
    };
  }
}
