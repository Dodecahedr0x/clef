import { useCallback, useEffect, useRef, useState } from 'react';

let region: HTMLElement | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Tells screen readers about something that changed without moving focus ("Copied", "Simulation complete"). One
 * polite live region per page, created on first use; the text is cleared first so the same words repeat.
 */
export function announce(text: string): void {
  if (typeof document === 'undefined') return;
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('data-testid', 'announcer');
    region.className = 'sr-only';
    document.body.append(region);
  }
  const r = region;
  r.textContent = '';
  clearTimeout(pending);
  pending = setTimeout(() => (r.textContent = text), 50);
}

/** Copies to the clipboard, announces it, and shows `copied` for a moment. */
export function useCopy(ms = 1500): { copied: boolean; copy(value: string, what?: string): void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    (value: string, what?: string) => {
      const write = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('no clipboard'));
      write.then(
        () => {
          announce(what ? `Copied ${what}` : 'Copied');
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), ms);
        },
        () => announce("Couldn't copy"),
      );
    },
    [ms],
  );
  return { copied, copy };
}

/** Where focus was when a screen was opened, by name: the screen is rebuilt on Back, so the element itself is gone. */
export type Opener = { label: string; nth: number } | null;

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const nameOf = (el: Element) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
const focusables = () => [...document.querySelectorAll<HTMLElement>(FOCUSABLE)];

export function describeFocus(): Opener {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  const label = nameOf(el);
  if (!label) return null;
  const same = focusables().filter((e) => nameOf(e) === label);
  return { label, nth: Math.max(0, same.indexOf(el)) };
}

const nothingFocused = () => !document.activeElement || document.activeElement === document.body;

/** A new screen: its heading takes focus (so a screen reader reads where you are), unless a field already took it. */
export function focusScreen(): void {
  if (!nothingFocused()) return;
  const target = document.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('main');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/**
 * Back: focus returns to what opened the screen (a History row, a settings item), waiting briefly for content that
 * loads after mount. Falls back to the heading; gives up as soon as the user moves focus themselves.
 */
export function restoreFocus(opener: Opener, waitMs = 1500): () => void {
  const find = () => (opener ? focusables().filter((e) => nameOf(e) === opener.label)[opener.nth] : undefined);
  const now = find();
  if (now) {
    now.focus({ preventScroll: false });
    return () => {};
  }
  if (!opener) {
    focusScreen();
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (!nothingFocused()) return stop();
    const el = find();
    if (el) {
      el.focus();
      stop();
    }
  });
  const timer = setTimeout(() => {
    stop();
    focusScreen();
  }, waitMs);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.body, { childList: true, subtree: true });
  return stop;
}
