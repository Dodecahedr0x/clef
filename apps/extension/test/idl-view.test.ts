import { readFileSync } from 'node:fs';
import { createBundledSource, resolveIdl } from '@clef/idl';
import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { outlineIdl, typeName } from '../lib/idl-view';

const VAULT = address('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const vaultJson = JSON.parse(readFileSync(new URL('../../../packages/explain/test/fixtures/vault-anchor.json', import.meta.url), 'utf8'));

describe('outlineIdl', () => {
  it('lists every instruction with its arguments and accounts, the account types and the defined types', async () => {
    const o = outlineIdl((await resolveIdl(VAULT, 'user', 'user', vaultJson)).root);
    expect(o.instructions.map((i) => i.name)).toEqual(['deposit']);
    const deposit = o.instructions[0]!;
    expect(deposit.discriminator).toBeTruthy();
    expect(deposit.args.map((a) => a.name)).not.toContain('discriminator');
    expect(deposit.accounts.find((a) => a.name === 'user')?.flags).toEqual(expect.arrayContaining(['writable', 'signer']));
    expect(deposit.accounts.find((a) => a.name === 'pool')?.flags).toContain('pda');
    expect(o.accounts.map((a) => a.name)).toEqual(['pool']);
    expect(o.accounts[0]!.fields.length).toBeGreaterThan(0);
  });

  it('reads a bundled program (Token): many instructions, errors and readable types', async () => {
    const token = await createBundledSource().load(address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
    const o = outlineIdl(token!.root);
    expect(o.instructions.length).toBeGreaterThan(20);
    expect(o.instructions.find((i) => i.name === 'transferChecked')?.args).toEqual([
      { name: 'amount', type: 'u64' },
      { name: 'decimals', type: 'u8' },
    ]);
    expect(o.errors.length).toBeGreaterThan(5);
    expect(o.accounts.map((a) => a.name)).toEqual(expect.arrayContaining(['mint', 'token']));
  });

  it('formats nested types', () => {
    expect(typeName({ kind: 'optionTypeNode', item: { kind: 'publicKeyTypeNode' } })).toBe('Option<pubkey>');
    expect(typeName({ kind: 'arrayTypeNode', item: { kind: 'numberTypeNode', format: 'u8' }, count: { kind: 'fixedCountNode', value: 32 } })).toBe('[u8; 32]');
    expect(typeName({ kind: 'arrayTypeNode', item: { kind: 'definedTypeLinkNode', name: 'order' }, count: { kind: 'prefixedCountNode' } })).toBe('Vec<order>');
    expect(typeName({ kind: 'structTypeNode', fields: [{ kind: 'structFieldTypeNode', name: 'a', type: { kind: 'booleanTypeNode' } }] })).toBe('{ a: bool }');
  });
});
