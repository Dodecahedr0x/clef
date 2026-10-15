export type SenderLike = { id?: string; url?: string; origin?: string; tab?: unknown };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * The dApp origin for a port opened by our relay content script, taken from the browser-provided sender
 * (never from message content). Only https pages, or http on localhost, may talk to the wallet.
 */
export function dappOrigin(sender: SenderLike, extensionBaseUrl: string): string | null {
  if (!sender.tab || !sender.origin) return null;
  if (sender.url?.startsWith(extensionBaseUrl)) return null;
  let url: URL;
  try {
    url = new URL(sender.origin);
  } catch {
    return null;
  }
  if (url.origin !== sender.origin) return null; // opaque or malformed
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  return allowed ? url.origin : null;
}

/**
 * Internal (popup/approval) calls carry passwords and recovery phrases. Content scripts share the extension id,
 * so the page URL must also be one of ours.
 */
export function isExtensionPage(sender: SenderLike, runtimeId: string, extensionBaseUrl: string): boolean {
  return sender.id === runtimeId && typeof sender.url === 'string' && sender.url.startsWith(extensionBaseUrl);
}
