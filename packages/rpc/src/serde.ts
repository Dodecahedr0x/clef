import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

const BIGINT = '$bigint';
const BYTES = '$bytes';
const OBJ = '$obj';
const MARKERS = new Set([BIGINT, BYTES, OBJ]);

function soleKey(v: object): string | undefined {
  const keys = Object.keys(v);
  return keys.length === 1 ? keys[0] : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
}

// Encoding and decoding are explicit walks (not replacer/reviver) so each level is processed exactly once.
function encode(v: unknown): unknown {
  if (typeof v === 'bigint') return { [BIGINT]: v.toString() };
  if (v instanceof Uint8Array) return { [BYTES]: getBase64Decoder().decode(v) };
  if (Array.isArray(v)) return v.map(encode);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, inner] of Object.entries(v)) out[k] = encode(inner);
  // Escape objects that would otherwise be mistaken for a marker.
  return MARKERS.has(soleKey(out) ?? '') ? { [OBJ]: out } : out;
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (!isPlainObject(v)) return v;
  const key = soleKey(v);
  if (key === BIGINT) return BigInt(v[BIGINT] as string);
  if (key === BYTES) return new Uint8Array(getBase64Encoder().encode(v[BYTES] as string));
  // Unwrap one escape level: the wrapped object's own key is literal, its value is still encoded.
  const target = key === OBJ ? (v[OBJ] as Record<string, unknown>) : v;
  const out: Record<string, unknown> = {};
  for (const [k, inner] of Object.entries(target)) out[k] = decode(inner);
  return out;
}

export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(encode(value), null, space);
}

export function fromJson(text: string): unknown {
  return decode(JSON.parse(text));
}
