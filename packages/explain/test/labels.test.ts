import { MemoryChainReader } from '@clef/rpc';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address, getProgramDerivedAddress, type Address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountCache, ATA_PROGRAM, Labeler, shortAddress, tokenRelations, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

describe('token relations and labels', () => {
  let myAta: Address;
  let cache: AccountCache;
  beforeAll(async () => {
    [myAta] = await findAssociatedTokenPda({ owner: ME, mint: USDC, tokenProgram: address(TOKEN_PROGRAM) });
    const reader = new MemoryChainReader();
    reader.setAccount({ address: myAta, owner: address(TOKEN_PROGRAM), data: tokenAccountData(ME, USDC) });
    cache = new AccountCache(reader);
    await cache.load([myAta, ME, OTHER, USDC]);
  });

  it('derives owner, mint and ATA facts from on-chain token accounts', async () => {
    const edges = await tokenRelations([myAta, ME], cache);
    expect(edges.map((e) => [e.kind, e.from, e.to, e.status])).toEqual([
      ['token-owner', myAta, ME, 'verified'],
      ['token-mint', myAta, USDC, 'verified'],
      ['ata', myAta, ME, 'verified'],
    ]);
  });

  it('gives an ATA its seeds (owner, token program, mint) and deriving program, which derive it again', async () => {
    const ata = (await tokenRelations([myAta], cache)).find((e) => e.kind === 'ata')!;
    expect(ata.derivedBy).toBe(ATA_PROGRAM);
    expect(ata.seeds?.map((s) => [s.kind, s.display, s.type?.kind])).toEqual([
      ['account', 'owner', 'pubkey'],
      ['account', 'token program', 'pubkey'],
      ['account', 'mint', 'pubkey'],
    ]);
    const bytes = ata.seeds!.map((s) => Uint8Array.from(s.hex!.match(/../g)!, (h) => parseInt(h, 16)));
    const [again, bump] = await getProgramDerivedAddress({ programAddress: address(ATA_PROGRAM), seeds: bytes });
    expect(again).toBe(myAta);
    expect(ata.bump).toBe(bump);
  });

  it('labels wallets, token accounts, mints and programs', () => {
    const labeler = new Labeler([ME], cache, { [OTHER]: 'Alice' });
    expect(labeler.label(ME)).toBe('Your wallet');
    expect(labeler.label(OTHER)).toBe('Alice');
    expect(labeler.label(myAta)).toBe('Your USDC token account');
    expect(labeler.label(USDC)).toBe('USDC mint');
    expect(labeler.label(address(TOKEN_PROGRAM))).toBe('Token Program');
    expect(labeler.isMine(myAta)).toBe(true);
    expect(labeler.mintInfo(USDC)).toEqual({ symbol: 'USDC', decimals: 6 });
  });

  it('prefers token owners known from the transaction (meta) over the current on-chain owner', () => {
    // The account changed hands since the transaction: at the time, OTHER held it.
    const asOfTx = new Labeler([ME], cache, { [OTHER]: 'Alice' }, { [myAta]: OTHER });
    expect(asOfTx.isMine(myAta)).toBe(false);
    expect(asOfTx.label(myAta)).toBe("Alice's USDC token account");
    const mineThen = new Labeler([OTHER], cache, {}, { [myAta]: OTHER });
    expect(mineThen.isMine(myAta)).toBe(true);
    expect(mineThen.label(myAta)).toBe('Your USDC token account');
  });

  it('names programs registry first, then from the address book', () => {
    const PUMP = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    const ROUTER = address('6VoCNEmYFdMQ5kK8RkzcH9NoBhNQf3xVWzggf3bduTAB');
    const labeler = new Labeler([ME], cache, { [TOKEN_PROGRAM]: 'Evil', [PUMP]: 'Evil too', [ROUTER]: 'Router' });
    expect(labeler.label(address(TOKEN_PROGRAM))).toBe('Token Program');
    expect(labeler.label(PUMP)).toBe('pump.fun');
    expect(labeler.label(ROUTER)).toBe('Router');
  });

  it('labels Token-2022 and foreign token accounts from on-chain data only', async () => {
    const mint = address('So11111111111111111111111111111111111111112');
    const fakeMint = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
    const [otherAta] = await findAssociatedTokenPda({ owner: OTHER, mint, tokenProgram: address(TOKEN_2022_PROGRAM) });
    const [notAta] = await findAssociatedTokenPda({ owner: ME, mint: fakeMint, tokenProgram: address(TOKEN_PROGRAM) });
    const reader = new MemoryChainReader();
    reader.setAccount({ address: otherAta, owner: address(TOKEN_2022_PROGRAM), data: tokenAccountData(OTHER, mint) });
    // Lives at ME's legacy-Token ATA address but is OTHER's Token-2022 account: not OTHER's ATA, and not mine.
    reader.setAccount({ address: notAta, owner: address(TOKEN_2022_PROGRAM), data: tokenAccountData(OTHER, fakeMint) });
    const local = new AccountCache(reader);
    await local.load([otherAta, notAta, fakeMint]);

    const edges = await tokenRelations([otherAta, notAta], local);
    expect(edges.map((e) => [e.kind, e.from, e.to])).toEqual([
      ['token-owner', otherAta, OTHER],
      ['token-mint', otherAta, mint],
      ['ata', otherAta, OTHER],
      ['token-owner', notAta, OTHER],
      ['token-mint', notAta, fakeMint],
    ]);

    const labeler = new Labeler([ME], local);
    expect(labeler.label(otherAta)).toBe(`${shortAddress(OTHER)}'s wSOL token account`);
    expect(labeler.label(notAta)).toBe(`${shortAddress(OTHER)}'s ${shortAddress(fakeMint)} token account`);
    expect(labeler.isMine(notAta)).toBe(false);
    expect(labeler.mintInfo(fakeMint)).toBeNull();
    expect(labeler.label(fakeMint)).toBeUndefined();
  });
});
