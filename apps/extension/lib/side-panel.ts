import type { Settings } from '@clef/wallet-core';

type SidePanelApi = {
  setPanelBehavior(b: { openPanelOnActionClick: boolean }): Promise<void>;
  open(o: { windowId: number }): Promise<void>;
};
type ActionApi = { setPopup(d: { popup: string }): Promise<void> };

/** The side panel API, when the browser has it (Chrome 114+, Brave 1.55+). */
export function sidePanelApi(): SidePanelApi | null {
  const api = (globalThis as { chrome?: { sidePanel?: SidePanelApi } }).chrome?.sidePanel;
  return api && typeof api.open === 'function' ? api : null;
}

/** Points the toolbar icon at the popup or the side panel. A popup page set on the action wins over the panel, so it is cleared. */
export async function applyOpenIn(openIn: Settings['openIn'], panel = sidePanelApi(), action?: ActionApi): Promise<void> {
  const act = action ?? (globalThis as unknown as { chrome: { action: ActionApi } }).chrome.action;
  const usePanel = openIn === 'panel' && panel !== null;
  await act.setPopup({ popup: usePanel ? '' : 'popup.html' });
  await panel?.setPanelBehavior({ openPanelOnActionClick: usePanel });
}

/** True inside the side panel page (it marks <html>), so the popup-only controls can hide. */
export const inSidePanel = (): boolean => document.documentElement.classList.contains('panel') && !inTab();

/** True when Clef is open in a browser tab (popup.html with a hash, e.g. #tab). */
export const inTab = (): boolean => document.documentElement.classList.contains('tab');

/** The popup page as a full browser tab. */
export const TAB_HASH = '#tab';
