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
