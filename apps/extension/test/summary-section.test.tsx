import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SummarySection } from '../entrypoints/approval/tx/SummarySection';

const ME = '5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a';
const POOL = 'GdxfTLbLv7wPJmBq3FfS3bUkMSWPdmDbcn3PzVgYGtAs';
afterEach(cleanup);

describe('SummarySection', () => {
  it('lists balance changes per account, the fee, and every transfer with its direction', () => {
    render(
      <SummarySection
        changes={[{ owner: ME, asset: 'SOL', amount: '-0.5' }, { owner: ME, asset: 'USDC', amount: '+12' }, { owner: POOL, asset: 'SOL', amount: '+0.5' }]}
        fee="0.000005 SOL"
        transfers={[{ kind: 'sol', from: ME, to: POOL, amount: '0.5 SOL', instructionIndex: 0, inner: false }, { kind: 'token', from: POOL, to: ME, amount: '12 USDC', instructionIndex: 1, inner: true }]}
        transfersPartial={false}
        label={(a) => (a === ME ? 'You · Main' : undefined)}
        onChain={false}
      />,
    );
    const section = screen.getByRole('region', { name: 'Summary' });
    expect(within(section).getByText('Simulated balance changes')).toBeTruthy();
    const rows = within(section).getAllByRole('row').map((r) => r.textContent);
    expect(rows[0]).toMatch(/^You · Main.*−0\.5 SOL\+12 USDC$/);
    expect(rows[1]).toMatch(/\+0\.5 SOL$/);
    expect(section.textContent).toContain('Network fee0.000005 SOL');
    expect(rows[2]).toMatch(/^0\.5 SOLYou · Main .*sent →.*· #1$/);
    expect(rows[3]).toMatch(/^12 USDC.*sent →.*You · Main.*· #2 via a called program$/);
  });

  it('says when balance changes or the called programs’ transfers are unknown', () => {
    render(<SummarySection changes={null} fee={null} transfers={[]} transfersPartial label={() => undefined} onChain />);
    const section = screen.getByRole('region', { name: 'Summary' });
    expect(section.textContent).toContain('Balance changes unknown');
    expect(section.textContent).toContain('only the instructions\' own transfers are listed');
  });
});
