import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOpenIn } from '../lib/side-panel';

const h = vi.hoisted(() => ({ call: vi.fn(async () => ({})), getCurrent: vi.fn(async () => ({ id: 7 })) }));
vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('wxt/browser', () => ({ browser: { windows: { getCurrent: h.getCurrent } } }));

const { PanelButton } = await import('../entrypoints/popup/screens/PanelButton');

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
  document.documentElement.classList.remove('panel');
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
