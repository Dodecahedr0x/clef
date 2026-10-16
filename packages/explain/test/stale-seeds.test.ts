import { IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { AccountRole, address, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain, type ExplainContext } from '../src';
import { buildWire, ME } from './helpers';

const PROGRAM = address('EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy');
const USED = address('6ur7v6AXNpnHeEb6xuk7PyezvZ1i5GrgYyWZkNCpzbRz');
const SYSTEM = address('11111111111111111111111111111111');
const idl = {
  address: PROGRAM,
  metadata: { name: 'ember', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'withdraw',
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [
        { name: 'owner', signer: true, writable: true },
        { name: 'state', pda: { seeds: [{ kind: 'const', value: [115, 116, 97, 116, 101] }] } },
      ],
      args: [],
    },
  ],
};

async function run(opts: { usedOwner: Address; declaredExists: boolean }) {
  const reader = new MemoryChainReader();
  const [declared] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ['state'] });
  reader.setAccount({ address: ME, owner: SYSTEM, lamports: 10n ** 9n, data: new Uint8Array() });
  reader.setAccount({ address: USED, owner: opts.usedOwner, lamports: 1n, data: new Uint8Array(16) });
  if (opts.declaredExists) reader.setAccount({ address: declared, owner: PROGRAM, lamports: 1n, data: new Uint8Array(16) });
  const user = new UserIdlSource();
  user.set(PROGRAM, JSON.stringify(idl));
  const ix: Instruction = {
    programAddress: PROGRAM,
    accounts: [
      { address: ME, role: AccountRole.WRITABLE_SIGNER },
      { address: USED, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  };
  const ctx: ExplainContext = { reader, idls: new IdlResolver([user]), me: [ME] };
  const ex = await explain({ wire: buildWire([ix]) }, ctx);
  return { ex, pda: ex.relations.find((r) => r.kind === 'pda')!, rules: ex.warnings.map((w) => [w.rule, w.severity]) };
}

describe('PDA mismatches caused by stale IDL seeds', () => {
  it('the IDL PDA does not exist and the account used is the program\'s: stale seeds, not a danger', async () => {
    const { pda, rules } = await run({ usedOwner: PROGRAM, declaredExists: false });
    expect(pda.status).toBe('unverified');
    expect(pda.detail).toMatch(/does not exist; this account belongs to the program/);
    expect(rules).not.toContainEqual(['relation-mismatch', 'danger']);
  });

  it('the IDL PDA exists and another program account is used: an unconfirmed instance, shown as a warning', async () => {
    const { pda, rules } = await run({ usedOwner: PROGRAM, declaredExists: true });
    expect(pda).toMatchObject({ status: 'unverified', unconfirmed: true });
    expect(rules).toContainEqual(['relation-unconfirmed', 'warn']);
    expect(rules).not.toContainEqual(['relation-mismatch', 'danger']);
  });

  it('an account the program does not control stays a danger', async () => {
    const { pda, rules } = await run({ usedOwner: SYSTEM, declaredExists: false });
    expect(pda.status).toBe('mismatch');
    expect(rules).toContainEqual(['relation-mismatch', 'danger']);
  });
});
