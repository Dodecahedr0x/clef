import { IdlResolver } from '@clef/idl';
import { MemoryChainReader, type RawAccount } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache, Labeler, SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../src';
import { byteChanges, computeAccountDiffs, groupDigits, type DiffDeps } from '../src/diffs';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';
import { AUTHORITY, VAULT, setPool, vaultAddresses, vaultResolver } from './vault';

const TOKEN_ACCT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const UNKNOWN_PROGRAM = address('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const POOL_ACCT = address('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');

const sys = (a: Address, lamports: bigint): RawAccount => ({ address: a, owner: SYSTEM_PROGRAM as Address, lamports, data: new Uint8Array(), executable: false });
const token = (a: Address, data: Uint8Array, lamports = 2_039_280n): RawAccount => ({ address: a, owner: TOKEN_PROGRAM as Address, lamports, data, executable: false });

function deps(over: Partial<DiffDeps> = {}): DiffDeps {
  const reader = new MemoryChainReader();
  return {
    idls: new IdlResolver([]),
    labeler: new Labeler([ME], new AccountCache(reader), { [ME]: 'Main' }),
    me: [ME],
    addressBook: { [ME]: 'Main' },
    ...over,
  };
}

describe('groupDigits / byteChanges', () => {
  it('groups digits with underscores', () => {
    expect(groupDigits(312_400_000n)).toBe('312_400_000');
    expect(groupDigits(0n)).toBe('0');
    expect(groupDigits(-1234n)).toBe('-1_234');
    expect(groupDigits(999n)).toBe('999');
  });

  it('groups contiguous changed bytes into runs of at most 16', () => {
    const before = new Uint8Array(64);
    const after = new Uint8Array(64);
    after[2] = 0xab;
    after[3] = 0x01;
    for (let i = 20; i < 40; i++) after[i] = 0xff;
    const changes = byteChanges(before, after);
    expect(changes).toEqual([
      { offset: 2, before: '00 00', after: 'ab 01' },
      { offset: 20, before: Array(16).fill('00').join(' '), after: Array(16).fill('ff').join(' ') },
      { offset: 36, before: '00 00 00 00', after: 'ff ff ff ff' },
    ]);
  });

  it('treats bytes past the shorter side as changed', () => {
    expect(byteChanges(new Uint8Array([1]), new Uint8Array([1, 2, 3]))).toEqual([{ offset: 1, before: '', after: '02 03' }]);
  });
});

describe('computeAccountDiffs', () => {
  it('omits unchanged accounts', async () => {
    const a = sys(ME, 10n);
    expect(await computeAccountDiffs([{ address: ME, pre: a, post: { ...a } }, { address: OTHER, pre: null, post: null }], deps())).toEqual([]);
  });

  it('diffs a system account: lamports, titled with the address book label', async () => {
    const [d] = await computeAccountDiffs([{ address: ME, pre: sys(ME, 6_210_400_000n), post: sys(ME, 4_710_285_000n) }], deps());
    expect(d).toMatchObject({
      address: ME, title: 'You · Main', mine: true, lifecycle: 'modified',
      owner: { before: SYSTEM_PROGRAM, after: SYSTEM_PROGRAM },
      lamports: { before: 6_210_400_000n, after: 4_710_285_000n },
      decoded: { by: 'system', type: 'System account', changed: [], context: [] },
      raw: null,
    });
  });

  it('titles an own wallet without a label as Your wallet', async () => {
    const [d] = await computeAccountDiffs([{ address: ME, pre: sys(ME, 2n), post: sys(ME, 1n) }], deps({ addressBook: {} }));
    expect(d!.title).toBe('Your wallet');
  });

  it('diffs a token account amount with a human note', async () => {
    const pre = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 312_400_000n));
    const post = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 524_800_000n));
    const [d] = await computeAccountDiffs([{ address: TOKEN_ACCT, pre, post }], deps());
    expect(d).toMatchObject({ title: 'Your USDC account', mine: true, lifecycle: 'modified' });
    expect(d!.decoded).toEqual({
      by: 'token', type: 'Token account',
      changed: [{ path: 'amount', before: '312_400_000', after: '524_800_000', note: '312.4 USDC → 524.8 USDC' }],
      context: [{ path: 'mint', before: USDC, after: USDC, note: 'USDC' }],
    });
  });

  it('diffs token owner and delegate changes', async () => {
    const pre = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 5n));
    const post = token(TOKEN_ACCT, tokenAccountData(OTHER, USDC, 5n, { delegate: AUTHORITY, delegatedAmount: 5n }));
    const [d] = await computeAccountDiffs([{ address: TOKEN_ACCT, pre, post }], deps());
    const changed = d!.decoded!.changed;
    expect(changed.find((c) => c.path === 'owner')).toMatchObject({ before: ME, after: OTHER, note: 'you → 7xKX…gAsU' });
    expect(changed.find((c) => c.path === 'delegate')).toMatchObject({ before: null, after: AUTHORITY });
    expect(changed.find((c) => c.path === 'delegatedAmount')).toMatchObject({ before: '0', after: '5' });
  });

  it('marks a created token account with every field as added', async () => {
    const post = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 1_500_000n));
    const [d] = await computeAccountDiffs([{ address: TOKEN_ACCT, pre: null, post }], deps());
    expect(d).toMatchObject({ lifecycle: 'created', mine: true, title: 'Your USDC account', owner: { before: null, after: TOKEN_PROGRAM }, lamports: { before: 0n, after: 2_039_280n } });
    expect(d!.decoded!.changed.map((c) => [c.path, c.before, c.after])).toEqual([
      ['owner', null, ME],
      ['mint', null, USDC],
      ['amount', null, '1_500_000'],
    ]);
  });

  it('marks a closed token account with every field as removed', async () => {
    const pre = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 0n));
    const [d] = await computeAccountDiffs([{ address: TOKEN_ACCT, pre, post: null }], deps());
    expect(d).toMatchObject({ lifecycle: 'closed', owner: { before: TOKEN_PROGRAM, after: null }, lamports: { before: 2_039_280n, after: 0n } });
    expect(d!.decoded!.changed.map((c) => [c.path, c.before, c.after])).toEqual([
      ['owner', ME, null],
      ['mint', USDC, null],
      ['amount', '0', null],
    ]);
  });

  it('treats a zero-lamport, empty system-owned post state as closed', async () => {
    const pre = token(TOKEN_ACCT, tokenAccountData(ME, USDC, 0n));
    const [d] = await computeAccountDiffs([{ address: TOKEN_ACCT, pre, post: sys(TOKEN_ACCT, 0n) }], deps());
    expect(d!.lifecycle).toBe('closed');
  });

  it('decodes a program account with its IDL', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: USDC, authority: AUTHORITY });
    const pre = reader.accounts.get(accounts.pool)!;
    await setPool(reader, accounts.pool, { mint: USDC, authority: OTHER });
    const post = reader.accounts.get(accounts.pool)!;
    const [d] = await computeAccountDiffs([{ address: accounts.pool, pre, post }], deps({ idls: vaultResolver() }));
    expect(d!.raw).toBeNull();
    expect(d!.decoded).toEqual({
      by: 'idl', type: 'Pool',
      changed: [{ path: 'authority', before: AUTHORITY, after: OTHER }],
      context: [{ path: 'mint', before: USDC, after: USDC }, { path: 'bump', before: '255', after: '255' }],
    });
    expect(d!.owner.after).toBe(VAULT);
  });

  it('shows undecoded data as byte ranges with the owner program reason', async () => {
    const before = new Uint8Array(0x200);
    const after = new Uint8Array(0x200);
    after[0xc1] = 0xa4;
    after[0xc2] = 0x3f;
    after[0x1a8] = 0x12;
    const pre: RawAccount = { address: POOL_ACCT, owner: UNKNOWN_PROGRAM, lamports: 5n, data: before, executable: false };
    const post: RawAccount = { ...pre, data: after };
    const [d] = await computeAccountDiffs([{ address: POOL_ACCT, pre, post }], deps());
    expect(d!.decoded).toBeNull();
    expect(d!.undecodedReason).toBe('no IDL for owner program 675k…1Mp8');
    expect(d!.title).toBe('Czfq…44zE');
    expect(d!.raw).toEqual({
      size: { before: 0x200, after: 0x200 },
      changedBytes: 3,
      changes: [
        { offset: 0xc1, before: '00 00', after: 'a4 3f' },
        { offset: 0x1a8, before: '00', after: '12' },
      ],
    });
  });

  it('says the IDL did not decode when one exists but fails', async () => {
    const pre: RawAccount = { address: POOL_ACCT, owner: VAULT, lamports: 5n, data: new Uint8Array(8), executable: false };
    const post: RawAccount = { ...pre, data: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]) };
    const [d] = await computeAccountDiffs([{ address: POOL_ACCT, pre, post }], deps({ idls: vaultResolver() }));
    expect(d!.decoded).toBeNull();
    expect(d!.undecodedReason).toMatch(/^IDL for Fg6P…sLnS did not decode this account/);
  });

  it('has no raw diff when only lamports changed on an undecoded account', async () => {
    const pre: RawAccount = { address: POOL_ACCT, owner: UNKNOWN_PROGRAM, lamports: 5n, data: new Uint8Array(4), executable: false };
    const [d] = await computeAccountDiffs([{ address: POOL_ACCT, pre, post: { ...pre, lamports: 6n } }], deps());
    expect(d).toMatchObject({ decoded: null, raw: null, lamports: { before: 5n, after: 6n } });
  });
});
