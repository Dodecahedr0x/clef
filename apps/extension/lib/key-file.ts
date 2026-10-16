import { parseSecretKey } from '@clef/vault';

/** A keypair file is tiny (the CLI's JSON array is ~250 bytes); anything larger is not one. */
export const MAX_KEY_FILE_BYTES = 4096;

export type KeyFileResult = { ok: true; secret: string; address: string } | { ok: false; error: string };

/**
 * Reads a dropped or chosen key file: the Solana CLI keypair JSON (64 numbers) or a text file holding the
 * base58 secret key. The key is checked (public half must match) before it is offered for import.
 */
export async function readKeyFile(file: Pick<File, 'size' | 'text'>): Promise<KeyFileResult> {
  if (file.size === 0 || file.size > MAX_KEY_FILE_BYTES) return { ok: false, error: 'This file is not a Solana private key (wrong size).' };
  const secret = (await file.text()).trim();
  try {
    const { address, privateKey } = await parseSecretKey(secret);
    privateKey.fill(0);
    return { ok: true, secret, address };
  } catch {
    return { ok: false, error: 'This file is not a Solana private key. Use a keypair .json from the Solana CLI or a base58 key.' };
  }
}
