import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { KitChainReader, MemorySender } from '../src';

describe('TransactionSender', () => {
  it('KitChainReader.send base64-encodes the wire and returns the signature', async () => {
    const sendTransaction = vi.fn((_wire: string, _config: unknown) => ({ send: async () => '5sig' }));
    const reader = new KitChainReader({ sendTransaction } as unknown as Rpc<SolanaRpcApi>);
    expect(await reader.send(new Uint8Array([1, 2]), { skipPreflight: true, maxRetries: 3 })).toBe('5sig');
    expect(sendTransaction).toHaveBeenCalledWith('AQI=', {
      encoding: 'base64',
      preflightCommitment: 'confirmed',
      skipPreflight: true,
      maxRetries: 3n,
    });
  });

  it('defaults to preflight checks', async () => {
    const sendTransaction = vi.fn((_wire: string, _config: unknown) => ({ send: async () => 'sig' }));
    await new KitChainReader({ sendTransaction } as unknown as Rpc<SolanaRpcApi>).send(new Uint8Array([1]));
    expect(sendTransaction.mock.calls[0]![1]).toMatchObject({ skipPreflight: false });
  });

  it('MemorySender records copies of what it was asked to send', async () => {
    const s = new MemorySender('sig1');
    const wire = new Uint8Array([9]);
    expect(await s.send(wire)).toBe('sig1');
    wire[0] = 0;
    expect(s.sent).toEqual([new Uint8Array([9])]);
  });
});
