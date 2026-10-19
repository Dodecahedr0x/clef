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

  it('expands to show why', () => {
    render(<WarnCards warnings={[{ ...stale, details: ['The Anchor IDL stored on chain (gpl_session) declares 2 instructions: createSession, revokeSession.'] }]} />);
    const why = screen.getByText('Why?');
    expect(why.closest('details')?.open).toBe(false);
    fireEvent.click(why);
    expect(why.closest('details')?.open).toBe(true);
    expect(screen.getByText(/declares 2 instructions: createSession, revokeSession/)).toBeTruthy();
  });

  it('shows no link where Clef cannot add one', () => {
    render(<WarnCards warnings={[stale]} />);
    expect(screen.queryByRole('button', { name: 'Add IDL' })).toBeNull();
  });
});

describe('WarnCards · compact', () => {
  it('shows three warnings (warnings before infos) and folds the rest', () => {
    const w = (severity: Warning['severity'], message: string): Warning => ({ rule: 'x', severity, message });
    render(<WarnCards warnings={[w('info', 'info one'), w('warn', 'warn one'), w('warn', 'warn two'), w('info', 'info two'), w('warn', 'warn three')]} />);
    expect(screen.getByText('warn one')).toBeTruthy();
    expect(screen.getByText('warn three')).toBeTruthy();
    expect(screen.queryByText('info one')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getByText('info one')).toBeTruthy();
    expect(screen.getByText('info two')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('info two')).toBeNull();
  });
});

describe('WarningsTable', () => {
  it('lists dangers first and never folds them; warnings fold after three', async () => {
    const { WarningsTable } = await import('../entrypoints/approval/tx/parts');
    const w = (severity: Warning['severity'], message: string): Warning => ({ rule: 'x', severity, message });
    const list = [w('warn', 'w1'), w('danger', 'd1'), w('warn', 'w2'), w('info', 'i1'), w('danger', 'd2'), w('warn', 'w3'), w('warn', 'w4')];
    render(<WarningsTable warnings={list} />);
    const table = screen.getByRole('region', { name: 'Danger and warnings' });
    const rows = () => screen.getAllByRole('row').map((r) => r.textContent?.replace(/^(DANGER|WARN|INFO)/, '$1 '));
    expect(rows()).toEqual([expect.stringMatching(/^DANGER .*d1$/), expect.stringMatching(/^DANGER .*d2$/), 'WARN w1', 'WARN w2', 'WARN w3']);
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(rows()).toHaveLength(7);
    expect(rows().at(-1)).toBe('INFO i1');
    expect(table.querySelectorAll('tr.bg-danger-bg')).toHaveLength(2);
  });
});
