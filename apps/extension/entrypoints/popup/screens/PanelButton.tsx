import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Icon } from '../../../components';
import { call } from '../../../lib/api';
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

/** Opens Clef in a full browser tab (from the popup or the side panel); hidden when already in one. */
export function TabButton({ className = '' }: { className?: string }) {
  if (inTab()) return null;
  const open = () => {
    void browser.tabs.create({ url: browser.runtime.getURL(`/popup.html${TAB_HASH}`) }).then(() => {
      // The popup closes itself; the side panel stays open.
      if (!inSidePanel()) window.close();
    }, () => {});
  };
  return (
    <button type="button" data-tab-button aria-label="Open Clef in a tab" title="Open Clef in a tab" onClick={open} className={`flex h-11 w-8 flex-none items-center justify-center rounded-xl border-0 bg-transparent text-muted ${className}`}>
      <Icon name="tab" size={20} />
    </button>
  );
}
