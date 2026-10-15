import { sanitizeText } from '@clef/explain';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { parseSignInMessage } from '@solana/wallet-standard-util';

type Common = { looksLikeTransaction: boolean; danger: boolean };

export type MessageInspection =
  | (Common & { kind: 'siws'; domain: string; domainMatches: boolean; fields: Record<string, string> })
  | (Common & { kind: 'text'; text: string })
  | (Common & { kind: 'binary'; hex: string });

const MAX_LINE = 4096;
/** C0 controls other than tab, newline and carriage return mark a message as binary. */
const BINARY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A message that decodes as a transaction (or its message bytes) could make a signature authorize that transaction. */
function decodesAsTransaction(bytes: Uint8Array): boolean {
  const attempts = [() => getTransactionDecoder().decode(bytes), () => getCompiledTransactionMessageDecoder().decode(bytes)];
  return attempts.some((attempt) => {
    try {
      attempt();
      return true;
    } catch {
      return false;
    }
  });
}

const cleanLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((line) => sanitizeText(line, MAX_LINE))
    .join('\n');

/** Describes what a `signMessage` request would sign, for display, and whether it is dangerous to sign. */
export function inspectMessage(bytes: Uint8Array, origin: string): MessageInspection {
  const looksLikeTransaction = decodesAsTransaction(bytes);
  const siws = parseSignInMessage(bytes);
  if (siws) {
    const domainMatches = siws.domain === new URL(origin).host;
    const fields = Object.fromEntries(
      Object.entries(siws).flatMap(([k, v]) => (typeof v === 'string' ? [[k, sanitizeText(v, MAX_LINE)]] : [])),
    );
    return { kind: 'siws', domain: sanitizeText(siws.domain, 256), domainMatches, fields, looksLikeTransaction, danger: !domainMatches || looksLikeTransaction };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!BINARY_CONTROL.test(text)) return { kind: 'text', text: cleanLines(text), looksLikeTransaction, danger: looksLikeTransaction };
  } catch {
    // not UTF-8: fall through to hex
  }
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { kind: 'binary', hex, looksLikeTransaction, danger: looksLikeTransaction };
}
