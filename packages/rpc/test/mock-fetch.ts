export type RpcRequest = { method: string; params: unknown };
type Handler = (req: RpcRequest) => { status?: number; result?: unknown; error?: { code: number; message: string } } | Promise<{ status?: number; result?: unknown; error?: { code: number; message: string } }>;

/** A fetch that answers JSON-RPC bodies from `handler` and records every request. */
export function mockFetch(handler: Handler) {
  const requests: RpcRequest[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown };
    const req = { method: body.method, params: body.params };
    requests.push(req);
    const out = await handler(req);
    const status = out.status ?? 200;
    const payload = status === 200 ? JSON.stringify({ jsonrpc: '2.0', id: body.id, ...('error' in out ? { error: out.error } : { result: out.result }) }) : 'disabled';
    return new Response(payload, { status });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

