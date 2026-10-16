// surfnet_* cheatcodes (shapes verified against surfpool 1.4.0, see .agent/research/local-validator-testing.md).
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export async function rpcCall<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message} (${body.error.code})`);
  return body.result as T;
}

/** Sets the SOL balance of `address` (creating a system account if needed). */
export async function fund(url: string, address: string, lamports: bigint | number): Promise<void> {
  await rpcCall(url, 'surfnet_setAccount', [address, { lamports: Number(lamports) }]);
}

/** Sets the balance of `owner`'s associated token account for `mint` (created if missing). */
export async function fundToken(
  url: string,
  owner: string,
  mint: string,
  amount: bigint | number,
  tokenProgram: string = TOKEN_PROGRAM,
): Promise<void> {
  await rpcCall(url, 'surfnet_setTokenAccount', [owner, mint, { amount: Number(amount) }, tokenProgram]);
}

/** Jumps the validator clock forward to `slot`. */
export async function timeTravel(url: string, slot: bigint | number): Promise<void> {
  await rpcCall(url, 'surfnet_timeTravel', [{ absoluteSlot: Number(slot) }]);
}
