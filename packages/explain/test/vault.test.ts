import { expect, it } from 'vitest';
import { identifyInstruction } from '../src';
import { depositInstruction, vaultAddresses, vaultResolver } from './vault';

it('vault fixture decodes as deposit', async () => {
  const ix = await depositInstruction(await vaultAddresses());
  const out = await identifyInstruction(ix, vaultResolver(), []);
  expect(out.name).toBe('deposit');
  expect(out.args).toMatchObject({ amount: 5n });
  expect(out.accounts.map((a) => a.name)).toEqual(['user', 'pool', 'mint', 'poolVault', 'userPosition', 'authority']);
});
