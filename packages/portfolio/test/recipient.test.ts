import { describe, expect, it } from 'vitest';
import { address, type Address } from '@solana/kit';
import { MemoryChainReader, type ChainReader } from '@clef/rpc';
import * as programs from '@clef/explain';

const SYSTEM_PROGRAM = address(programs.SYSTEM_PROGRAM);
const TOKEN_PROGRAM = address(programs.TOKEN_PROGRAM);
const TOKEN_2022_PROGRAM = address(programs.TOKEN_2022_PROGRAM);
import { classifyRecipient } from '../src/recipient';

const A = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const OTHER_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

function chainWith(owner: Address, data: Uint8Array, executable = false): MemoryChainReader {
  const chain = new MemoryChainReader();
  chain.accounts.set(A, { address: A, owner, lamports: 1n, data, executable });
  return chain;
}

describe('classifyRecipient', () => {
  it('system-owned account is a wallet', async () => {
    expect(await classifyRecipient(chainWith(SYSTEM_PROGRAM, new Uint8Array()), A)).toBe('wallet');
  });
  it('missing account is new', async () => {
    expect(await classifyRecipient(new MemoryChainReader(), A)).toBe('new');
  });
  it('executable account is a program', async () => {
    expect(await classifyRecipient(chainWith(address('BPFLoaderUpgradeab1e11111111111111111111111'), new Uint8Array(36), true), A)).toBe('program');
  });
  it('165-byte token account is a token account (both programs)', async () => {
    expect(await classifyRecipient(chainWith(TOKEN_PROGRAM, new Uint8Array(165)), A)).toBe('token-account');
    expect(await classifyRecipient(chainWith(TOKEN_2022_PROGRAM, new Uint8Array(165)), A)).toBe('token-account');
  });
  it('Token-2022 extended account needs the account-type byte', async () => {
    const acct = new Uint8Array(200);
    acct[165] = 2;
    expect(await classifyRecipient(chainWith(TOKEN_2022_PROGRAM, acct), A)).toBe('token-account');
    const mint = new Uint8Array(200);
    mint[165] = 1;
    expect(await classifyRecipient(chainWith(TOKEN_2022_PROGRAM, mint), A)).toBe('unknown');
  });
  it('mint and other-owned data are unknown', async () => {
    expect(await classifyRecipient(chainWith(TOKEN_PROGRAM, new Uint8Array(82)), A)).toBe('unknown');
    expect(await classifyRecipient(chainWith(TOKEN_PROGRAM, new Uint8Array(200)), A)).toBe('unknown');
    expect(await classifyRecipient(chainWith(OTHER_PROGRAM, new Uint8Array(10)), A)).toBe('unknown');
  });
  it('read failure is unknown', async () => {
    const chain: ChainReader = {
      getAccounts: async () => {
        throw new Error('rpc down');
      },
    } as unknown as ChainReader;
    expect(await classifyRecipient(chain, A)).toBe('unknown');
  });
});
