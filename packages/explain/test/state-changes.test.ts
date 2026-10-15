import type { RawAccount } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { computeStateChanges, SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

const ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const THIRD = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const T = address(TOKEN_PROGRAM);
const raw = (addr: Address, owner: Address, data: Uint8Array = new Uint8Array()): RawAccount =>
  ({ address: addr, owner, lamports: 1n, executable: false, data });
const token = (...args: Parameters<typeof tokenAccountData>) => raw(ACC, T, tokenAccountData(...args));

describe('computeStateChanges', () => {
  it('reports program owner changes', () => {
    expect(computeStateChanges([raw(ME, address(SYSTEM_PROGRAM))], [raw(ME, OTHER)])).toEqual([
      { address: ME, kind: 'program-owner', before: SYSTEM_PROGRAM, after: OTHER },
    ]);
  });

  it('reports token owner, delegate and close authority changes with the pre holder and balance', () => {
    const changes = computeStateChanges(
      [token(ME, USDC, 100n)],
      [token(OTHER, USDC, 100n, { delegate: THIRD, delegatedAmount: 50n, closeAuthority: THIRD })],
    );
    const common = { address: ACC, holder: ME, balance: 100n };
    expect(changes).toEqual([
      { ...common, kind: 'token-owner', before: ME, after: OTHER },
      { ...common, kind: 'token-delegate', before: null, after: THIRD, amount: 50n },
      { ...common, kind: 'token-close-authority', before: null, after: THIRD },
    ]);
  });

  it('reports an increased allowance to the same delegate, but not a decrease or a revoke', () => {
    const pre = token(ME, USDC, 100n, { delegate: OTHER, delegatedAmount: 10n });
    expect(computeStateChanges([pre], [token(ME, USDC, 100n, { delegate: OTHER, delegatedAmount: 20n })])).toMatchObject([
      { kind: 'token-delegate', before: OTHER, after: OTHER, amount: 20n },
    ]);
    expect(computeStateChanges([pre], [token(ME, USDC, 95n, { delegate: OTHER, delegatedAmount: 5n })])).toEqual([]);
    expect(computeStateChanges([pre], [token(ME, USDC, 100n)])).toEqual([]);
  });

  it('matches by address and ignores missing, unloaded or created accounts', () => {
    expect(computeStateChanges([undefined, null, raw(OTHER, T)], [raw(ME, OTHER), raw(ACC, OTHER), raw(ME, ME)])).toEqual([]);
  });
});
