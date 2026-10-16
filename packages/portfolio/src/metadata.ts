import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, isSome, type Address } from '@solana/kit';
import { getMintDecoder as getTokenMintDecoder } from '@solana-program/token';
import { getMintDecoder as getToken2022MintDecoder } from '@solana-program/token-2022';
import { TOKEN_2022_PROGRAM } from '@clef/explain';

export const METAPLEX_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' as Address;

export type TokenMetadata = { name: string; symbol: string; uri: string };
export type MintInfo = { decimals: number; mintAuthority: string | null; freezeAuthority: string | null; metadata?: TokenMetadata };

export async function metaplexMetadataPda(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: METAPLEX_METADATA_PROGRAM,
    seeds: ['metadata', enc.encode(METAPLEX_METADATA_PROGRAM), enc.encode(mint)],
  });
  return pda;
}

const MINT_OFFSET = 33;

/** Name, symbol and uri of a Metaplex Token Metadata account (borsh strings, 0-padded on chain). */
export function decodeMetaplexMetadata(data: Uint8Array, mint?: Address): TokenMetadata | null {
  try {
    if (data.length < MINT_OFFSET + 32) return null;
    if (mint && getAddressDecoder().decode(data.subarray(MINT_OFFSET, MINT_OFFSET + 32)) !== mint) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = MINT_OFFSET + 32;
    const str = (max: number) => {
      if (offset + 4 > data.length) throw new Error('short');
      const len = view.getUint32(offset, true);
      if (len > max || offset + 4 + len > data.length) throw new Error('bad length');
      const s = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset + 4, offset + 4 + len));
      offset += 4 + len;
      return s.replace(/\0+$/, '').trim();
    };
    return { name: str(64), symbol: str(32), uri: str(256) };
  } catch {
    return null;
  }
}

/** Decimals, authorities and (Token-2022) the embedded metadata extension of a mint account; null if undecodable. */
export function decodeMintInfo(mint: Address, data: Uint8Array, program: Address): MintInfo | null {
  try {
    if (program === TOKEN_2022_PROGRAM) {
      const m = getToken2022MintDecoder().decode(data);
      if (!m.isInitialized) return null;
      const ext = isSome(m.extensions) ? m.extensions.value.find((e) => e.__kind === 'TokenMetadata') : undefined;
      // The extension names its mint: one copied from another mint is a spoof.
      const metadata = ext?.__kind === 'TokenMetadata' && ext.mint === mint ? { name: ext.name, symbol: ext.symbol, uri: ext.uri } : undefined;
      return { ...authorities(m), ...(metadata && { metadata }) };
    }
    if (data.length !== 82) return null;
    const m = getTokenMintDecoder().decode(data);
    return m.isInitialized ? authorities(m) : null;
  } catch {
    return null;
  }
}

function authorities(m: { decimals: number; mintAuthority: { __option: 'Some'; value: Address } | { __option: 'None' }; freezeAuthority: { __option: 'Some'; value: Address } | { __option: 'None' } }) {
  return {
    decimals: m.decimals,
    mintAuthority: isSome(m.mintAuthority) ? m.mintAuthority.value : null,
    freezeAuthority: isSome(m.freezeAuthority) ? m.freezeAuthority.value : null,
  };
}
