import { describe, expect, it } from 'vitest';
import { address, getProgramDerivedAddress, getAddressEncoder } from '@solana/kit';
import { decodeMetaplexMetadata, decodeMintInfo, metaplexMetadataPda } from '../src/metadata';
import { METAPLEX, TOKEN, TOKEN_2022, metaplexMetadata, token2022MintWithMetadata, tokenMint } from './fixtures';

const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const AUTH = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');

describe('metadata', () => {
  it('derives the Metaplex metadata PDA', async () => {
    const enc = getAddressEncoder();
    const [expected] = await getProgramDerivedAddress({ programAddress: METAPLEX, seeds: ['metadata', enc.encode(METAPLEX), enc.encode(MINT)] });
    expect(await metaplexMetadataPda(MINT)).toBe(expected);
  });

  it('decodes Metaplex name/symbol/uri and strips padding', () => {
    expect(decodeMetaplexMetadata(metaplexMetadata(MINT, { name: 'Meta Token', symbol: 'MPX', uri: 'https://x.y/m.json' }))).toEqual({
      name: 'Meta Token',
      symbol: 'MPX',
      uri: 'https://x.y/m.json',
    });
  });

  it('rejects garbage Metaplex data', () => {
    expect(decodeMetaplexMetadata(new Uint8Array([4, 1, 2]))).toBeNull();
    expect(decodeMetaplexMetadata(new Uint8Array(0))).toBeNull();
  });

  it('decodes a Token mint', () => {
    expect(decodeMintInfo(MINT, tokenMint(6, AUTH, null), TOKEN)).toEqual({ decimals: 6, mintAuthority: AUTH, freezeAuthority: null });
  });

  it('decodes the Token-2022 metadata extension', () => {
    const data = token2022MintWithMetadata(MINT, 9, { name: 'Twenty Two', symbol: 'TT', uri: '' }, AUTH);
    expect(decodeMintInfo(MINT, data, TOKEN_2022)).toEqual({
      decimals: 9,
      mintAuthority: AUTH,
      freezeAuthority: null,
      metadata: { name: 'Twenty Two', symbol: 'TT', uri: '' },
    });
  });

  it('ignores a Token-2022 metadata extension that names another mint', () => {
    const data = token2022MintWithMetadata(AUTH, 9, { name: 'Spoof', symbol: 'USDC', uri: '' });
    expect(decodeMintInfo(MINT, data, TOKEN_2022)?.metadata).toBeUndefined();
  });

  it('returns null for undecodable mints', () => {
    expect(decodeMintInfo(MINT, new Uint8Array(10), TOKEN)).toBeNull();
  });
});
