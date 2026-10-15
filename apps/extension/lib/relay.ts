import { INPAGE_SOURCE, RELAY_SOURCE, type DappPortReply } from './messages';

export interface PortLike {
  postMessage(msg: unknown): void;
  onMessage: { addListener(cb: (msg: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

type WindowLike = Pick<Window, 'addEventListener' | 'postMessage'> & { location: { origin: string } };

/**
 * ISOLATED-world bridge: forwards the page's requests to the background over a port and posts replies back
 * to the page. The port is opened lazily, on the page's first request, so ordinary page loads never wake the
 * service worker; it is reopened after the service worker restarts.
 */
export function startRelay(win: WindowLike, connect: () => PortLike): void {
  let port: PortLike | null = null;

  const open = (): PortLike => {
    const p = connect();
    p.onMessage.addListener((raw) => {
      const msg = raw as DappPortReply;
      if (msg?.type === 'response') win.postMessage({ source: RELAY_SOURCE, response: msg.response }, win.location.origin);
      else if (msg?.type === 'event') win.postMessage({ source: RELAY_SOURCE, event: { accounts: msg.accounts } }, win.location.origin);
    });
    p.onDisconnect.addListener(() => {
      if (port === p) port = null;
    });
    return p;
  };

  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== (win as unknown) || e.origin !== win.location.origin) return;
    const data = e.data as { source?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
    if (data?.source !== INPAGE_SOURCE || typeof data.id !== 'string') return;
    port ??= open();
    port.postMessage({ type: 'request', request: { id: data.id, method: data.method, params: data.params } });
  });
}
