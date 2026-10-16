import { MemoryChainReader } from '@clef/rpc';
import { findAssociatedTokenPda, getMintEncoder } from '@solana-program/token';
import { address, none, some, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache } from '../src/accounts';
import { externalRelations } from '../src/external';
import { ATA_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/registry';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

const T = address(TOKEN_PROGRAM);
const T22 = address(TOKEN_2022_PROGRAM);
const SYSTEM = address('11111111111111111111111111111111');
const PROG = address('Stake11111111111111111111111111111111111111');
const AUTH = address('SysvarRent111111111111111111111111111111111');
const FREEZE = address('SysvarC1ock11111111111111111111111111111111');
const RANDOM = address('Vote111111111111111111111111111111111111111');

const mintData = (mintAuthority: Address | null, freezeAuthority: Address | null) =>
  new Uint8Array(
    getMintEncoder().encode({
      mintAuthority: mintAuthority ? some(mintAuthority) : none(), supply: 1n, decimals: 6, isInitialized: true,
      freezeAuthority: freezeAuthority ? some(freezeAuthority) : none(),
    }),
  );

async function run(keys: Address[], setup: (r: MemoryChainReader) => void, load: Address[] = keys) {
  const reader = new MemoryChainReader();
  setup(reader);
  const cache = new AccountCache(reader);
  await cache.load(load);
  return externalRelations(keys, cache);
}

const edge = (kind: string, from: Address, to: Address, label: string) =>
  ({ kind, from, to, label, status: 'verified', external: true });

describe('externalRelations', () => {
  it('emits program-owner for a plain account', async () => {
    const edges = await run([ME], (r) => r.setAccount({ address: ME, owner: SYSTEM, data: new Uint8Array() }));
    expect(edges).toEqual([edge('program-owner', ME, SYSTEM, 'program')]);
  });

  it('emits ata-derivation, delegate and close-authority for a token account in key order', async () => {
    const [ata] = await findAssociatedTokenPda({ owner: ME, mint: USDC, tokenProgram: T });
    const edges = await run([ata], (r) =>
      r.setAccount({ address: ata, owner: T, data: tokenAccountData(ME, USDC, 5n, { delegate: OTHER, delegatedAmount: 1n, closeAuthority: AUTH }) }),
    );
    expect(edges).toEqual([
      edge('program-owner', ata, T, 'program'),
      edge('ata-derivation', ata, address(ATA_PROGRAM), 'derived by'),
      edge('delegate', ata, OTHER, 'delegate'),
      edge('close-authority', ata, AUTH, 'close authority'),
    ]);
  });

  it('does not emit ata-derivation for a non-ATA token account', async () => {
    const edges = await run([RANDOM], (r) => r.setAccount({ address: RANDOM, owner: T, data: tokenAccountData(ME, USDC) }));
    expect(edges.map((e) => e.kind)).toEqual(['program-owner']);
  });

  it('emits mint-authority and freeze-authority for a mint', async () => {
    const edges = await run([USDC], (r) => r.setAccount({ address: USDC, owner: T, data: mintData(AUTH, FREEZE) }));
    expect(edges).toEqual([
      edge('program-owner', USDC, T, 'program'),
      edge('mint-authority', USDC, AUTH, 'mint authority'),
      edge('freeze-authority', USDC, FREEZE, 'freeze authority'),
    ]);
  });

  it('omits None authorities', async () => {
    const edges = await run([USDC], (r) => r.setAccount({ address: USDC, owner: T, data: mintData(null, null) }));
    expect(edges.map((e) => e.kind)).toEqual(['program-owner']);
  });

  it('decodes a Token-2022 extended mint', async () => {
    const data = new Uint8Array(170);
    data.set(mintData(AUTH, null));
    data[165] = 1;
    const edges = await run([USDC], (r) => r.setAccount({ address: USDC, owner: T22, data }));
    expect(edges).toEqual([
      edge('program-owner', USDC, T22, 'program'),
      edge('mint-authority', USDC, AUTH, 'mint authority'),
    ]);
  });

  it('omits targets that are among the keys', async () => {
    const [ata] = await findAssociatedTokenPda({ owner: ME, mint: USDC, tokenProgram: T });
    const keys = [ata, T, address(ATA_PROGRAM), OTHER, USDC, AUTH];
    const edges = await run(keys, (r) => {
      r.setAccount({ address: ata, owner: T, data: tokenAccountData(ME, USDC, 5n, { delegate: OTHER, delegatedAmount: 1n }) });
      r.setAccount({ address: USDC, owner: T, data: mintData(AUTH, FREEZE) });
    });
    expect(edges).toEqual([edge('freeze-authority', USDC, FREEZE, 'freeze authority')]);
  });

  it('skips missing and unloaded accounts and dedupes repeated keys', async () => {
    const edges = await run(
      [ME, OTHER, ME, RANDOM],
      (r) => {
        r.setAccount({ address: ME, owner: SYSTEM, data: new Uint8Array() });
        r.setAccount({ address: RANDOM, owner: PROG, data: new Uint8Array() });
      },
      [ME, OTHER], // RANDOM never loaded, OTHER missing
    );
    expect(edges).toEqual([edge('program-owner', ME, SYSTEM, 'program')]);
  });

  it('does not throw on malformed token data', async () => {
    const data = tokenAccountData(ME, USDC);
    const edges = await run([RANDOM], (r) => r.setAccount({ address: RANDOM, owner: T, data: data.subarray(0, 100) }));
    expect(edges.map((e) => e.kind)).toEqual(['program-owner']);
  });
});
