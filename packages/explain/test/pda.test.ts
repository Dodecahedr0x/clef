import { address, getAddressEncoder, getProgramDerivedAddress, getU64Encoder, getUtf8Encoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import type { Address } from '@solana/kit';
import { identifyInstruction, toHex, verifyCodamaPdas, type IdentifiedInstruction } from '../src';
import { anchorIdl, customIx, PROG } from './custom-idl';
import { ME, USDC } from './helpers';
import { OTHER, depositInstruction, vaultAddresses, vaultResolver } from './vault';

async function identified(overrides: Partial<Awaited<ReturnType<typeof vaultAddresses>>> = {}) {
  const accounts = { ...(await vaultAddresses()), ...overrides };
  const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
  return { accounts, ix };
}

async function edgesFor(overrides: Partial<Awaited<ReturnType<typeof vaultAddresses>>> = {}) {
  const { accounts, ix } = await identified(overrides);
  return { accounts, edges: await verifyCodamaPdas(ix) };
}

describe('verifyCodamaPdas', () => {
  it('verifies PDAs whose seeds Codama can express', async () => {
    const { accounts, edges } = await edgesFor();
    // userPosition uses a nested seed (pool.mint): handled by Anchor extras, not here.
    expect(edges.map((e) => [e.from, e.status])).toEqual([
      [accounts.pool, 'verified'],
      [accounts.poolVault, 'verified'],
    ]);
    expect(edges[0]!.seeds).toEqual([
      { kind: 'const', display: '"pool"' },
      { kind: 'account', display: 'mint' },
    ]);
    expect(edges[0]!.label).toBe('PDA("pool", mint)');
  });

  it('flags a substituted PDA as a mismatch', async () => {
    const { edges } = await edgesFor({ poolVault: OTHER });
    const vault = edges.find((e) => e.from === OTHER);
    expect(vault?.status).toBe('mismatch');
    expect(vault?.detail).toMatch(/^expected /);
  });

  it('skips accounts whose Anchor extras carry nested seeds', async () => {
    const { accounts, ix } = await identified();
    const idl = ix.resolvedIdl!;
    const withNested: IdentifiedInstruction = {
      ...ix,
      resolvedIdl: { ...idl, anchorExtras: { deposit: { pool: { relations: [], nestedSeeds: [] } } } },
    };
    const edges = await verifyCodamaPdas(withNested);
    expect(edges.map((e) => e.from)).toEqual([accounts.poolVault]);
  });

  it('never guesses unnamed accounts', async () => {
    const { accounts, ix } = await identified();
    const unnamed: IdentifiedInstruction = {
      ...ix,
      accounts: ix.accounts.map((a) => (a.name === 'mint' || a.name === 'poolVault' ? { ...a, name: undefined } : a)),
    };
    const edges = await verifyCodamaPdas(unnamed);
    // poolVault has no name: no edge. pool's seed account (mint) has no name: unverified.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: accounts.pool, status: 'unverified' });
  });
});

describe('verifyCodamaPdas argument seeds', () => {
  const json = anchorIdl(
    [{ name: 'p', pda: { seeds: [{ kind: 'arg', path: 'name' }, { kind: 'arg', path: 'id' }, { kind: 'arg', path: 'key' }] } }],
    [{ name: 'name', type: 'string' }, { name: 'id', type: 'u64' }, { name: 'key', type: 'pubkey' }],
  );
  const derive = async (name: string) =>
    (
      await getProgramDerivedAddress({
        programAddress: PROG,
        seeds: [getUtf8Encoder().encode(name), getU64Encoder().encode(7n), getAddressEncoder().encode(ME)],
      })
    )[0];

  it('verifies string, u64 and pubkey argument seeds', async () => {
    const ix = await customIx(json, [await derive('hello')], { name: 'hello', id: 7n, key: ME });
    const edges = await verifyCodamaPdas(ix);
    expect(edges.map((e) => [e.label, e.status])).toEqual([['PDA(name, id, key)', 'verified']]);
  });

  it('derives from the raw argument, not the display-sanitized one', async () => {
    const name = 'he\u200bllo';
    const ix = await customIx(json, [await derive(name)], { name, id: 7n, key: ME });
    expect(ix.args?.name).toBe('hello');
    const edges = await verifyCodamaPdas(ix);
    expect(edges.map((e) => e.status)).toEqual(['verified']);
  });
});

describe('verifyCodamaPdas absent optional accounts', () => {
  it('skips an optional PDA passed as the program id (absent)', async () => {
    const json = anchorIdl([
      { name: 'mint' },
      { name: 'opt', optional: true, pda: { seeds: [{ kind: 'const', value: [120] }, { kind: 'account', path: 'mint' }] } },
    ]);
    const ix = await customIx(json, [ME, PROG]);
    expect(await verifyCodamaPdas(ix)).toEqual([]);
  });

  it('leaves a PDA unverified when an optional seed account is absent', async () => {
    const json = anchorIdl([
      { name: 'mint', optional: true },
      { name: 'p', pda: { seeds: [{ kind: 'const', value: [120] }, { kind: 'account', path: 'mint' }] } },
    ]);
    const ix = await customIx(json, [PROG, OTHER]);
    const edges = await verifyCodamaPdas(ix);
    expect(edges).toEqual([expect.objectContaining({ from: OTHER, status: 'unverified', detail: 'mint not provided' })]);
  });
});

describe('verifyCodamaPdas deriving program from the instruction', () => {
  const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const xUnder = async (programAddress: Address) => (await getProgramDerivedAddress({ programAddress, seeds: ['x'] }))[0];
  const argProgram = anchorIdl(
    [{ name: 'p', pda: { seeds: [{ kind: 'const', value: [120] }], program: { kind: 'arg', path: 'prog' } } }],
    [{ name: 'prog', type: 'pubkey' }],
  );

  it('uses a program id argument, verified only for known programs', async () => {
    const known = await verifyCodamaPdas(await customIx(argProgram, [await xUnder(TOKEN)], { prog: TOKEN }));
    expect(known).toEqual([expect.objectContaining({ status: 'verified', to: TOKEN })]);
    const unknown = await verifyCodamaPdas(await customIx(argProgram, [await xUnder(OTHER)], { prog: OTHER }));
    expect(unknown).toEqual([expect.objectContaining({ status: 'unverified', detail: `derived under ${OTHER}`, to: OTHER })]);
  });

  it('keeps a mismatch under an untrusted program', async () => {
    const edges = await verifyCodamaPdas(await customIx(argProgram, [ME], { prog: OTHER }));
    expect(edges).toEqual([expect.objectContaining({ status: 'mismatch' })]);
  });

  it('trusts a program account pinned to a fixed address by the IDL', async () => {
    const accounts = (pinned: boolean) => [
      { name: 'prog', ...(pinned && { address: USDC }) },
      { name: 'p', pda: { seeds: [{ kind: 'const', value: [120] }], program: { kind: 'account', path: 'prog' } } },
    ];
    const target = await xUnder(USDC);
    const pinned = await verifyCodamaPdas(await customIx(anchorIdl(accounts(true)), [USDC, target]));
    expect(pinned).toEqual([expect.objectContaining({ from: target, status: 'verified', to: USDC })]);
    const free = await verifyCodamaPdas(await customIx(anchorIdl(accounts(false)), [USDC, target]));
    expect(free).toEqual([expect.objectContaining({ from: target, status: 'unverified', detail: `derived under ${USDC}` })]);
  });
});

describe('verifyCodamaPdas error isolation', () => {
  it('turns a failing derivation into unverified and still reports other accounts', async () => {
    const json = anchorIdl(
      [
        { name: 'p', pda: { seeds: [{ kind: 'arg', path: 'name' }] } },
        { name: 'q', pda: { seeds: [{ kind: 'const', value: [113] }] } },
      ],
      [{ name: 'name', type: 'string' }],
    );
    const [p] = await getProgramDerivedAddress({ programAddress: PROG, seeds: ['short'] });
    // 40-byte seed: over the 32-byte limit, so deriving throws.
    const ix = await customIx(json, [p, OTHER], { name: 'x'.repeat(40) });
    const edges = await verifyCodamaPdas(ix);
    expect(edges.map((e) => [e.from, e.status])).toEqual([
      [p, 'unverified'],
      [OTHER, 'mismatch'],
    ]);
    expect(edges[0]!.detail).toMatch(/exceeds the maximum length/);
  });
});

describe('toHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});
