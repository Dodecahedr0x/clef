import { address, getAddressEncoder, some, none, type Address } from '@solana/kit';
import { getMintEncoder as getTokenMintEncoder } from '@solana-program/token';
import { extension, getMintEncoder as getToken2022MintEncoder } from '@solana-program/token-2022';

export const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const METAPLEX = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export function tokenMint(decimals: number, mintAuthority: Address | null = null, freezeAuthority: Address | null = null): Uint8Array {
  return new Uint8Array(
    getTokenMintEncoder().encode({ mintAuthority: mintAuthority ? some(mintAuthority) : none(), supply: 1_000_000n, decimals, isInitialized: true, freezeAuthority: freezeAuthority ? some(freezeAuthority) : none() }),
  );
}

export function token2022MintWithMetadata(mint: Address, decimals: number, meta: { name: string; symbol: string; uri: string }, mintAuthority: Address | null = null): Uint8Array {
  return new Uint8Array(
    getToken2022MintEncoder().encode({
      mintAuthority: mintAuthority ? some(mintAuthority) : none(),
      supply: 1_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some([
        extension('MetadataPointer', { authority: none(), metadataAddress: some(mint) }),
        extension('TokenMetadata', { updateAuthority: none(), mint, ...meta, additionalMetadata: new Map() }),
      ]),
    }),
  );
}

function borshString(s: string, padTo: number): number[] {
  const bytes = [...new TextEncoder().encode(s)];
  while (bytes.length < padTo) bytes.push(0);
  return [...new Uint8Array(new Uint32Array([bytes.length]).buffer), ...bytes];
}

/** Metaplex Token Metadata account (key, update authority, mint, then 0-padded name/symbol/uri as on-chain). */
export function metaplexMetadata(mint: Address, meta: { name: string; symbol: string; uri: string }): Uint8Array {
  const enc = getAddressEncoder();
  return new Uint8Array([4, ...enc.encode(mint), ...enc.encode(mint), ...borshString(meta.name, 32), ...borshString(meta.symbol, 10), ...borshString(meta.uri, 200), 0, 0]);
}
