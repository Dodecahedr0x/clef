import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pubkey } from '../components';

const KEY = 'KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5';
afterEach(cleanup);

describe('Pubkey', () => {
  it('shows the key short, copies it in full on click or Enter, and keeps the click from the row around it', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const row = vi.fn();
    render(
      <button type="button" onClick={row}>
        Account <Pubkey value={KEY} />
      </button>,
    );
    const key = screen.getByRole('button', { name: `Copy ${KEY}` });
    expect(key.textContent).toBe('Keys…wde5');
    expect(key.getAttribute('title')).toContain(KEY);
    fireEvent.click(key);
    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(row).not.toHaveBeenCalled();
    fireEvent.keyDown(key, { key: 'Enter' });
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('can carry a prefix', () => {
    render(<Pubkey value={KEY} prefix="ALT " />);
    expect(screen.getByRole('button').textContent).toBe('ALT Keys…wde5');
  });
});
