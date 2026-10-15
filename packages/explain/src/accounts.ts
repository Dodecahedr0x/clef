import type { ChainReader, RawAccount } from '@clef/rpc';
import { getTokenDecoder } from '@solana-program/token';
import type { Address } from '@solana/kit';
import { TOKEN_PROGRAMS } from './registry';

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
/** Token-2022 extended accounts store their type at byte 165: 1 = mint, 2 = token account. */
const ACCOUNT_TYPE_OFFSET = 165;

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

  get(address: Address): RawAccount | null {
    return this.cache.get(address) ?? null;
  }
}

export type TokenAccountInfo = { mint: Address; owner: Address; amount: bigint; delegate: Address | null };

export function decodeTokenAccount(account: RawAccount | null): TokenAccountInfo | null {
  if (!account || !TOKEN_PROGRAMS.has(account.owner) || account.data.length < TOKEN_ACCOUNT_SIZE) return null;
  if (account.data.length > TOKEN_ACCOUNT_SIZE && account.data[ACCOUNT_TYPE_OFFSET] !== 2) return null;
  const t = getTokenDecoder().decode(account.data.subarray(0, TOKEN_ACCOUNT_SIZE));
  return { mint: t.mint, owner: t.owner, amount: t.amount, delegate: t.delegate.__option === 'Some' ? t.delegate.value : null };
}

export function decodeMintDecimals(account: RawAccount | null): number | null {
  if (!account || !TOKEN_PROGRAMS.has(account.owner)) return null;
  const isMint =
    account.data.length === MINT_SIZE ||
    (account.data.length > TOKEN_ACCOUNT_SIZE && account.data[ACCOUNT_TYPE_OFFSET] === 1);
  return isMint ? account.data[44]! : null;
}
