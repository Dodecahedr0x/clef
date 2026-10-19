import type { RelationEdge, SeedInfo } from '@clef/explain';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { afterEach, describe, expect, it } from 'vitest';
import { SeedPanel } from '../entrypoints/approval/tx/SeedPanel';
import { editorFor, seedBytes, seedText } from '../entrypoints/approval/tx/seed-codec';

const PROGRAM = 'EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih' as Address;
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const le64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};
afterEach(cleanup);

describe('seed codec', () => {
  it('reads each seed with its IDL type, falling back to text, then a key, then hex', () => {
    const cases: [SeedInfo, string, string][] = [
      [{ kind: 'const', display: '"pool"', hex: '706f6f6c', type: { kind: 'bytes' } }, 'string', 'pool'],
      [{ kind: 'account', display: 'mint', hex: hex(new Uint8Array(getAddressEncoder().encode(MINT))), type: { kind: 'pubkey' } }, 'pubkey', MINT],
      [{ kind: 'arg', display: 'id', hex: hex(le64(42n)), type: { kind: 'number', format: 'u64', endian: 'le' } }, 'number', '42'],
      [{ kind: 'arg', display: 'n', hex: 'fffe', type: { kind: 'number', format: 'i16', endian: 'be' } }, 'number', '-2'],
      [{ kind: 'const', display: '0x0102', hex: '0102', type: { kind: 'bytes' } }, 'hex', '0102'],
      [{ kind: 'const', display: 'key', hex: hex(new Uint8Array(getAddressEncoder().encode(MINT))) }, 'pubkey', MINT],
    ];
    for (const [seed, kind, text] of cases) {
      const e = editorFor(seed);
      expect(e.kind, seed.display).toBe(kind);
      expect(seedText(seed, e)).toBe(text);
      // And back to the same bytes.
      expect(hex((seedBytes(text, e) as { bytes: Uint8Array }).bytes)).toBe(seed.hex);
    }
  });

  it('rejects what cannot be a seed', () => {
    const u8 = { kind: 'number', format: 'u8', endian: 'le' } as const;
    expect(seedBytes('256', u8)).toEqual({ error: 'Out of range for u8 (0 to 255)' });
    expect(seedBytes('1.5', u8)).toMatchObject({ error: expect.stringContaining('whole number') });
    expect(seedBytes('xyz', { kind: 'pubkey' })).toEqual({ error: 'Not a valid public key' });
    expect(seedBytes('abc', { kind: 'hex' })).toMatchObject({ error: expect.stringContaining('hex') });
    expect(seedBytes('x'.repeat(33), { kind: 'string' })).toEqual({ error: '33 bytes: a seed is at most 32' });
  });
});

describe('SeedPanel', () => {
  it('shows the seeds of the selected PDA and derives a new address as a seed changes', async () => {
    const seeds = [new TextEncoder().encode('vault'), le64(7n)];
    const [pda] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds });
    const edge: RelationEdge = {
      kind: 'pda', from: pda, to: PROGRAM, label: 'PDA("vault", id)', status: 'verified', external: false,
      seeds: [
        { kind: 'const', display: '"vault"', hex: hex(seeds[0]!), type: { kind: 'bytes' } },
        { kind: 'arg', display: 'id', hex: hex(seeds[1]!), type: { kind: 'number', format: 'u64', endian: 'le' } },
      ],
    };
    render(<SeedPanel account={pda} edges={[edge]} label={() => 'eternal'} />);
    const panel = screen.getByRole('region', { name: 'Seeds' });
    expect((within(panel).getByLabelText(/constant/) as HTMLInputElement).value).toBe('vault');
    const id = within(panel).getByLabelText(/^id/) as HTMLInputElement;
    expect(id.value).toBe('7');
    await waitFor(() => expect(panel.textContent).toContain('✓ this account'));

    fireEvent.change(id, { target: { value: '8' } });
    const [next, bump] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: [seeds[0]!, le64(8n)] });
    await waitFor(() => expect(within(panel).getByRole('button', { name: `Copy ${next}` })).toBeTruthy());
    expect(panel.textContent).toContain(`bump ${bump}`);
    expect(panel.textContent).toContain('another account');

    fireEvent.change(id, { target: { value: '-1' } });
    expect(panel.textContent).toContain('Out of range for u64');
    expect(id.getAttribute('aria-invalid')).toBe('true');

    fireEvent.click(within(panel).getByRole('button', { name: 'Reset' }));
    expect(id.value).toBe('7');
    await waitFor(() => expect(panel.textContent).toContain('✓ this account'));
  });

  it('shows an ATA’s seeds, derived by the Associated Token program', async () => {
    const OWNER = '5Hs51hUxpr9cBz8gwbsFNVcJqdtPeJR8MoUNxoUSGP8a' as Address;
    const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
    const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;
    const keys = [OWNER, TOKEN, MINT].map((a) => new Uint8Array(getAddressEncoder().encode(a)));
    const [ata] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: keys });
    const seed = (display: string, i: number): SeedInfo => ({ kind: 'account', display, hex: hex(keys[i]!), type: { kind: 'pubkey' } });
    const edge: RelationEdge = {
      kind: 'ata', from: ata, to: OWNER, label: 'associated token account', status: 'verified', external: false,
      seeds: [seed('owner', 0), seed('token program', 1), seed('mint', 2)], derivedBy: ATA_PROGRAM,
    };
    render(<SeedPanel account={ata} edges={[edge]} label={(a) => (a === ATA_PROGRAM ? 'Associated Token Program' : a)} />);
    const panel = screen.getByRole('region', { name: 'Seeds' });
    expect(panel.textContent).toContain('derived by Associated Token Program');
    expect((within(panel).getByLabelText(/^mint/) as HTMLInputElement).value).toBe(MINT);
    await waitFor(() => expect(panel.textContent).toContain('✓ this account'));
  });

  it('shows nothing for an account that is not a PDA', () => {
    const { container } = render(<SeedPanel account={MINT} edges={[]} label={() => ''} />);
    expect(container.textContent).toBe('');
  });
});
