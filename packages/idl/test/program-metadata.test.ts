import { MemoryChainReader } from '@clef/rpc';
import {
  Compression,
  DataSource,
  Encoding,
  findMetadataPda,
  Format,
  getMetadataEncoder,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from '@solana-program/program-metadata';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ProgramMetadataIdlSource } from '../src';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

describe('ProgramMetadataIdlSource', () => {
  it('reads a canonical, directly stored IDL', async () => {
    const packed = packDirectData({ content: JSON.stringify(vault), compression: Compression.Zlib, encoding: Encoding.Utf8 });
    const data = getMetadataEncoder().encode({
      program: VAULT,
      authority: null,
      mutable: true,
      canonical: true,
      seed: 'idl',
      encoding: packed.encoding,
      compression: packed.compression,
      format: Format.Json,
      dataSource: DataSource.Direct,
      dataLength: packed.data.length,
      data: packed.data,
    });
    const [pda] = await findMetadataPda({ program: VAULT, authority: null, seed: 'idl' });
    const reader = new MemoryChainReader();
    reader.setAccount({ address: pda, owner: PROGRAM_METADATA_PROGRAM_ADDRESS, data: new Uint8Array(data) });

    const idl = await new ProgramMetadataIdlSource(reader).load(VAULT);
    expect(idl).toMatchObject({ source: 'program-metadata', trust: 'authority' });
    expect(idl?.root.program.name).toBe('vault');
  });

  it('returns null when there is no metadata account', async () => {
    expect(await new ProgramMetadataIdlSource(new MemoryChainReader()).load(VAULT)).toBeNull();
  });
});
