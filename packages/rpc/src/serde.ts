import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

const BIGINT = '$bigint';
const BYTES = '$bytes';

export function toJson(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) => {
      if (typeof v === 'bigint') return { [BIGINT]: v.toString() };
      if (v instanceof Uint8Array) return { [BYTES]: getBase64Decoder().decode(v) };
      return v;
    },
    space,
  );
}

export function fromJson(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === BIGINT) return BigInt((v as Record<string, string>)[BIGINT]!);
      if (keys.length === 1 && keys[0] === BYTES) {
        return new Uint8Array(getBase64Encoder().encode((v as Record<string, string>)[BYTES]!));
      }
    }
    return v;
  });
}
