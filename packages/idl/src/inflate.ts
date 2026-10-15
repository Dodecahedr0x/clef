import { Gunzip, Unzlib } from 'fflate';
import { IdlDecodeError } from './errors';

export const MAX_IDL_BYTES = 4 * 1024 * 1024;

/** Input is fed in small chunks so one push can never inflate much more than ~1 MiB (deflate peaks near 1032:1). */
const INPUT_CHUNK = 1024;

export function sizeError(max: number): IdlDecodeError {
  return new IdlDecodeError(max % (1024 * 1024) === 0 ? `IDL exceeds ${max / (1024 * 1024)} MiB` : `IDL exceeds ${max} bytes`);
}

export function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

type Stream = { ondata: (data: Uint8Array, final: boolean) => void; push(chunk: Uint8Array, final?: boolean): void };

function decompressCapped(stream: Stream, input: Uint8Array, max: number, label: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  stream.ondata = (data) => {
    total += data.length;
    if (total > max) throw sizeError(max);
    chunks.push(data);
  };
  try {
    if (input.length === 0) stream.push(input, true);
    for (let i = 0; i < input.length; i += INPUT_CHUNK) {
      stream.push(input.subarray(i, i + INPUT_CHUNK), i + INPUT_CHUNK >= input.length);
    }
  } catch (e) {
    if (e instanceof IdlDecodeError) throw e;
    throw new IdlDecodeError(`Invalid ${label} data: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return concatBytes(chunks, total);
}

/** Inflates zlib data, failing with `IdlDecodeError` as soon as the output exceeds `max` bytes. */
export function inflateCapped(input: Uint8Array, max = MAX_IDL_BYTES): Uint8Array {
  return decompressCapped(new Unzlib() as Stream, input, max, 'zlib');
}

/** Gunzips data, failing with `IdlDecodeError` as soon as the output exceeds `max` bytes. */
export function gunzipCapped(input: Uint8Array, max = MAX_IDL_BYTES): Uint8Array {
  return decompressCapped(new Gunzip() as Stream, input, max, 'gzip');
}
