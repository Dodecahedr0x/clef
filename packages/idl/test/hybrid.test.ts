import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { describeIdlError, fixHybridTypeNames, resolveIdl } from '../src';

const EMBER = address('EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy');

/** The shape Phoenix's Ember publishes: new Anchor layout, legacy `publicKey` type name. */
const hybrid = {
  address: EMBER,
  metadata: { name: 'Ember', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'Init',
      discriminator: [220, 59, 207, 236, 108, 250, 47, 100],
      accounts: [{ name: 'payer', writable: true, signer: true }],
      args: [
        { name: 'authority', type: 'publicKey' },
        { name: 'maybe', type: { option: 'publicKey' } },
        { name: 'list', type: { vec: 'publicKey' } },
        { name: 'fixed', type: { array: ['publicKey', 2] } },
      ],
    },
  ],
  accounts: [],
  types: [{ name: 'State', type: { kind: 'struct', fields: [{ name: 'owner', type: 'publicKey' }, { name: 'amount', type: 'u64' }] } }],
  errors: [],
};

describe('hybrid Anchor IDLs', () => {
  it('reads the new layout with legacy publicKey type names', async () => {
    const r = await resolveIdl(EMBER, 'program-metadata', 'authority', hybrid);
    const ix = r.root.program.instructions?.[0];
    expect(ix?.name).toBe("init");
    expect((ix?.arguments ?? []).filter((a) => a.name !== 'discriminator').map((a) => a.name)).toEqual(['authority', 'maybe', 'list', 'fixed']);
  });

  it('renames publicKey only where a type is named', () => {
    expect(fixHybridTypeNames({ type: 'publicKey', name: 'publicKey', docs: ['publicKey'] })).toEqual({ type: 'pubkey', name: 'publicKey', docs: ['publicKey'] });
  });

  it('turns a production Codama error into words', async () => {
    const coded = Object.assign(new Error('Codama error #2100000; Decode this error by running …'), { context: { __code: 2100000, idlType: 'weird' } });
    expect(describeIdlError(coded)).toBe('Unrecognized Anchor IDL type "weird"');
    const other = Object.assign(new Error('Codama error #2100001; Decode …'), { context: { __code: 2100001, name: 'x' } });
    expect(describeIdlError(other)).toBe('The IDL could not be read (Codama error 2100001; name: x)');
    expect(describeIdlError(new Error('plain'))).toBe('plain');
    await expect(resolveIdl(EMBER, 'user', 'user', { ...hybrid, types: [{ name: 'S', type: { kind: 'struct', fields: [{ name: 'a', type: 'weird' }] } }] })).rejects.toThrow(/weird/);
  });
});
