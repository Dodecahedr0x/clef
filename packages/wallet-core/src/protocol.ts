import { fromBase64 } from '@clef/vault';
import { isAddress } from '@solana/kit';

export const ERR = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED: 4200,
  BUSY: 4429,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const MAX_ID = 64;
const MAX_TX_BYTES = 4096; // v1 maximum; legacy/v0 are smaller
const MAX_BATCH = 16;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_FIELD = 512;
const MAX_RESOURCES = 20;
const SIGN_IN_FIELDS = [
  'domain',
  'address',
  'statement',
  'uri',
  'version',
  'chainId',
  'nonce',
  'issuedAt',
  'expirationTime',
  'notBefore',
  'requestId',
  'resources',
] as const;

type SignInStringField = Exclude<(typeof SIGN_IN_FIELDS)[number], 'resources'>;
export type SignInInput = Partial<Record<SignInStringField, string>> & { resources?: string[] };

export type Request =
  | { id: string; method: 'connect'; params: { silent: boolean } }
  | { id: string; method: 'disconnect'; params: Record<string, never> }
  | { id: string; method: 'signTransaction'; params: { account: string; chain: string; transactions: Uint8Array[] } }
  | { id: string; method: 'signAndSendTransaction'; params: { account: string; chain: string; transaction: Uint8Array; skipPreflight: boolean } }
  | { id: string; method: 'signMessage'; params: { account: string; message: Uint8Array } }
  | { id: string; method: 'signIn'; params: { input: SignInInput } };

export type Response = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: { code: number; message: string } };

const invalid = (msg: string) => new ProtocolError(ERR.INVALID_PARAMS, msg);

/** Plain JSON objects only: arrays, class instances and objects with altered prototypes are rejected. */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function str(v: unknown, name: string, max = MAX_FIELD): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw invalid(`${name} must be a non-empty string`);
  return v;
}

function account(v: unknown): string {
  const a = str(v, 'account', 64);
  if (!isAddress(a)) throw invalid('account is not an address');
  return a;
}

function chain(v: unknown): string {
  const c = str(v, 'chain', 64);
  if (!/^solana:[a-z]+$/.test(c)) throw invalid('unsupported chain');
  return c;
}

function b64(v: unknown, name: string, maxBytes: number): Uint8Array {
  const s = str(v, name, Math.ceil(maxBytes / 3) * 4);
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw invalid(`${name} must be base64`);
  const bytes = fromBase64(s);
  if (bytes.length === 0 || bytes.length > maxBytes) throw invalid(`${name} has an invalid size`);
  return bytes;
}

function signInInput(v: unknown): SignInInput {
  if (!isObj(v)) throw invalid('input must be an object');
  for (const key of Object.keys(v)) {
    if (!(SIGN_IN_FIELDS as readonly string[]).includes(key)) throw invalid('unknown signIn field');
  }
  const out: SignInInput = {};
  for (const key of SIGN_IN_FIELDS) {
    const field = v[key];
    if (field === undefined) continue;
    if (key === 'resources') {
      if (!Array.isArray(field) || field.length > MAX_RESOURCES) throw invalid('resources must be an array');
      out.resources = field.map((r, i) => str(r, `resources[${i}]`));
    } else {
      out[key] = str(field, key);
    }
  }
  if (out.address !== undefined && !isAddress(out.address)) throw invalid('address is not an address');
  return out;
}

/** Validates an untrusted request from a page. Everything that crosses the page boundary goes through here. */
export function parseRequest(raw: unknown): Request {
  if (!isObj(raw)) throw invalid('request must be an object');
  const id = str(raw.id, 'id', MAX_ID);
  const p = raw.params ?? {};
  if (!isObj(p)) throw invalid('params must be an object');
  switch (raw.method) {
    case 'connect':
      return { id, method: 'connect', params: { silent: p.silent === true } };
    case 'disconnect':
      return { id, method: 'disconnect', params: {} };
    case 'signTransaction': {
      const list = p.transactions;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) throw invalid(`transactions must be a non-empty array (max ${MAX_BATCH})`);
      return {
        id,
        method: 'signTransaction',
        params: { account: account(p.account), chain: chain(p.chain), transactions: list.map((t, i) => b64(t, `transactions[${i}]`, MAX_TX_BYTES)) },
      };
    }
    case 'signAndSendTransaction':
      return {
        id,
        method: 'signAndSendTransaction',
        params: { account: account(p.account), chain: chain(p.chain), transaction: b64(p.transaction, 'transaction', MAX_TX_BYTES), skipPreflight: p.skipPreflight === true },
      };
    case 'signMessage':
      return { id, method: 'signMessage', params: { account: account(p.account), message: b64(p.message, 'message', MAX_MESSAGE_BYTES) } };
    case 'signIn':
      return { id, method: 'signIn', params: { input: signInInput(p.input ?? {}) } };
    default:
      throw invalid('unknown method');
  }
}

/** Protocol errors pass through; anything else becomes a generic internal error so no detail leaks to the page. */
export const failure = (id: string, e: unknown): Response => ({
  id,
  ok: false,
  error: e instanceof ProtocolError ? { code: e.code, message: e.message } : { code: ERR.INTERNAL, message: 'Internal error' },
});
