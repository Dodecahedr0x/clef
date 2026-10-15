/** A deterministic failure to decode an IDL (size, layout, format, policy, address mismatch). Retrying won't help. */
export class IdlDecodeError extends Error {
  override readonly name = 'IdlDecodeError';
}

/** Runs `fn`, turning any failure into an `IdlDecodeError` (for decoding steps whose failures are deterministic). */
export async function asDecodeError<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IdlDecodeError) throw e;
    throw new IdlDecodeError(e instanceof Error ? e.message : String(e), { cause: e });
  }
}
