import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Warning } from '@clef/explain';
import { address } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarnCards } from '../entrypoints/approval/tx/parts';
import { IdlAdder } from '../entrypoints/approval/tx/source';

const PROGRAM = 'KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5';
const stale: Warning = { rule: 'unknown-program', severity: 'warn', message: "Can't decode instruction #1: its program's IDL is out of date.", instructionIndex: 0, programId: address(PROGRAM) };

afterEach(cleanup);

describe('WarnCards · Add IDL', () => {
  it('offers Add IDL for a decode warning, for that program', () => {
    const add = vi.fn();
    render(
      <IdlAdder.Provider value={add}>
        <WarnCards warnings={[stale, { rule: 'high-fee', severity: 'warn', message: 'High fee' }]} />
      </IdlAdder.Provider>,
    );
    const links = screen.getAllByRole('button', { name: 'Add IDL' });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    expect(add).toHaveBeenCalledWith(PROGRAM);
  });

  it('shows no link where Clef cannot add one', () => {
    render(<WarnCards warnings={[stale]} />);
    expect(screen.queryByRole('button', { name: 'Add IDL' })).toBeNull();
  });
});
