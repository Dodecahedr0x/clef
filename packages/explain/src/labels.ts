import { findAssociatedTokenPda } from '@solana-program/token';
import type { Address } from '@solana/kit';
import { decodeMintDecimals, decodeTokenAccount, type AccountCache } from './accounts';
import { KNOWN_MINTS, PROGRAM_NAMES } from './registry';
import type { RelationEdge } from './types';

export const shortAddress = (a: string) => `${a.slice(0, 4)}\u2026${a.slice(-4)}`;

/** Facts read straight from token account data: never from IDL names. */
export async function tokenRelations(addresses: readonly Address[], cache: AccountCache): Promise<RelationEdge[]> {
  const edges: RelationEdge[] = [];
  for (const address of new Set(addresses)) {
    const account = cache.get(address);
    const token = decodeTokenAccount(account);
    if (!account || !token) continue;
    edges.push(
      { kind: 'token-owner', from: address, to: token.owner, label: 'token owner', status: 'verified' },
      { kind: 'token-mint', from: address, to: token.mint, label: 'mint', status: 'verified' },
    );
    const [ata] = await findAssociatedTokenPda({ owner: token.owner, mint: token.mint, tokenProgram: account.owner });
    if (ata === address) edges.push({ kind: 'ata', from: address, to: token.owner, label: 'associated token account', status: 'verified' });
  }
  return edges;
}

/**
 * Display labels from trusted sources only: the user's own wallets and address book, Clef's registry, and
 * on-chain token account data. Nothing derived from an IDL ever becomes a label.
 */
export class Labeler {
  private readonly me: ReadonlySet<string>;

  /** `tokenOwners`: token account owners known from elsewhere (e.g. tx meta), used when the account can't be read. */
  constructor(
    me: readonly Address[],
    private readonly cache: AccountCache,
    private readonly addressBook: Readonly<Record<string, string>> = {},
    private readonly tokenOwners: Readonly<Record<string, string>> = {},
  ) {
    this.me = new Set(me);
  }

  /** The user's wallets plus token accounts they own. */
  isMine(address: Address): boolean {
    const owner = decodeTokenAccount(this.cache.get(address))?.owner ?? (Object.hasOwn(this.tokenOwners, address) ? this.tokenOwners[address] : undefined);
    return this.me.has(address) || (owner !== undefined && this.me.has(owner));
  }

  mintInfo(mint: Address): { symbol: string; decimals: number } | null {
    const known = KNOWN_MINTS[mint];
    if (known) return known;
    const decimals = decodeMintDecimals(this.cache.get(mint));
    return decimals === null ? null : { symbol: shortAddress(mint), decimals };
  }

  label(address: Address): string | undefined {
    if (this.me.has(address)) return 'Your wallet';
    // Program naming precedence: see `PROGRAM_NAMES`.
    const named = PROGRAM_NAMES[address] ?? (Object.hasOwn(this.addressBook, address) ? this.addressBook[address] : undefined);
    if (named) return named;
    if (KNOWN_MINTS[address]) return `${KNOWN_MINTS[address]!.symbol} mint`;
    const token = decodeTokenAccount(this.cache.get(address));
    if (token) {
      const symbol = this.mintInfo(token.mint)?.symbol ?? shortAddress(token.mint);
      const whose = this.me.has(token.owner) ? 'Your' : `${this.addressBook[token.owner] ?? shortAddress(token.owner)}'s`;
      return `${whose} ${symbol} token account`;
    }
    return undefined;
  }
}
