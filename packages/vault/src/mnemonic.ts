import { generateMnemonic as gen, mnemonicToSeed as toSeed, validateMnemonic as valid } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** NFKD, trimmed, lower-case, single spaces -- the form BIP39 hashes. */
export const normalizeMnemonic = (m: string): string => m.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');

export const generateMnemonic = (words: 12 | 24 = 12): string => gen(wordlist, words === 12 ? 128 : 256);

export const validateMnemonic = (m: string): boolean => valid(normalizeMnemonic(m), wordlist);

export async function mnemonicToSeed(m: string, passphrase = ''): Promise<Uint8Array> {
  return toSeed(normalizeMnemonic(m), passphrase);
}

const WORDS = new Set(wordlist);
/** True for a word of the BIP39 English list (lowercase). */
export const isBip39Word = (w: string): boolean => WORDS.has(w);
