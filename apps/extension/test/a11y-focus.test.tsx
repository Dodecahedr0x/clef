// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopupScreen, Sheet } from '../components';
import { announce, focusScreen, restoreFocus, useCopy } from '../lib/a11y';
import { NavProvider, useNav } from '../lib/nav';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const announcer = () => document.querySelector('[data-testid="announcer"]');

describe('announce', () => {
  it('writes into one polite live region, repeating the same words', async () => {
    announce('Copied');
    await waitFor(() => expect(announcer()?.textContent).toBe('Copied'));
    expect(announcer()?.getAttribute('aria-live')).toBe('polite');
    announce('Copied');
    expect(announcer()?.textContent).toBe('');
    await waitFor(() => expect(announcer()?.textContent).toBe('Copied'));
    expect(document.querySelectorAll('[data-testid="announcer"]').length).toBe(1);
  });

  it('useCopy writes the clipboard, announces what was copied, and flags copied', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    function C() {
      const { copied, copy } = useCopy();
      return <button onClick={() => copy('abc', 'address')}>{copied ? 'Copied' : 'Copy'}</button>;
    }
    render(<C />);
    fireEvent.click(screen.getByText('Copy'));
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('abc');
    await waitFor(() => expect(announcer()?.textContent).toBe('Copied address'));
  });
});

describe('route focus', () => {
  function Screens() {
    const nav = useNav();
    if (nav.route.name === 'home')
      return (
        <PopupScreen title="Home">
          <button onClick={() => nav.go({ name: 'history' })}>Row 1</button>
          <button onClick={() => nav.go({ name: 'history' })}>Open history</button>
        </PopupScreen>
      );
    return (
      <PopupScreen title="History" onBack={nav.back}>
        <p>list</p>
      </PopupScreen>
    );
  }

  it('a new screen focuses its heading; Back returns focus to what opened it', async () => {
    render(
      <NavProvider initial={{ name: 'home' }}>
        <Screens />
      </NavProvider>,
    );
    const open = screen.getByText('Open history');
    open.focus();
    fireEvent.click(open);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'History' })));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open history'));
  });

  it('a field that took focus on its own keeps it', () => {
    render(
      <main>
        <h1>T</h1>
        <input aria-label="Password" autoFocus />
      </main>,
    );
    focusScreen();
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
  });

  it('restoreFocus waits for content that loads after mount', async () => {
    function Late() {
      const [shown, setShown] = useState(false);
      return (
        <div>
          <h1>History</h1>
          <button onClick={() => setShown(true)}>load</button>
          {shown && <button>Details of Sent to Alice</button>}
        </div>
      );
    }
    render(<Late />);
    (document.activeElement as HTMLElement | null)?.blur();
    restoreFocus({ label: 'Details of Sent to Alice', nth: 0 });
    expect(document.activeElement).toBe(document.body);
    act(() => {
      fireEvent.click(screen.getByText('load'));
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Details of Sent to Alice'));
  });
});

describe('Sheet', () => {
  it('is a modal dialog that takes focus, closes on Escape, and returns focus to its opener', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Choose token</button>
          {open && (
            <Sheet title="Choose token" onClose={() => setOpen(false)}>
              <button>SOL</button>
            </Sheet>
          )}
        </div>
      );
    }
    render(<Host />);
    const opener = screen.getByText('Choose token');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Choose token' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
