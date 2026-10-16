import type { Address } from '@solana/kit';
import type { ChainReader } from '@clef/rpc';
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@clef/explain';

export type RecipientKind = 'wallet' | 'token-account' | 'program' | 'new' | 'unknown';

const TOKEN_ACCOUNT_LEN = 165;
const ACCOUNT_TYPE_ACCOUNT = 2;

export async function classifyRecipient(chain: ChainReader, address: Address): Promise<RecipientKind> {
  let account;
  try {
    [account] = await chain.getAccounts([address]);
  } catch {
    return 'unknown';
  }
  if (!account) return 'new';
  if (account.executable) return 'program';
  if (account.owner === SYSTEM_PROGRAM) return 'wallet';
  const len = account.data.length;
  if (account.owner === TOKEN_PROGRAM && len === TOKEN_ACCOUNT_LEN) return 'token-account';
  if (
    account.owner === TOKEN_2022_PROGRAM &&
    (len === TOKEN_ACCOUNT_LEN || (len > TOKEN_ACCOUNT_LEN && account.data[TOKEN_ACCOUNT_LEN] === ACCOUNT_TYPE_ACCOUNT))
  )
    return 'token-account';
  return 'unknown';
}
