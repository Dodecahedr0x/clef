import { MemoryChainReader } from '@clef/rpc';
import {
  Compression,
  DataSource,
  Encoding,
  findMetadataPda,
  Format,
  getMetadataEncoder,
  packDirectData,
  packUrlData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
  type PackedData,
} from '@solana-program/program-metadata';
import { address, type Address } from '@solana/kit';
import { zlibSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { IdlDecodeError, ProgramMetadataIdlSource, type ProgramMetadataIdlSourceOptions } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const VAULT_JSON = JSON.stringify(vault);

type Overrides = Partial<{ format: Format; owner: Address }>;

async function loadPacked(packed: PackedData, options?: ProgramMetadataIdlSourceOptions, overrides: Overrides = {}) {
  const data = getMetadataEncoder().encode({
    program: VAULT,
    authority: null,
    mutable: true,
    canonical: true,
    seed: 'idl',
    encoding: packed.encoding,
    compression: packed.compression,
    format: overrides.format ?? Format.Json,
    dataSource: packed.dataSource,
    dataLength: packed.data.length,
    data: packed.data,
  });
  const [pda] = await findMetadataPda({ program: VAULT, authority: null, seed: 'idl' });
  const reader = new MemoryChainReader();
  reader.setAccount({ address: pda, owner: overrides.owner ?? PROGRAM_METADATA_PROGRAM_ADDRESS, data: new Uint8Array(data) });
  return new ProgramMetadataIdlSource(reader, options).load(VAULT);
}

const URL_IDL = 'https://idls.example.com/vault.json';
const urlPacked = (url = URL_IDL) => packUrlData({ url, compression: Compression.Zlib, encoding: Encoding.Utf8 });

describe('ProgramMetadataIdlSource', () => {
  it('reads a canonical, directly stored IDL', async () => {
    const idl = await loadPacked(packDirectData({ content: VAULT_JSON, compression: Compression.Zlib, encoding: Encoding.Utf8 }));
    expect(idl).toMatchObject({ source: 'program-metadata', trust: 'authority' });
    expect(idl?.root.program.name).toBe('vault');
  });

  it('reads uncompressed and gzip-compressed IDLs', async () => {
    for (const compression of [Compression.None, Compression.Gzip]) {
      const idl = await loadPacked(packDirectData({ content: VAULT_JSON, compression, encoding: Encoding.Utf8 }));
      expect(idl?.root.program.name).toBe('vault');
    }
  });

  it('returns null when there is no metadata account', async () => {
    expect(await new ProgramMetadataIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });

  it('returns null when the metadata account is not owned by the Program Metadata Program', async () => {
    const packed = packDirectData({ content: VAULT_JSON });
    expect(await loadPacked(packed, undefined, { owner: VAULT })).toBeNull();
  });

  it('rejects IDLs that inflate past 4 MiB', async () => {
    const bomb = zlibSync(new Uint8Array(5 * 1024 * 1024));
    const packed = { compression: Compression.Zlib, encoding: Encoding.Utf8, dataSource: DataSource.Direct, data: bomb };
    await expect(loadPacked(packed)).rejects.toThrow(new IdlDecodeError('IDL exceeds 4 MiB'));
  });

  it('rejects non-JSON formats and unsupported encodings', async () => {
    await expect(loadPacked(packDirectData({ content: VAULT_JSON }), undefined, { format: Format.Yaml })).rejects.toBeInstanceOf(
      IdlDecodeError,
    );
    const base64 = packDirectData({ content: btoa(VAULT_JSON), encoding: Encoding.Base64 });
    await expect(loadPacked(base64)).rejects.toBeInstanceOf(IdlDecodeError);
  });

  it('rejects the External data source', async () => {
    const packed = { compression: Compression.None, encoding: Encoding.None, dataSource: DataSource.External, data: new Uint8Array(32) };
    await expect(loadPacked(packed)).rejects.toBeInstanceOf(IdlDecodeError);
  });

  describe('Url data source', () => {
    it('does not fetch by default', async () => {
      const fetch = vi.fn();
      await expect(loadPacked(urlPacked(), { fetch })).rejects.toThrow(
        new IdlDecodeError('IDL is hosted at https://idls.example.com; URL fetching is disabled'),
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects non-https, localhost and IP-literal URLs', async () => {
      const fetch = vi.fn();
      for (const url of ['http://idls.example.com/a.json', 'https://localhost/a.json', 'https://127.0.0.1/a.json', 'https://[::1]/a.json']) {
        await expect(loadPacked(urlPacked(url), { allowUrlFetch: true, fetch })).rejects.toBeInstanceOf(IdlDecodeError);
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches an https URL without credentials, referrer or redirects', async () => {
      const fetch = vi.fn(async () => new Response(VAULT_JSON));
      const idl = await loadPacked(urlPacked(), { allowUrlFetch: true, fetch });
      expect(idl?.root.program.name).toBe('vault');
      expect(fetch).toHaveBeenCalledWith(
        URL_IDL,
        expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: expect.any(AbortSignal) }),
      );
    });

    it('rejects oversize bodies', async () => {
      const big = new Uint8Array(4 * 1024 * 1024 + 1);
      const declared = vi.fn(async () => new Response(big, { headers: { 'content-length': String(big.length) } }));
      await expect(loadPacked(urlPacked(), { allowUrlFetch: true, fetch: declared })).rejects.toThrow(
        new IdlDecodeError('IDL exceeds 4 MiB'),
      );
      const streamed = vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            c.enqueue(new Uint8Array(1024 * 1024));
          },
        });
        return new Response(body);
      });
      await expect(loadPacked(urlPacked(), { allowUrlFetch: true, fetch: streamed })).rejects.toThrow(
        new IdlDecodeError('IDL exceeds 4 MiB'),
      );
    });
  });
});
