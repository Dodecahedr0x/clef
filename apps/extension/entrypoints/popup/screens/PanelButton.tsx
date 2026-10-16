import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Icon } from '../../../components';
import { call } from '../../../lib/api';
import { inSidePanel, sidePanelApi } from '../../../lib/side-panel';

/** Moves Clef from the popup into the side panel and remembers it; hidden in the panel and where the API is missing. */
export function PanelButton({ className = '' }: { className?: string }) {
  const [windowId, setWindowId] = useState<number | null>(null);
  const panel = sidePanelApi();
  useEffect(() => {
    if (!panel || inSidePanel()) return;
    void browser.windows.getCurrent().then((w) => setWindowId(w.id ?? null), () => {});
  }, [panel]);
  if (!panel || inSidePanel() || windowId === null) return null;

  const open = () => {
    // open() needs the click's user gesture, so it runs before anything awaits.
    void panel.open({ windowId }).then(async () => {
      await call({ type: 'settings:update', patch: { openIn: 'panel' } });
      window.close();
    }, () => {});
  };
  return (
    <button type="button" data-panel-button aria-label="Keep Clef open in the side panel" title="Keep Clef open in the side panel" onClick={open} className={`flex h-11 w-10 items-center justify-center rounded-[10px] border-0 bg-transparent text-muted ${className}`}>
      <Icon name="panel" size={20} />
    </button>
  );
}
