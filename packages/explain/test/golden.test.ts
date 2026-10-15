import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import { AuthorityType, getApproveInstruction, getCloseAccountInstruction, getSetAuthorityInstruction, getTransferCheckedInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain, shortAddress, viewFor, TOKEN_PROGRAM, U64_MAX } from '../src';
import { buildWire, ME, OTHER, simulateWith, tokenAccountData, USDC } from './helpers';

/** Basic views of hostile transactions, end to end: the summary alone must never read as benign. */
const me = createNoopSigner(ME);
const SYS = address('11111111111111111111111111111111');
const MY_USDC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const ATTACKER_USDC = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');
const ATTACKER = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const DRAINER = address('FXZYmk8C97rhzTn7nE8YZCw1V9EGofcJ8jJ5XidoddLz');
const SOL = 1_000_000_000n;
const A = shortAddress(ATTACKER);

function chain() {
  const reader = new MemoryChainReader();
  reader.setAccount({ address: ME, owner: SYS, lamports: 10n * SOL, data: new Uint8Array() });
  reader.setAccount({ address: MY_USDC, owner: address(TOKEN_PROGRAM), data: tokenAccountData(ME, USDC, 100_000_000n) });
  return reader;
}
const basic = async (reader: MemoryChainReader, instructions: Instruction[]) =>
  viewFor(await explain({ wire: buildWire(instructions) }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] }), 'basic');

describe('basic view golden summaries for hostile transactions', () => {
  it('lone unlimited approve', async () => {
    const reader = chain();
    simulateWith(reader, { [MY_USDC]: { data: tokenAccountData(ME, USDC, 100_000_000n, { delegate: ATTACKER, delegatedAmount: U64_MAX }) } });
    const v = await basic(reader, [getApproveInstruction({ source: MY_USDC, delegate: ATTACKER, owner: me, amount: U64_MAX })]);
    expect(v.summary).toBe(`Let ${A} spend UNLIMITED USDC from Your USDC token account`);
    expect(v.warnings.map((w) => [w.rule, w.severity])).toEqual([['delegation', 'danger']]);
  });

  it('setAuthority handing over your token account', async () => {
    const reader = chain();
    simulateWith(reader, { [MY_USDC]: { data: tokenAccountData(ATTACKER, USDC, 100_000_000n) } });
    const v = await basic(reader, [
      getSetAuthorityInstruction({ owned: MY_USDC, owner: me, authorityType: AuthorityType.AccountOwner, newAuthority: ATTACKER }),
    ]);
    expect(v.summary).toBe(`Set the account owner authority of Your USDC token account to ${A}`);
    expect(v.warnings.map((w) => [w.rule, w.severity])).toEqual([['authority-change', 'danger'], ['send-entire-balance', 'warn']]);
  });

  it('setAuthority handing over the close authority', async () => {
    const reader = chain();
    simulateWith(reader, { [MY_USDC]: { data: tokenAccountData(ME, USDC, 100_000_000n, { closeAuthority: ATTACKER }) } });
    const v = await basic(reader, [
      getSetAuthorityInstruction({ owned: MY_USDC, owner: me, authorityType: AuthorityType.CloseAccount, newAuthority: ATTACKER }),
    ]);
    expect(v.summary).toBe(`Set the close account authority of Your USDC token account to ${A}`);
    expect(v.warnings.map((w) => [w.rule, w.severity])).toEqual([['authority-change', 'danger']]);
  });

  it('wrapped SOL closed to an attacker (scenario G)', async () => {
    const WSOL = address('So11111111111111111111111111111111111111112');
    const reader = chain();
    reader.setAccount({ address: ATTACKER, owner: SYS, lamports: SOL, data: new Uint8Array() });
    reader.setAccount({ address: MY_USDC, owner: address(TOKEN_PROGRAM), lamports: 50n * SOL + 2_039_280n, data: tokenAccountData(ME, WSOL, 50n * SOL) });
    simulateWith(reader, { [ATTACKER]: { lamports: 51n * SOL + 2_039_280n }, [MY_USDC]: { lamports: 0n, data: new Uint8Array(), owner: SYS } });
    const v = await basic(reader, [getCloseAccountInstruction({ account: MY_USDC, destination: ATTACKER, owner: me })]);
    expect(v.summary).toBe(`Close Your wSOL token account and send its 50.00203928 SOL (50 wrapped) to ${A}`);
    const danger = v.warnings.find((w) => w.severity === 'danger')!;
    expect(danger).toMatchObject({ rule: 'close-to-third-party', message: 'Closes a wrapped SOL account and sends its 50.00203928 SOL to an address you do not own.' });
    expect(v.warnings.map((w) => w.rule)).toContain('send-entire-balance');
  });

  it('CPI drainer setting a delegate', async () => {
    const reader = chain();
    simulateWith(reader, { [MY_USDC]: { data: tokenAccountData(ME, USDC, 100_000_000n, { delegate: ATTACKER, delegatedAmount: 100_000_000n }) } });
    const v = await basic(reader, [{
      programAddress: DRAINER, data: new Uint8Array([7]),
      accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }, { address: MY_USDC, role: AccountRole.WRITABLE }, { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY }],
    }]);
    expect(v.summary).toBe(`Interact with ${shortAddress(DRAINER)} -- lets a delegate spend ALL of the tokens in your token account`);
  });

  it('absurd priority fee', async () => {
    const reader = chain();
    const fee = 8_400_005_000n;
    simulateWith(reader, { [ME]: { lamports: 10n * SOL - SOL / 1000n }, [OTHER]: { lamports: SOL / 1000n, owner: SYS } }, { fee });
    const v = await basic(reader, [
      getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 6_000_000_000n }),
      getTransferSolInstruction({ source: me, destination: OTHER, amount: SOL / 1000n }),
    ]);
    expect(v.summary).toBe('Send 8.391 SOL -- pays a priority fee of 8.4 SOL');
    expect(v.fee).toBe('8.400005 SOL');
  });

  it('sweep of SOL and USDC', async () => {
    const reader = chain();
    reader.setAccount({ address: ATTACKER_USDC, owner: address(TOKEN_PROGRAM), data: tokenAccountData(ATTACKER, USDC, 0n) });
    simulateWith(reader, {
      [ME]: { lamports: 8n * SOL },
      [ATTACKER]: { lamports: 2n * SOL, owner: SYS },
      [MY_USDC]: { data: tokenAccountData(ME, USDC, 0n) },
      [ATTACKER_USDC]: { data: tokenAccountData(ATTACKER, USDC, 100_000_000n) },
    });
    const v = await basic(reader, [
      getTransferSolInstruction({ source: me, destination: ATTACKER, amount: 2n * SOL }),
      getTransferCheckedInstruction({ source: MY_USDC, mint: USDC, destination: ATTACKER_USDC, authority: me, amount: 100_000_000n, decimals: 6 }),
    ]);
    expect(v.summary).toBe(`Send 2 SOL, 100 USDC to ${A} -- moves several of your assets to ${A} without giving you comparable value back`);
  });
});
