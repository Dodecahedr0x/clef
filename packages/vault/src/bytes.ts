import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

export const toBase64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);
export const fromBase64 = (text: string): Uint8Array => new Uint8Array(getBase64Encoder().encode(text));
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Best-effort wipe of key material (JS cannot guarantee no copies exist). */
export function zeroize(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}
