import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { describe, expect, it } from 'vitest';
import { extractAnchorExtras } from '../src/anchor-extras';
import vault from './fixtures/vault-anchor.json' with { type: 'json' };

describe('extractAnchorExtras', () => {
  it('keeps relations and nested-path PDA seeds, camelCased like Codama', () => {
    expect(extractAnchorExtras(vault)).toEqual({
      deposit: {
        mint: { relations: [{ holder: 'pool', field: 'mint' }] },
        authority: { relations: [{ holder: 'pool', field: 'authority' }] },
        userPosition: {
          relations: [],
          nestedSeeds: [
            { kind: 'const', bytes: [112, 111, 115] },
            { kind: 'account', path: ['pool', 'mint'] },
            { kind: 'account', path: ['user'] },
          ],
        },
      },
    });
  });

  it('returns nothing for legacy (pre-0.30) IDLs', () => {
    expect(extractAnchorExtras({ version: '0.1.0', name: 'x', instructions: [] })).toEqual({});
  });

  it('records seedProgram when only the pda.program path is nested', () => {
    const idl = {
      address: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      metadata: { name: 'x', version: '0.1.0', spec: '0.1.0' },
      instructions: [
        {
          name: 'run',
          discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
          accounts: [
            { name: 'pool' },
            {
              name: 'thing',
              pda: {
                seeds: [{ kind: 'const', value: [1] }, { kind: 'account', path: 'pool' }],
                program: { kind: 'account', path: 'pool.mint' },
              },
            },
          ],
          args: [],
        },
      ],
    };
    expect(extractAnchorExtras(idl)).toEqual({
      run: {
        thing: {
          relations: [],
          nestedSeeds: [
            { kind: 'const', bytes: [1] },
            { kind: 'account', path: ['pool'] },
          ],
          seedProgram: { kind: 'account', path: ['pool', 'mint'] },
        },
      },
    });
  });

  it('prefixes duplicate names inside composite accounts exactly like Codama', () => {
    const idl = {
      address: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      metadata: { name: 'x', version: '0.1.0', spec: '0.1.0' },
      instructions: [
        {
          name: 'swap',
          discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
          accounts: [
            { name: 'user', signer: true },
            { name: 'pool', relations: ['pool_authority'] },
            { name: 'pool_authority' },
            {
              name: 'source_side',
              accounts: [
                { name: 'pool', pda: { seeds: [{ kind: 'const', value: [1] }, { kind: 'account', path: 'mint' }] } },
                { name: 'mint', relations: ['pool'] },
                {
                  name: 'position',
                  pda: {
                    seeds: [
                      { kind: 'account', path: 'pool.mint' },
                      { kind: 'arg', path: 'amount' },
                    ],
                  },
                },
              ],
            },
          ],
          args: [{ name: 'amount', type: 'u64' }],
        },
      ],
    };
    const codama = rootNodeFromAnchor(idl as unknown as AnchorIdl).program.instructions?.[0];
    const codamaNames = codama?.accounts?.map((a) => a.name);
    expect(codamaNames).toEqual(['user', 'pool', 'poolAuthority', 'sourceSidePool', 'sourceSideMint', 'sourceSidePosition']);
    // Codama's own seed for sourceSidePool points at the prefixed sibling: same rule as ours.
    expect(codama?.accounts?.[3]?.defaultValue).toMatchObject({
      seeds: [{ name: 'sourceSideMint', value: { kind: 'accountValueNode', name: 'sourceSideMint' } }],
    });

    const extras = extractAnchorExtras(idl).swap ?? {};
    for (const key of Object.keys(extras)) expect(codamaNames).toContain(key);
    expect(extras).toEqual({
      pool: { relations: [{ holder: 'poolAuthority', field: 'pool' }] },
      // The holder is the prefixed sibling; the field is the target's own (unprefixed) name in the holder struct.
      sourceSideMint: { relations: [{ holder: 'sourceSidePool', field: 'mint' }] },
      sourceSidePosition: {
        relations: [],
        nestedSeeds: [
          { kind: 'account', path: ['sourceSidePool', 'mint'] },
          { kind: 'arg', path: ['amount'] },
        ],
      },
    });
  });

  it('ignores Anchor IDLs that are not spec 0.1.0', () => {
    expect(extractAnchorExtras({ ...vault, metadata: { ...vault.metadata, spec: '0.2.0' } })).toEqual({});
  });
});
