import type { RawAccount } from '@clef/rpc';
import { findAssociatedTokenPda, getMintDecoder } from '@solana-program/token';
import { address, type Address } from '@solana/kit';
import { decodeMintDecimals, decodeTokenAccount, type AccountCache } from './accounts';
import { ATA_PROGRAM, TOKEN_PROGRAMS } from './registry';
import type { RelationEdge, RelationKind } from './types';

const MINT_SIZE = 82;

type Fact = [kind: RelationKind, to: Address, label: string];

async function facts(key: Address, account: RawAccount): Promise<Fact[]> {
  const out: Fact[] = [['program-owner', account.owner, 'program']];
  const token = decodeTokenAccount(account);
  if (token) {
    const [ata] = await findAssociatedTokenPda({ owner: token.owner, mint: token.mint, tokenProgram: account.owner });
    if (ata === key) out.push(['ata-derivation', address(ATA_PROGRAM), 'derived by']);
  }
  if (TOKEN_PROGRAMS.has(account.owner) && decodeMintDecimals(account) !== null) {
    const mint = getMintDecoder().decode(account.data.subarray(0, MINT_SIZE));
    if (mint.mintAuthority.__option === 'Some') out.push(['mint-authority', mint.mintAuthority.value, 'mint authority']);
    if (mint.freezeAuthority.__option === 'Some') out.push(['freeze-authority', mint.freezeAuthority.value, 'freeze authority']);
  }
  if (token?.delegate) out.push(['delegate', token.delegate, 'delegate']);
  if (token?.closeAuthority) out.push(['close-authority', token.closeAuthority, 'close authority']);
  return out;
}

/** Relations read from chain state whose targets fall outside `keys` (program owner, ATA derivation, authorities). */
export async function externalRelations(keys: readonly Address[], cache: AccountCache): Promise<RelationEdge[]> {
  const inKeys = new Set<string>(keys);
  const seen = new Set<string>();
  const edges: RelationEdge[] = [];
  for (const key of new Set(keys)) {
    const account = cache.get(key);
    if (!account) continue;
    let found: Fact[];
    try {
      found = await facts(key, account);
    } catch {
      continue;
    }
    for (const [kind, to, label] of found) {
      const id = `${kind}:${key}:${to}`;
      if (inKeys.has(to) || seen.has(id)) continue;
      seen.add(id);
      edges.push({ kind, from: key, to, label, status: 'verified', external: true });
    }
  }
  return edges;
}
