import type { Bridge } from './clef-wallet';
import { INPAGE_SOURCE, RELAY_SOURCE } from './messages';

/** Approvals can take a while; after this the page stops waiting (e.g. the service worker restarted mid-request). */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const DISCONNECTED = 4900;

type WindowLike = Pick<Window, 'addEventListener' | 'postMessage'> & { location: { origin: string } };
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });

/** MAIN-world side of the page <-> relay channel. Only same-window, same-origin messages from the relay are accepted. */
export function pageBridge(win: WindowLike = window): Bridge {
  const pending = new Map<string, Pending>();
  const listeners: ((accounts: string[]) => void)[] = [];

  win.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== (win as unknown) || e.origin !== win.location.origin) return;
    const data = e.data as { source?: unknown; event?: { accounts?: unknown }; response?: Record<string, unknown> } | null;
    if (data?.source !== RELAY_SOURCE) return;
    const accounts = data.event?.accounts;
    if (Array.isArray(accounts) && accounts.every((a) => typeof a === 'string')) {
      for (const l of listeners) l(accounts as string[]);
      return;
    }
    const res = data.response;
    if (!res || typeof res.id !== 'string') return;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    clearTimeout(p.timer);
    if (res.ok === true) p.resolve(res.result);
    else {
      const err = (res.error ?? {}) as { code?: unknown; message?: unknown };
      p.reject(rpcError(typeof err.code === 'number' ? err.code : -32603, typeof err.message === 'string' ? err.message : 'Request failed'));
    }
  });

  return {
    request(method, params) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(rpcError(DISCONNECTED, 'Wallet did not respond'));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        win.postMessage({ source: INPAGE_SOURCE, id, method, params }, win.location.origin);
      });
    },
    onEvent(cb) {
      listeners.push(cb);
    },
  };
}
