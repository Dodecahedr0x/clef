import type { PanelHost } from './approvals';
import type { PanelMessage } from './messages';

type PortLike = { postMessage(m: PanelMessage): void; onDisconnect: { addListener(f: () => void): void } };

/** Background side of the side panel: the open panels and which approvals each is showing. */
export class PanelRegistry implements PanelHost {
  private readonly panels: { port: PortLike; ids: Set<string> }[] = [];

  constructor(private readonly onClosed: (ids: string[]) => void) {}

  add(port: PortLike): void {
    const entry = { port, ids: new Set<string>() };
    this.panels.push(entry);
    port.onDisconnect.addListener(() => {
      this.panels.splice(this.panels.indexOf(entry), 1);
      if (entry.ids.size) this.onClosed([...entry.ids]);
    });
  }

  /** The most recently opened panel takes the request. */
  show(id: string): boolean {
    const entry = this.panels.at(-1);
    if (!entry) return false;
    try {
      entry.port.postMessage({ type: 'show', id });
    } catch {
      return false;
    }
    entry.ids.add(id);
    return true;
  }

  done(id: string): void {
    for (const entry of this.panels) {
      if (!entry.ids.delete(id)) continue;
      try {
        entry.port.postMessage({ type: 'done', id });
      } catch {
        // the panel is closing; nothing to clear
      }
    }
  }
}
