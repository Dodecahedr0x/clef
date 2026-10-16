import { UnsupportedMethodError } from './types';

export type FetchFn = typeof fetch;

/** A JSON-RPC error response or a non-2xx HTTP status (`code` is then the negated status). */
export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = 'RpcError';
  }
}

// Integers beyond 2^53 (lamports, token amounts) are kept exact as bigints.
export function parseJson(text: string): unknown {
  return JSON.parse(text, ((_k: string, v: unknown, ctx?: { source?: string }) =>
    typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source && /^-?\d+$/.test(ctx.source) ? BigInt(ctx.source) : v) as never);
}

export function toBig(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' || typeof v === 'string') return BigInt(v);
  throw new TypeError(`expected an integer, got ${typeof v}`);
}

let nextId = 1;

/** One JSON-RPC 2.0 call. HTTP 410 and error -32601 throw `UnsupportedMethodError`. */
export async function rpcCall<T>(fetchFn: FetchFn, url: string, method: string, params: unknown): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  });
  if (res.status === 410) throw new UnsupportedMethodError(method);
  const text = await res.text();
  type Body = { result?: T; error?: { code?: number; message?: string } };
  let body: Body | null;
  try {
    body = parseJson(text) as Body | null;
  } catch {
    body = null;
  }
  if (body?.error) {
    const code = Number(body.error.code);
    if (code === -32601) throw new UnsupportedMethodError(method);
    throw new RpcError(method, code, body.error.message ?? 'RPC error');
  }
  if (!res.ok || !body || !('result' in body)) throw new RpcError(method, -res.status, `HTTP ${res.status}`);
  return body.result as T;
}
