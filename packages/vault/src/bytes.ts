import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

/** Bytes backed by a plain ArrayBuffer, as WebCrypto requires. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Returns `b` itself when it is ArrayBuffer-backed, otherwise a copy. */
export const asBytes = (b: Uint8Array): Bytes => (b.buffer instanceof ArrayBuffer ? (b as Bytes) : new Uint8Array(b));

export const toBase64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);
export const fromBase64 = (text: string): Bytes => new Uint8Array(getBase64Encoder().encode(text));
export const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

/** Best-effort wipe of key material (JS cannot guarantee no copies exist). */
export function zeroize(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}
