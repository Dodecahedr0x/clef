import type { ChainReader, RawAccount } from '@clef/rpc';
import { getTokenDecoder } from '@solana-program/token';
import type { Address } from '@solana/kit';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './registry';

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
const MULTISIG_SIZE = 355;
/** Token-2022 extended accounts store their type at byte 165: 1 = mint, 2 = token account. */
const ACCOUNT_TYPE_OFFSET = 165;
const ACCOUNT_TYPE_MINT = 1;
const ACCOUNT_TYPE_TOKEN = 2;
const MINT_DECIMALS_OFFSET = 44;
const MINT_INITIALIZED_OFFSET = 45;
/** Token account `state`: 0 = uninitialized. */
const TOKEN_STATE_OFFSET = 108;

/** Memoized, batched account reads shared by all pipeline stages. */
export class AccountCache {
  private readonly cache = new Map<string, RawAccount | null>();

  constructor(private readonly reader: ChainReader) {}

  async load(addresses: readonly Address[]): Promise<void> {
    const missing = [...new Set(addresses)].filter((a) => !this.cache.has(a));
    if (!missing.length) return;
    const accounts = await this.reader.getAccounts(missing);
    missing.forEach((a, i) => this.cache.set(a, accounts[i] ?? null));
  }

  /** `null` when the account does not exist; `undefined` when it was never loaded. */
  get(address: Address): RawAccount | null | undefined {
    return this.cache.get(address);
  }
}

export type TokenAccountInfo = {
  mint: Address;
  owner: Address;
  amount: bigint;
  delegate: Address | null;
  delegatedAmount: bigint;
  closeAuthority: Address | null;
};

/** Which layout `account` holds, judged by owner, size and (Token-2022) account type byte. */
function layout(account: RawAccount): 'mint' | 'token' | null {
  const { data, owner } = account;
  if (owner === TOKEN_PROGRAM) {
    // Legacy Token has no extensions: anything else (e.g. a 355-byte multisig) is not a mint or token account.
    if (data.length === MINT_SIZE) return 'mint';
    if (data.length === TOKEN_ACCOUNT_SIZE) return 'token';
    return null;
  }
  if (owner === TOKEN_2022_PROGRAM) {
    if (data.length === MULTISIG_SIZE) return null;
    if (data.length === MINT_SIZE) return 'mint';
    if (data.length === TOKEN_ACCOUNT_SIZE) return 'token';
    if (data.length > TOKEN_ACCOUNT_SIZE) {
      if (data[ACCOUNT_TYPE_OFFSET] === ACCOUNT_TYPE_MINT) return 'mint';
      if (data[ACCOUNT_TYPE_OFFSET] === ACCOUNT_TYPE_TOKEN) return 'token';
    }
  }
  return null;
}

export function decodeTokenAccount(account: RawAccount | null | undefined): TokenAccountInfo | null {
  if (!account || layout(account) !== 'token' || account.data[TOKEN_STATE_OFFSET] === 0) return null;
  try {
    const t = getTokenDecoder().decode(account.data.subarray(0, TOKEN_ACCOUNT_SIZE));
    return {
      mint: t.mint,
      owner: t.owner,
      amount: t.amount,
      delegate: t.delegate.__option === 'Some' ? t.delegate.value : null,
      delegatedAmount: t.delegatedAmount,
      closeAuthority: t.closeAuthority.__option === 'Some' ? t.closeAuthority.value : null,
    };
  } catch {
    return null;
  }
}

export function decodeMintDecimals(account: RawAccount | null | undefined): number | null {
  if (!account || layout(account) !== 'mint' || account.data[MINT_INITIALIZED_OFFSET] !== 1) return null;
  return account.data[MINT_DECIMALS_OFFSET]!;
}
