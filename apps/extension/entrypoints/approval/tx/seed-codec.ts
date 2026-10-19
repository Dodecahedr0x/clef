import type { SeedInfo, SeedType } from '@clef/explain';
import { getAddressDecoder, getAddressEncoder, isAddress } from '@solana/kit';

/** How a seed is edited: as text, a key (base58), an integer (decimal), or raw bytes (hex) when nothing else fits. */
export type SeedEditor = { kind: 'string' } | { kind: 'pubkey' } | Extract<SeedType, { kind: 'number' }> | { kind: 'hex' };

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const printable = (bytes: Uint8Array) => bytes.length > 0 && bytes.every((b) => b >= 0x20 && b < 0x7f);
const WIDTH: Record<Extract<SeedType, { kind: 'number' }>['format'], number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16 };

/** The IDL's type when it has one that reads the bytes back; else text if printable, a key if 32 bytes, else hex. */
export function editorFor(seed: SeedInfo): SeedEditor {
  const bytes = fromHex(seed.hex ?? '');
  const t = seed.type;
  if (t?.kind === 'pubkey' && bytes.length === 32) return t;
  if (t?.kind === 'number' && bytes.length === WIDTH[t.format]) return t;
  if (t?.kind === 'string') return t;
  if (printable(bytes)) return { kind: 'string' };
  if (!t && bytes.length === 32) return { kind: 'pubkey' };
  return { kind: 'hex' };
}

function readInt(bytes: Uint8Array, e: Extract<SeedType, { kind: 'number' }>): bigint {
  const ordered = e.endian === 'le' ? [...bytes].reverse() : [...bytes];
  let v = ordered.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  const bits = BigInt(bytes.length * 8);
  if (e.format.startsWith('i') && v >= 1n << (bits - 1n)) v -= 1n << bits;
  return v;
}

/** The seed's derived bytes, as its editor shows them. */
export function seedText(seed: SeedInfo, editor: SeedEditor): string {
  const bytes = fromHex(seed.hex ?? '');
  switch (editor.kind) {
    case 'string':
      return new TextDecoder().decode(bytes);
    case 'pubkey':
      return getAddressDecoder().decode(bytes);
    case 'number':
      return readInt(bytes, editor).toString();
    case 'hex':
      return toHex(bytes);
  }
}

/** Bytes for what the user typed, or why it can't be a seed (a seed is at most 32 bytes). */
export function seedBytes(text: string, editor: SeedEditor): { bytes: Uint8Array } | { error: string } {
  let bytes: Uint8Array;
  switch (editor.kind) {
    case 'string':
      bytes = new TextEncoder().encode(text);
      break;
    case 'pubkey': {
      const t = text.trim();
      if (!isAddress(t)) return { error: 'Not a valid public key' };
      bytes = new Uint8Array(getAddressEncoder().encode(t));
      break;
    }
    case 'number': {
      const t = text.trim();
      if (!/^-?\d+$/.test(t)) return { error: `Not a whole number (${editor.format})` };
      const width = WIDTH[editor.format];
      const bits = BigInt(width * 8);
      const signed = editor.format.startsWith('i');
      const v = BigInt(t);
      const [min, max] = signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
      if (v < min || v > max) return { error: `Out of range for ${editor.format} (${min} to ${max})` };
      let u = v < 0n ? v + (1n << bits) : v;
      const be = new Uint8Array(width);
      for (let i = width - 1; i >= 0; i--) {
        be[i] = Number(u & 0xffn);
        u >>= 8n;
      }
      bytes = editor.endian === 'le' ? be.reverse() : be;
      break;
    }
    case 'hex': {
      const t = text.trim().replace(/^0x/i, '').replace(/\s+/g, '');
      if (!/^([0-9a-fA-F]{2})*$/.test(t)) return { error: 'Not hex (pairs of 0-9, a-f)' };
      bytes = fromHex(t.toLowerCase());
      break;
    }
  }
  if (bytes.length > 32) return { error: `${bytes.length} bytes: a seed is at most 32` };
  return { bytes };
}
