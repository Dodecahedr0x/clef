import { createBundledSource, IdlResolver, StaticIdlSource, UserIdlSource } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { getApproveInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  ATA_PROGRAM,
  decodeTransaction,
  identifyInstruction,
  sanitizeText,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  type AccountRef,
  type Issue,
} from '../src';
import { buildWire, ME, OTHER, USDC } from './helpers';

const bundled = () => new IdlResolver([createBundledSource()]);
const accounts = (n: number): AccountRef[] =>
  Array.from({ length: n }, (_, i) => ({ address: [ME, OTHER, USDC][i % 3]!, signer: i === 0, writable: i < 2 }));
const UNKNOWN = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

/** A minimal Codama root with one instruction for `publicKey`. */
const root = (publicKey: Address, programName: string, instruction: object) =>
  JSON.stringify({
    kind: 'rootNode',
    standard: 'codama',
    version: '1.0.0',
    program: {
      kind: 'programNode',
      name: programName,
      publicKey,
      version: '0.0.0',
      accounts: [],
      instructions: [{ kind: 'instructionNode', optionalAccountStrategy: 'programId', accounts: [], arguments: [], ...instruction }],
      definedTypes: [],
      pdas: [],
      errors: [],
    },
    additionalPrograms: [],
  });

describe('identifyInstruction', () => {
  it('names the instruction, its args and accounts from the IDL', async () => {
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 5n })]);
    const tx = await decodeTransaction(wire, new MemoryChainReader());
    const issues: Issue[] = [];
    const out = await identifyInstruction(tx.instructions[0]!, bundled(), issues);
    expect(out).toMatchObject({
      name: 'transferSol',
      programName: 'system',
      args: { amount: 5n },
      idl: { source: 'bundled', trust: 'curated' },
    });
    expect(out.accounts.map((a) => a.name)).toEqual(['source', 'destination']);
    expect(issues).toEqual([]);
  });

  it('names extra accounts remainingN', async () => {
    const ix = getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 5n });
    const extra = { ...ix, accounts: [...ix.accounts, { address: USDC, role: AccountRole.READONLY }] };
    const tx = await decodeTransaction(buildWire([extra]), new MemoryChainReader());
    const out = await identifyInstruction(tx.instructions[0]!, bundled(), []);
    expect(out.accounts.map((a) => a.name)).toEqual(['source', 'destination', 'remaining0']);
  });

  it('falls back to a raw instruction when no IDL decodes it', async () => {
    const ix = { index: 0, programId: UNKNOWN, accounts: [], data: new Uint8Array([1, 2, 3]) };
    const issues: Issue[] = [];
    const out = await identifyInstruction(ix, new IdlResolver([new UserIdlSource()]), issues);
    expect(out.name).toBeUndefined();
    expect(out.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(issues).toEqual([]);
  });

  it('reports when an IDL exists but no instruction in it matches', async () => {
    const ix = { index: 2, programId: address(SYSTEM_PROGRAM), accounts: [], data: new Uint8Array([250, 0, 0, 0]) };
    const issues: Issue[] = [];
    const out = await identifyInstruction(ix, bundled(), issues);
    expect(out.name).toBeUndefined();
    expect(issues).toEqual([{ stage: 'parse', instructionIndex: 2, message: 'no instruction in bundled IDL matched' }]);
  });

  it('falls through to the next candidate when one fails to decode', async () => {
    const user = new UserIdlSource();
    // A field discriminator naming a missing field makes Codama throw while identifying.
    user.set(
      UNKNOWN,
      root(UNKNOWN, 'broken', {
        name: 'boom',
        discriminators: [{ kind: 'fieldDiscriminatorNode', name: 'missing', offset: 0 }],
      }),
    );
    const good = new StaticIdlSource('program-metadata', 'authority', new Map([[UNKNOWN, root(UNKNOWN, 'good', { name: 'anything' })]]));
    const issues: Issue[] = [];
    const ix = { index: 0, programId: UNKNOWN, accounts: [], data: new Uint8Array([1]) };
    const out = await identifyInstruction(ix, new IdlResolver([user, good]), issues);
    expect(out).toMatchObject({ name: 'anything', idl: { source: 'program-metadata' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stage: 'parse', instructionIndex: 0 });
    expect(issues[0]!.message).toMatch(/^user IDL failed to decode: /);
  });

  it('ignores non-curated IDLs for programs Clef bundles a curated IDL for', async () => {
    const user = new UserIdlSource();
    // Token discriminator 4 is approve: a user IDL must not rename it.
    user.set(address(TOKEN_PROGRAM), JSON.stringify({
      address: TOKEN_PROGRAM, metadata: { name: 'token', version: '0.1.0', spec: '0.1.0' },
      instructions: [{ name: 'harmless', discriminator: [4], accounts: [{ name: 'a', writable: true }, { name: 'b' }, { name: 'c', signer: true }], args: [{ name: 'x', type: 'u64' }] }],
    }));
    const wire = buildWire([getApproveInstruction({ source: OTHER, delegate: USDC, owner: createNoopSigner(ME), amount: 5n })]);
    const tx = await decodeTransaction(wire, new MemoryChainReader());
    const issues: Issue[] = [];
    const out = await identifyInstruction(tx.instructions[0]!, new IdlResolver([user, createBundledSource()]), issues);
    expect(out).toMatchObject({ name: 'approve', idl: { source: 'bundled', trust: 'curated' } });
    expect(issues).toEqual([{ stage: 'idl', instructionIndex: 0, message: 'user IDL ignored: Clef decodes this program with its curated IDL' }]);
    // Without the curated IDL, the instruction stays unnamed.
    expect((await identifyInstruction(tx.instructions[0]!, new IdlResolver([user]), [])).name).toBeUndefined();
  });

  it('identifies the legacy ATA create (empty data) with the same accounts as create', async () => {
    const ix = { index: 0, programId: address(ATA_PROGRAM), accounts: accounts(6), data: new Uint8Array() };
    const issues: Issue[] = [];
    const out = await identifyInstruction(ix, bundled(), issues);
    expect(out.name).toBe('createLegacy');
    expect(out.args).toEqual({});
    expect(out.accounts.map((a) => a.name)).toEqual([
      'funder',
      'associatedTokenAccount',
      'wallet',
      'mint',
      'systemProgram',
      'tokenProgram',
    ]);
    expect(issues).toEqual([]);
    const create = await identifyInstruction({ ...ix, data: new Uint8Array([0]) }, bundled(), []);
    expect(create.name).toBe('create');
  });

  describe('omitted optional accounts', () => {
    // Token-2022 confidentialWithdraw: token, mint, instructionsSysvar?, equalityRecord?, rangeRecord?, authority
    // with optionalAccountStrategy "omitted" -- the optional accounts sit before a required one.
    const data = new Uint8Array(49);
    data.set([27, 6]);
    const withdraw = (n: number) => ({ index: 1, programId: address(TOKEN_2022_PROGRAM), accounts: accounts(n), data });

    const ambiguousAfterMint = {
      stage: 'parse',
      instructionIndex: 1,
      message: 'optional accounts omitted; account names after mint are ambiguous',
    };

    // confidentialWithdraw also declares remaining (multisig signer) accounts, so even 6 accounts cannot be
    // told apart from "token, mint, multisig authority + 3 signers" -- the safe answer is "ambiguous".
    it('treats a full-length account list as ambiguous when remaining accounts are declared', async () => {
      const issues: Issue[] = [];
      const out = await identifyInstruction(withdraw(6), bundled(), issues);
      expect(out.name).toBe('confidentialWithdraw');
      expect(out.accounts.map((a) => a.name)).toEqual(['token', 'mint', undefined, undefined, undefined, undefined]);
      expect(issues).toEqual([ambiguousAfterMint]);
    });

    it('does not name a multisig authority and its signers as optional accounts', async () => {
      // token, mint, multisig authority, 3 signers -- all three optional accounts omitted.
      const multisig = { ...withdraw(6), accounts: accounts(6).map((a, i) => ({ ...a, signer: i >= 3, writable: i === 0 })) };
      const issues: Issue[] = [];
      const out = await identifyInstruction(multisig, bundled(), issues);
      expect(out.accounts.map((a) => a.name)).toEqual(['token', 'mint', undefined, undefined, undefined, undefined]);
      expect(issues).toEqual([ambiguousAfterMint]);
    });

    it('leaves names after the first optional account undefined when some are omitted', async () => {
      const issues: Issue[] = [];
      const out = await identifyInstruction(withdraw(4), bundled(), issues);
      expect(out.name).toBe('confidentialWithdraw');
      expect(out.accounts.map((a) => a.name)).toEqual(['token', 'mint', undefined, undefined]);
      expect(issues).toEqual([ambiguousAfterMint]);
    });

    it('reports missing required accounts and keeps the names that are certain', async () => {
      const issues: Issue[] = [];
      const out = await identifyInstruction(withdraw(2), bundled(), issues);
      expect(out.accounts.map((a) => a.name)).toEqual(['token', 'mint']);
      expect(issues).toEqual([
        { stage: 'parse', instructionIndex: 1, message: 'confidentialWithdraw expects at least 3 accounts, got 2' },
      ]);
    });
  });

  it('sanitizes names and string args from the IDL', async () => {
    const ESC = '\u001b';
    const RLO = '\u202e';
    const u8 = { kind: 'numberTypeNode', format: 'u8', endian: 'le' };
    const user = new UserIdlSource();
    user.set(
      UNKNOWN,
      root(UNKNOWN, `evil${ESC}[2J`, {
        name: `pay${RLO}gnp.exe`,
        accounts: [{ kind: 'instructionAccountNode', name: `vault${ESC}`, isWritable: false, isSigner: false }],
        arguments: [
          // Map args decode to plain objects whose keys come from the instruction data, not the IDL.
          {
            kind: 'instructionArgumentNode',
            name: 'tags',
            type: {
              kind: 'mapTypeNode',
              key: { kind: 'sizePrefixTypeNode', type: { kind: 'stringTypeNode', encoding: 'utf8' }, prefix: u8 },
              value: u8,
              count: { kind: 'fixedCountNode', value: 1 },
            },
          },
          { kind: 'instructionArgumentNode', name: `note${ESC}`, type: { kind: 'stringTypeNode', encoding: 'utf8' } },
        ],
      }),
    );
    const key = new TextEncoder().encode(`k${ESC}${RLO}ey`);
    const data = new Uint8Array([key.length, ...key, 7, ...new TextEncoder().encode(`hi${ESC}[31m${RLO}there`)]);
    const out = await identifyInstruction(
      { index: 0, programId: UNKNOWN, accounts: accounts(1), data },
      new IdlResolver([user]),
      [],
    );
    expect(out.name).toBe('paygnp.exe');
    expect(out.programName).toBe('evil[2J');
    expect(out.accounts[0]!.name).toBe('vault');
    expect(out.args).toEqual({ tags: { key: 7 }, note: 'hi[31mthere' });
  });
});

describe('sanitizeText', () => {
  it('strips control and bidi characters, then truncates', () => {
    expect(sanitizeText('a\u0000b\u007fc\u0085d\u202ae\u2066f\u2069g')).toBe('abcdefg');
    // zero-width characters and LRM/RLM, the Arabic letter mark, line/paragraph separators
    expect(sanitizeText('a\u200bb\u200cc\u200dd\u200ee\u200ff\u061cg\u2028h\u2029i')).toBe('abcdefghi');
    expect(sanitizeText('\u202d\u202e\u2067\u2068ok')).toBe('ok');
    expect(sanitizeText('x'.repeat(100))).toBe('x'.repeat(64));
    expect(sanitizeText('abcdef', 3)).toBe('abc');
  });

  it('strips every format/control character, Hangul fillers and variation selectors', () => {
    const hostile = [
      '\u00ad', // soft hyphen (Cf)
      '\u180e', // Mongolian vowel separator (Cf)
      '\ufeff', // BOM (Cf)
      '\u2060', // word joiner (Cf)
      '\u2063', // invisible separator (Cf)
      '\u{e0041}', // tag character (Cf)
      '\u115f', '\u1160', '\u3164', '\uffa0', // Hangul fillers
      '\ufe00', '\ufe0f', '\u{e0100}', '\u{e01ef}', // variation selectors
      '\ud800', // lone surrogate (Cs)
      '\u0085', '\u2028', '\u2029', // C1, Zl, Zp
    ];
    for (const c of hostile) expect(sanitizeText(`a${c}b`), `U+${c.codePointAt(0)!.toString(16)}`).toBe('ab');
    // Ordinary non-ASCII text survives.
    expect(sanitizeText('caf\u00e9 \u65e5\u672c \u20ac')).toBe('caf\u00e9 \u65e5\u672c \u20ac');
  });
});
