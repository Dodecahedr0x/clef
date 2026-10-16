import { getAddressDecoder, type Address } from '@solana/kit';

/** Minimal Borsh cursor for the few Squads accounts Clef reads. Throws on truncated data. */
export class Cursor {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private take(n: number): number {
    const at = this.offset;
    if (at + n > this.data.length) throw new RangeError('Squads account data is truncated');
    this.offset += n;
    return at;
  }

  skip(n: number): void {
    this.take(n);
  }
  u8(): number {
    return this.view.getUint8(this.take(1));
  }
  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }
  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true);
  }
  bytes(n: number): Uint8Array {
    const at = this.take(n);
    return this.data.slice(at, at + n);
  }
  address(): Address {
    return getAddressDecoder().decode(this.bytes(32));
  }
  vec<T>(item: () => T): T[] {
    const n = this.u32();
    if (n > this.data.length - this.offset) throw new RangeError('Squads account data is truncated');
    return Array.from({ length: n }, () => item());
  }
  vecU8(): Uint8Array {
    return this.bytes(this.u32());
  }
  option<T>(item: () => T): T | null {
    return this.u8() === 0 ? null : item();
  }
}
