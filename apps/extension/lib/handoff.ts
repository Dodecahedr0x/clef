import { browser } from 'wxt/browser';
import type { NavSnapshot } from './nav';
import { TAB_HASH } from './side-panel';

const PREFIX = 'handoff:';
/** A tab opens in well under a second; an older handoff is a leftover, not this click. */
const MAX_AGE_MS = 60_000;
const PARAM = '&continue=';

type Stored = NavSnapshot & { at: number };

/**
 * Keeps `snapshot` for the tab about to open and returns the tab's URL. Session storage: memory only, gone when the
 * browser closes, and read only by Clef's own pages.
 */
export async function handoffUrl(snapshot: NavSnapshot, now = Date.now()): Promise<string> {
  const token = crypto.randomUUID();
  let value: Stored;
  try {
    // Drafts that can't be stored as JSON are left behind rather than failing the whole handoff.
    value = JSON.parse(JSON.stringify({ ...snapshot, at: now }));
  } catch {
    value = { stack: snapshot.stack, drafts: [], at: now };
  }
  await browser.storage.session.set({ [PREFIX + token]: value });
  return browser.runtime.getURL(`/popup.html${TAB_HASH}${PARAM}${token}`);
}

/** The snapshot this tab was opened with, once: it is deleted on read, and dropped when stale or malformed. */
export async function takeHandoff(isRoute: (name: unknown) => boolean, hash = location.hash, now = Date.now()): Promise<NavSnapshot | null> {
  const i = hash.indexOf(PARAM);
  if (!hash.startsWith(TAB_HASH) || i < 0) return null;
  const key = PREFIX + hash.slice(i + PARAM.length);
  // A reload of this tab starts fresh at #tab.
  history.replaceState(null, '', TAB_HASH);
  const got = (await browser.storage.session.get(key))[key] as Partial<Stored> | undefined;
  await browser.storage.session.remove(key);
  if (!got || typeof got.at !== 'number' || now - got.at > MAX_AGE_MS || now < got.at) return null;
  const stack = Array.isArray(got.stack) ? got.stack.filter((r) => r && typeof r === 'object' && isRoute(r.name)) : [];
  if (stack.length === 0) return null;
  const drafts = Array.isArray(got.drafts) ? got.drafts.filter((d): d is [string, unknown] => Array.isArray(d) && typeof d[0] === 'string') : [];
  return { stack, drafts };
}
