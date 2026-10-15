import type { ChainReader } from '@clef/rpc';
import {
  Compression,
  DataSource,
  Encoding,
  findMetadataPda,
  Format,
  getMetadataDecoder,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { asDecodeError, IdlDecodeError } from './errors';
import { concatBytes, gunzipCapped, inflateCapped, MAX_IDL_BYTES, sizeError } from './inflate';
import { resolveIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

export type ProgramMetadataIdlSourceOptions = {
  /** Fetch IDLs whose metadata points at an https URL. Off by default: it leaks which programs you look at. */
  allowUrlFetch?: boolean;
  fetch?: typeof fetch;
};

const URL_FETCH_TIMEOUT_MS = 5000;

/** Applies the metadata's compression and encoding (mirrors upstream `unpackDirectData`, with a size cap). */
function unpack(data: Uint8Array, compression: Compression, encoding: Encoding): string {
  let bytes: Uint8Array;
  if (compression === Compression.None) {
    if (data.length > MAX_IDL_BYTES) throw sizeError(MAX_IDL_BYTES);
    bytes = data;
  } else if (compression === Compression.Zlib) bytes = inflateCapped(data);
  else if (compression === Compression.Gzip) bytes = gunzipCapped(data);
  else throw new IdlDecodeError(`Program Metadata: unsupported compression ${String(compression)}`);
  // Upstream decodes `None` as base16; an IDL is JSON text, so raw bytes are read as UTF-8.
  if (encoding !== Encoding.Utf8 && encoding !== Encoding.None) {
    throw new IdlDecodeError(`Program Metadata: unsupported encoding ${String(encoding)}`);
  }
  return new TextDecoder().decode(bytes);
}

function parseUrl(text: string): URL {
  try {
    return new URL(text);
  } catch {
    throw new IdlDecodeError('Program Metadata: invalid IDL URL');
  }
}

function checkUrlPolicy(url: URL): void {
  if (url.protocol !== 'https:') throw new IdlDecodeError(`IDL URL must use https (got ${url.protocol})`);
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new IdlDecodeError('IDL URL must not point at localhost');
  // WHATWG URL normalizes every IPv4 spelling to dotted decimal and wraps IPv6 in brackets.
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    throw new IdlDecodeError('IDL URL must not be an IP address');
  }
}

async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > max) throw sizeError(max);
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        void reader.cancel().catch(() => {});
        throw sizeError(max);
      }
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(concatBytes(chunks, total));
}

/** Canonical IDLs published by the program's upgrade authority through the Program Metadata Program. */
export class ProgramMetadataIdlSource implements IdlSource {
  readonly kind = 'program-metadata' as const;

  constructor(
    private readonly reader: ChainReader,
    private readonly options: ProgramMetadataIdlSourceOptions = {},
  ) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [pda] = await findMetadataPda({ program: programId, authority: null, seed: 'idl' });
    const [account] = await this.reader.getAccounts([pda]);
    if (!account || account.owner !== PROGRAM_METADATA_PROGRAM_ADDRESS) return null;

    const { dataSource, content } = await asDecodeError(() => {
      const md = getMetadataDecoder().decode(account.data);
      if (md.format !== Format.Json) throw new IdlDecodeError(`Program Metadata: unsupported format ${String(md.format)}`);
      if (md.dataLength > md.data.length) throw new IdlDecodeError('Program Metadata: data is truncated');
      if (md.dataSource === DataSource.External) {
        throw new IdlDecodeError('Program Metadata "external" data source is not supported yet');
      }
      if (md.dataSource !== DataSource.Direct && md.dataSource !== DataSource.Url) {
        throw new IdlDecodeError(`Program Metadata: unsupported data source ${String(md.dataSource)}`);
      }
      // For a Url data source the packed bytes are the URL itself (upstream `unpackUrlData`).
      const data = md.data.slice(0, md.dataLength) as Uint8Array;
      return { dataSource: md.dataSource, content: unpack(data, md.compression, md.encoding) };
    });

    const json = dataSource === DataSource.Url ? await this.fetchUrl(content) : content;
    return asDecodeError(() => resolveIdl(programId, this.kind, 'authority', json));
  }

  private async fetchUrl(text: string): Promise<string> {
    const url = parseUrl(text);
    if (!this.options.allowUrlFetch) {
      throw new IdlDecodeError(`IDL is hosted at ${url.origin}; URL fetching is disabled`);
    }
    checkUrlPolicy(url);
    const doFetch = this.options.fetch ?? fetch;
    // Network failures and HTTP errors stay transient (plain Error); size violations are permanent.
    const response = await doFetch(url.href, {
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`IDL fetch from ${url.origin} failed with HTTP ${response.status}`);
    return readCapped(response, MAX_IDL_BYTES);
  }
}
