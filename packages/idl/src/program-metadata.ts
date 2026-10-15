import type { ChainReader } from '@clef/rpc';
import {
  DataSource,
  findMetadataPda,
  getMetadataDecoder,
  unpackAndFetchUrlData,
  unpackDirectData,
} from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { resolveIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

/** Canonical IDLs published by the program's upgrade authority through the Program Metadata Program. */
export class ProgramMetadataIdlSource implements IdlSource {
  readonly kind = 'program-metadata' as const;

  constructor(private readonly reader: ChainReader) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [pda] = await findMetadataPda({ program: programId, authority: null, seed: 'idl' });
    const [account] = await this.reader.getAccounts([pda]);
    if (!account) return null;

    const md = getMetadataDecoder().decode(account.data);
    const packed = { compression: md.compression, encoding: md.encoding, data: md.data.slice(0, md.dataLength) };
    let json: string;
    if (md.dataSource === DataSource.Direct) json = unpackDirectData(packed);
    else if (md.dataSource === DataSource.Url) json = await unpackAndFetchUrlData(packed);
    else throw new Error('Program Metadata "external" data source is not supported yet');

    return resolveIdl(programId, this.kind, 'authority', json);
  }
}
