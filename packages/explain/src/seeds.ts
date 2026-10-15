import { toHex } from './hex';

/** The relation cannot be checked from what the transaction and IDL provide: reported as `unverified`. */
export class Unresolvable extends Error {}

/** Printable ASCII is shown as a quoted string, anything else as hex. */
export function displayBytes(bytes: Uint8Array): string {
  const printable = bytes.length > 0 && bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? JSON.stringify(new TextDecoder().decode(bytes)) : `0x${toHex(bytes)}`;
}
