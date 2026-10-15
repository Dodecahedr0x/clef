import { createDefaultResolver, UserIdlSource } from '@clef/idl';
import type { ChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import type { ExplainContext } from './types';

/**
 * The context the `clef` CLI explains with: the default IDL resolver chain (no user IDLs, no Program Metadata
 * URL fetches) over `reader`. Recorded-fixture replays use it too, so they explain exactly what the CLI did.
 */
export function defaultExplainContext(
  reader: ChainReader,
  me: readonly Address[],
  labels?: Readonly<Record<string, string>>,
): ExplainContext {
  return { reader, idls: createDefaultResolver(reader, new UserIdlSource()), me, addressBook: labels };
}
