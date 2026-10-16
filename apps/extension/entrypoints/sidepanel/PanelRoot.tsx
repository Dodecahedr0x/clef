import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ApprovalHost } from '../../lib/approval-host';
import { PANEL_PORT, type PanelMessage } from '../../lib/messages';
import { Approval } from '../approval/Approval';
import { App } from '../popup/App';

/**
 * The side panel: the wallet, plus any approval the background routes here while the panel is open.
 * Requests queue in arrival order; each shows over the wallet until it is decided.
 */
export function PanelRoot() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const port = browser.runtime.connect({ name: PANEL_PORT });
    port.onMessage.addListener((msg: unknown) => {
      const m = msg as PanelMessage;
      if (m?.type === 'show' && typeof m.id === 'string') setIds((q) => (q.includes(m.id) ? q : [...q, m.id]));
      if (m?.type === 'done' && typeof m.id === 'string') setIds((q) => q.filter((x) => x !== m.id));
    });
    return () => port.disconnect();
  }, []);

  const current = ids[0];
  return (
    <>
      <div hidden={current !== undefined} className="h-full">
        <App />
      </div>
      {current !== undefined && (
        <div className="fixed inset-0 z-50 bg-bg" role="dialog" aria-label="Approval request">
          <ApprovalHost.Provider value="panel">
            <Approval key={current} id={current} onClose={() => setIds((q) => q.filter((x) => x !== current))} />
          </ApprovalHost.Provider>
        </div>
      )}
    </>
  );
}
