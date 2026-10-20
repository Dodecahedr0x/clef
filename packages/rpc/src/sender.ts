export type SendOptions = { skipPreflight?: boolean; maxRetries?: number; minContextSlot?: bigint };

/** Submits a fully signed wire transaction; resolves with its base58 signature once the RPC accepted it. */
export interface TransactionSender {
  send(wire: Uint8Array, options?: SendOptions): Promise<string>;
}

/** Test double: records what it was asked to send and returns a fixed signature. */
export class MemorySender implements TransactionSender {
  readonly sent: Uint8Array[] = [];

  constructor(private readonly signature = '1111111111111111111111111111111111111111111111111111111111111111') {}

  async send(wire: Uint8Array): Promise<string> {
    this.sent.push(new Uint8Array(wire));
    return this.signature;
  }
}

/**
 * Sends, then sends the same bytes again every `everyMs` until the RPC knows the signature (landed or failed) or
 * `forMs` passes, about a blockhash's life: a leader that can't schedule a transaction drops it, and one send is
 * then lost. Resends skip preflight and never throw; the first send's answer is the one the caller gets.
 */
export class RebroadcastingSender implements TransactionSender {
  constructor(
    private readonly inner: TransactionSender,
    private readonly landed: (signature: string) => Promise<boolean>,
    private readonly opts: { everyMs?: number; forMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  async send(wire: Uint8Array, options?: SendOptions): Promise<string> {
    const signature = await this.inner.send(wire, options);
    void this.resend(wire, signature);
    return signature;
  }

  /** Resolves when it stops resending (exposed for tests). */
  async resend(wire: Uint8Array, signature: string): Promise<void> {
    const everyMs = this.opts.everyMs ?? 2_000;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let waited = 0; waited < (this.opts.forMs ?? 60_000); waited += everyMs) {
      await sleep(everyMs);
      try {
        if (await this.landed(signature)) return;
        await this.inner.send(wire, { skipPreflight: true, maxRetries: 0 });
      } catch {
        // Already processed, expired, or the RPC is briefly unreachable: the next round checks again.
      }
    }
  }
}
