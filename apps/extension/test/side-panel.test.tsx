import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeHandoff } from '../lib/handoff';
import { NavProvider, useNav, useScreenDraft, type Route } from '../lib/nav';
import { applyOpenIn } from '../lib/side-panel';

const h = vi.hoisted(() => {
  const session = new Map<string, unknown>();
  return {
    call: vi.fn(async () => ({})),
    getCurrent: vi.fn(async () => ({ id: 7 })),
    create: vi.fn(async () => ({})),
    session,
    storage: {
      set: vi.fn(async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => session.set(k, v))),
      get: vi.fn(async (k: string) => (session.has(k) ? { [k]: session.get(k) } : {})),
      remove: vi.fn(async (k: string) => void session.delete(k)),
    },
  };
});
vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('wxt/browser', () => ({ browser: { windows: { getCurrent: h.getCurrent }, tabs: { create: h.create }, storage: { session: h.storage }, runtime: { getURL: (p: string) => `chrome-extension://clef${p}` } } }));

const { PanelButton, TabButton } = await import('../entrypoints/popup/screens/PanelButton');

type Chrome = { sidePanel?: { open: ReturnType<typeof vi.fn>; setPanelBehavior: ReturnType<typeof vi.fn> } };
const g = globalThis as unknown as { chrome?: Chrome };

function fakePanel() {
  const sidePanel = { open: vi.fn(async () => {}), setPanelBehavior: vi.fn(async () => {}) };
  g.chrome = { sidePanel };
  return sidePanel;
}

afterEach(() => {
  cleanup();
  delete g.chrome;
  document.documentElement.classList.remove('panel', 'tab');
  h.call.mockClear();
});

describe('applyOpenIn', () => {
  it('panel: clears the action popup so the icon opens the side panel', async () => {
    const panel = { open: vi.fn(), setPanelBehavior: vi.fn(async () => {}) };
    const action = { setPopup: vi.fn(async () => {}) };
    await applyOpenIn('panel', panel, action);
    expect(action.setPopup).toHaveBeenCalledWith({ popup: '' });
    expect(panel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('popup: restores the popup page and turns the panel click-through off', async () => {
    const panel = { open: vi.fn(), setPanelBehavior: vi.fn(async () => {}) };
    const action = { setPopup: vi.fn(async () => {}) };
    await applyOpenIn('popup', panel, action);
    expect(action.setPopup).toHaveBeenCalledWith({ popup: 'popup.html' });
    expect(panel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  });

  it('a browser without the side panel API keeps the popup even when panel is chosen', async () => {
    const action = { setPopup: vi.fn(async () => {}) };
    await applyOpenIn('panel', null, action);
    expect(action.setPopup).toHaveBeenCalledWith({ popup: 'popup.html' });
  });
});

describe('PanelButton', () => {
  beforeEach(() => {
    vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  it('opens the side panel in this window, remembers it, and closes the popup', async () => {
    const panel = fakePanel();
    render(<PanelButton />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Clef open in the side panel' }));
    expect(panel.open).toHaveBeenCalledWith({ windowId: 7 });
    await waitFor(() => expect(h.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { openIn: 'panel' } }));
    expect(window.close).toHaveBeenCalled();
  });

  it('is hidden without the side panel API and inside the panel itself', async () => {
    render(<PanelButton />);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /side panel/ })).toBeNull();
    cleanup();
    fakePanel();
    document.documentElement.classList.add('panel');
    render(<PanelButton />);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /side panel/ })).toBeNull();
  });
});

describe('TabButton', () => {
  it('opens Clef in a full tab and closes the popup', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    render(<TabButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue in a browser tab' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ url: 'chrome-extension://clef/popup.html#tab' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    close.mockRestore();
  });

  it('keeps the side panel open', async () => {
    document.documentElement.classList.add('panel');
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    render(<TabButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue in a browser tab' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });

  it('continues the current screen and what was typed in the tab, once', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    function Send() {
      const nav = useNav();
      const [amount, setAmount] = useScreenDraft('send.amount', '');
      return (
        <>
          <button type="button" onClick={() => nav.go({ name: 'send', mint: 'SOL' })}>go</button>
          <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <TabButton />
        </>
      );
    }
    render(
      <NavProvider initial={{ name: 'home' }}>
        <Send />
      </NavProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue in a browser tab' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const url = (h.create.mock.calls.at(-1) as unknown as [{ url: string }])[0].url;
    expect(url).toMatch(/^chrome-extension:\/\/clef\/popup\.html#tab&continue=[0-9a-f-]{36}$/);
    const hash = url.slice(url.indexOf('#'));
    const all = () => true;
    const got = await takeHandoff(all, hash);
    expect(got).toEqual({ stack: [{ name: 'home' }, { name: 'send', mint: 'SOL' }], drafts: [['send.amount', '0.5']] });
    expect(await takeHandoff(all, hash)).toBeNull();
    close.mockRestore();
  });

  it('a stale or unknown handoff starts fresh', async () => {
    const at = Date.now() - 120_000;
    h.session.set('handoff:old', { stack: [{ name: 'send' }], drafts: [], at });
    expect(await takeHandoff(() => true, '#tab&continue=old')).toBeNull();
    expect(h.session.has('handoff:old')).toBe(false);
    h.session.set('handoff:bad', { stack: [{ name: 'evil' }, { name: 'send' }], drafts: [['x', 1], 'junk'], at: Date.now() });
    expect(await takeHandoff((n) => n === 'send', '#tab&continue=bad')).toEqual({ stack: [{ name: 'send' }], drafts: [['x', 1]] });
    expect(await takeHandoff(() => true, '#tab')).toBeNull();
  });

  it('restores the stack and drafts, behind the lock screen when locked', () => {
    const restore = { stack: [{ name: 'home' }, { name: 'send' }] as Route[], drafts: [['send.amount', '2']] as [string, unknown][] };
    function Where() {
      const nav = useNav();
      return <span>{nav.route.name}</span>;
    }
    render(
      <NavProvider initial={{ name: 'home' }} restore={restore}>
        <Where />
      </NavProvider>,
    );
    expect(screen.getByText('send')).toBeTruthy();
    cleanup();
    function Locked() {
      const nav = useNav();
      return (
        <button type="button" onClick={() => nav.resume({ name: 'home' })}>
          {nav.route.name}
        </button>
      );
    }
    render(
      <NavProvider initial={{ name: 'unlock' }} restore={restore}>
        <Locked />
      </NavProvider>,
    );
    fireEvent.click(screen.getByText('unlock'));
    expect(screen.getByText('send')).toBeTruthy();
  });

  it('is not offered on screens holding a secret in memory', () => {
    render(
      <NavProvider initial={{ name: 'accounts/new-phrase' }}>
        <TabButton />
      </NavProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Continue in a browser tab' })).toBeNull();
  });

  it('in a tab: neither button shows', () => {
    fakePanel();
    document.documentElement.classList.add('panel', 'tab');
    render(<><TabButton /><PanelButton /></>);
    expect(screen.queryByRole('button', { name: 'Continue in a browser tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep Clef open in the side panel' })).toBeNull();
  });
});
