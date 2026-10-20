import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeFocus, focusScreen, restoreFocus, type Opener } from './a11y';
import type { Route } from '../entrypoints/popup/routes';

export type { Route };
export type Nav = {
  route: Route;
  go(r: Route): void;
  back(): void;
  replace(r: Route): void;
  reset(r: Route): void;
  /** Leaves for `r` (the lock screen) keeping where the user was and what they had typed, for `resume`. */
  suspend(r: Route): void;
  /** Back to where `suspend` left, or `fallback` when nothing was suspended. */
  resume(fallback: Route): void;
};
export type OnboardingDraft = {
  password: string | null;
  mnemonic: string | null;
  set(p: Partial<{ password: string; mnemonic: string }>): void;
  clear(): void;
};

export const NavContext = createContext<Nav | null>(null);
// Secrets typed during onboarding live only in React state: never written to any storage.
const DraftContext = createContext<OnboardingDraft | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside a NavProvider');
  return nav;
}

type DraftStore = { values: Map<string, unknown>; keeping: { current: boolean } };
const DraftStoreContext = createContext<DraftStore | null>(null);

/**
 * `useState` whose value outlives the screen while it is suspended (an auto-lock): the form comes back as it was
 * after unlocking. Leaving the screen any other way forgets it. Held in memory only, never in storage.
 */
export function useScreenDraft<T>(key: string, initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const store = useContext(DraftStoreContext);
  const [value, setValue] = useState<T>(() =>
    store?.values.has(key) ? (store.values.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial,
  );
  useEffect(() => {
    store?.values.set(key, value);
  }, [store, key, value]);
  useEffect(
    () => () => {
      if (store && !store.keeping.current) store.values.delete(key);
    },
    [store, key],
  );
  return [value, setValue];
}

export function useOnboardingDraft(): OnboardingDraft {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error('useOnboardingDraft must be used inside a NavProvider');
  return draft;
}

type FocusIntent = { kind: 'forward' } | { kind: 'back'; opener: Opener };

export function NavProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(() => [initial]);
  // openers[i]: where focus was when stack[i + 1] was opened, to return there on Back.
  const openers = useRef<Opener[]>([]);
  const depth = useRef(1);
  depth.current = stack.length;
  const intent = useRef<FocusIntent | null>(null);
  const [secrets, setSecrets] = useState<{ password: string | null; mnemonic: string | null }>({ password: null, mnemonic: null });
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const suspended = useRef<Route[] | null>(null);
  const drafts = useMemo<DraftStore>(() => ({ values: new Map(), keeping: { current: false } }), []);

  const go = useCallback((r: Route) => {
    openers.current.push(describeFocus());
    intent.current = { kind: 'forward' };
    setStack((s) => [...s, r]);
  }, []);
  const back = useCallback(() => {
    if (depth.current <= 1) return;
    intent.current = { kind: 'back', opener: openers.current.pop() ?? null };
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const replace = useCallback((r: Route) => {
    intent.current = { kind: 'forward' };
    setStack((s) => [...s.slice(0, -1), r]);
  }, []);
  const reset = useCallback((r: Route) => {
    openers.current = [];
    intent.current = { kind: 'forward' };
    setStack([r]);
  }, []);
  const suspend = useCallback(
    (r: Route) => {
      suspended.current = stackRef.current;
      drafts.keeping.current = true;
      openers.current = [];
      intent.current = { kind: 'forward' };
      setStack([r]);
    },
    [drafts],
  );
  const resume = useCallback(
    (fallback: Route) => {
      const back = suspended.current;
      suspended.current = null;
      // The screens below are about to mount and read their drafts; from here, leaving forgets them again.
      drafts.keeping.current = false;
      if (!back) drafts.values.clear();
      openers.current = [];
      intent.current = { kind: 'forward' };
      setStack(back ?? [fallback]);
    },
    [drafts],
  );
  const route = stack[stack.length - 1] ?? initial;

  // After the new screen mounted: focus its heading, or on Back what opened the screen we left.
  useEffect(() => {
    const i = intent.current;
    intent.current = null;
    if (!i) return;
    if (i.kind === 'back') return restoreFocus(i.opener);
    focusScreen();
  }, [stack]);
  const nav = useMemo<Nav>(() => ({ route, go, back, replace, reset, suspend, resume }), [route, go, back, replace, reset, suspend, resume]);

  const set = useCallback((p: Partial<{ password: string; mnemonic: string }>) => setSecrets((d) => ({ ...d, ...p })), []);
  const clear = useCallback(() => setSecrets({ password: null, mnemonic: null }), []);
  const draft = useMemo<OnboardingDraft>(() => ({ ...secrets, set, clear }), [secrets, set, clear]);

  return (
    <NavContext.Provider value={nav}>
      <DraftContext.Provider value={draft}>
        <DraftStoreContext.Provider value={drafts}>{children}</DraftStoreContext.Provider>
      </DraftContext.Provider>
    </NavContext.Provider>
  );
}
