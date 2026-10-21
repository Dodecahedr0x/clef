import { useContext, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Icon } from '../../../components';
import { call } from '../../../lib/api';
import { handoffUrl } from '../../../lib/handoff';
import { NavContext, useNavSnapshot, type Route } from '../../../lib/nav';
import { inSidePanel, inTab, sidePanelApi, TAB_HASH } from '../../../lib/side-panel';

/** Moves Clef from the popup into the side panel and remembers it; hidden in the panel and where the API is missing. */
export function PanelButton({ className = '' }: { className?: string }) {
  const [windowId, setWindowId] = useState<number | null>(null);
  const panel = sidePanelApi();
  useEffect(() => {
    if (!panel || inSidePanel()) return;
    void browser.windows.getCurrent().then((w) => setWindowId(w.id ?? null), () => {});
  }, [panel]);
  if (!panel || inSidePanel() || inTab() || windowId === null) return null;

  const open = () => {
    // open() needs the click's user gesture, so it runs before anything awaits.
    void panel.open({ windowId }).then(async () => {
      await call({ type: 'settings:update', patch: { openIn: 'panel' } });
      window.close();
    }, () => {});
  };
  return (
    <button type="button" data-panel-button aria-label="Keep Clef open in the side panel" title="Keep Clef open in the side panel" onClick={open} className={`flex h-11 w-8 flex-none items-center justify-center rounded-xl border-0 bg-transparent text-muted ${className}`}>
      <Icon name="panel" size={20} />
    </button>
  );
}

/** Screens that hold secrets in memory (a new phrase, a password being chosen) or come before the wallet: not handed over. */
const STAYS = new Set<Route['name']>(['welcome', 'create-password', 'recovery-phrase', 'confirm-phrase', 'import', 'unlock', 'accounts/new-phrase', 'accounts/confirm-phrase']);

/**
 * Continues in a full browser tab (from the popup or the side panel) on the same screen, with what was typed;
 * hidden when already in a tab.
 */
export function TabButton({ className = '' }: { className?: string }) {
  const route = useContext(NavContext)?.route;
  const snapshot = useNavSnapshot();
  if (inTab() || (route && STAYS.has(route.name))) return null;
  const open = () => {
    const plain = browser.runtime.getURL(`/popup.html${TAB_HASH}`);
    // Without a handoff (storage failed, or no navigation here) the tab still opens, at home.
    const url = snapshot ? handoffUrl(snapshot()).catch(() => plain) : Promise.resolve(plain);
    void url.then((u) => browser.tabs.create({ url: u })).then(() => {
      // The popup closes itself; the side panel stays open.
      if (!inSidePanel()) window.close();
    }, () => {});
  };
  return (
    <button type="button" data-tab-button aria-label="Continue in a browser tab" title="Continue in a browser tab" onClick={open} className={`flex h-11 w-8 flex-none items-center justify-center rounded-xl border-0 bg-transparent text-muted ${className}`}>
      <Icon name="tab" size={20} />
    </button>
  );
}
