import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { KitChainReader, MemorySender, RebroadcastingSender } from '../src';

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

describe('RebroadcastingSender', () => {
  const sleep = async () => {};

  it('returns the first answer, then resends without preflight until the signature is known', async () => {
    const inner = { send: vi.fn(async () => 'sig') };
    const landed = vi.fn(async () => false).mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sender = new RebroadcastingSender(inner, landed, { everyMs: 1, forMs: 100, sleep });
    vi.spyOn(sender, 'resend').mockImplementationOnce(async () => {});
    expect(await sender.send(new Uint8Array([1]), { skipPreflight: false })).toBe('sig');
    expect(inner.send).toHaveBeenCalledWith(new Uint8Array([1]), { skipPreflight: false });
    vi.mocked(sender.resend).mockRestore();
    await sender.resend(new Uint8Array([1]), 'sig');
    expect(landed).toHaveBeenCalledTimes(3);
    expect(inner.send).toHaveBeenCalledTimes(3);
    expect(inner.send).toHaveBeenLastCalledWith(new Uint8Array([1]), { skipPreflight: true, maxRetries: 0 });
  });

  it('a failed first send throws and is not resent', async () => {
    const inner = { send: vi.fn(async () => { throw new Error('Blockhash not found'); }) };
    const landed = vi.fn(async () => false);
    await expect(new RebroadcastingSender(inner, landed, { sleep }).send(new Uint8Array([1]))).rejects.toThrow('Blockhash not found');
    expect(landed).not.toHaveBeenCalled();
  });

  it('stops after forMs, and a resend error never escapes', async () => {
    const inner = { send: vi.fn(async () => { throw new Error('already processed'); }) };
    const landed = vi.fn(async () => false);
    await new RebroadcastingSender(inner, landed, { everyMs: 10, forMs: 50, sleep }).resend(new Uint8Array([1]), 'sig');
    expect(landed).toHaveBeenCalledTimes(5);
  });
});
