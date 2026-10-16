import type { ResolvedIdl } from '@clef/idl';
import { parseAccountData } from '@codama/dynamic-parsers';
import { getAddressEncoder, type Address } from '@solana/kit';
import type { AccountCache } from './accounts';
import { SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './registry';
import { sanitizeText } from './text';
import type { RelationEdge } from './types';

/** Large program accounts (order books, maps) are scanned up to this many bytes. */
const MAX_SCAN = 1 << 20;

const latin1 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

/** Field path (`vault`, `config.authority`) whose value is `target`, in data decoded by the program's IDL. */
function fieldFor(data: unknown, target: string, depth = 0): string | null {
  if (depth > 3 || data === null || typeof data !== 'object') return null;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === target) return k;
    const inner = fieldFor(v, target, depth + 1);
    if (inner) return `${k}.${inner}`;
  }
  return null;
}

/**
 * Relations read from the accounts themselves, for every account of the transaction (not only those an IDL
 * constrains):
 * - `program-owner`: owned by a program that is also in the transaction (wallets and token accounts excluded:
 *   System and Token ownership is the norm, and token holders/mints have their own edges);
 * - `data-ref`: a program account whose data holds another key of the transaction. Raw 32-byte matches are
 *   unambiguous; the label is the field name when the program's IDL decodes the account.
 */
export function dataRelations(addresses: readonly Address[], cache: AccountCache, idlOf: (program: Address) => ResolvedIdl | undefined): RelationEdge[] {
  const keys = [...new Set(addresses)];
  const encoder = getAddressEncoder();
  // The System Program's address is 32 zero bytes: it would match any empty stretch of data (and "unset" fields).
  const needles = keys.filter((k) => k !== SYSTEM_PROGRAM).map((k) => ({ address: k, bytes: latin1(new Uint8Array(encoder.encode(k))) }));
  const inTx = new Set<string>(keys);
  const edges: RelationEdge[] = [];

  for (const address of keys) {
    const account = cache.get(address);
    if (!account || account.executable) continue;
    const owner = account.owner;
    if (owner === SYSTEM_PROGRAM || TOKEN_PROGRAMS.has(owner)) continue;

    if (inTx.has(owner)) {
      edges.push({ kind: 'program-owner', from: address, to: owner, label: 'owned by', status: 'verified', external: false });
    }

    if (!account.data.length) continue;
    const haystack = latin1(account.data.subarray(0, MAX_SCAN));
    let decoded: unknown;
    let tried = false;
    for (const n of needles) {
      if (n.address === address || n.address === owner) continue;
      if (haystack.indexOf(n.bytes) < 0) continue;
      if (!tried) {
        tried = true;
        const idl = idlOf(owner);
        try {
          decoded = idl ? parseAccountData(idl.root, account.data, { programAddress: owner })?.data : undefined;
        } catch {
          decoded = undefined;
        }
      }
      const field = fieldFor(decoded, n.address);
      edges.push({
        kind: 'data-ref',
        from: address,
        to: n.address,
        label: field ? sanitizeText(field, 48) : 'stores',
        status: 'verified',
        detail: field ? `its ${sanitizeText(field, 48)} field holds this account` : 'its data holds this address',
        external: false,
      });
    }
  }
  return edges;
}
