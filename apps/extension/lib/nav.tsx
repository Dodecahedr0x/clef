import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeFocus, focusScreen, restoreFocus, type Opener } from './a11y';
import type { Route } from '../entrypoints/popup/routes';

export type { Route };
export type Nav = { route: Route; go(r: Route): void; back(): void; replace(r: Route): void; reset(r: Route): void };
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
  const route = stack[stack.length - 1] ?? initial;

  // After the new screen mounted: focus its heading, or on Back what opened the screen we left.
  useEffect(() => {
    const i = intent.current;
    intent.current = null;
    if (!i) return;
    if (i.kind === 'back') return restoreFocus(i.opener);
    focusScreen();
  }, [stack]);
  const nav = useMemo<Nav>(() => ({ route, go, back, replace, reset }), [route, go, back, replace, reset]);

  const set = useCallback((p: Partial<{ password: string; mnemonic: string }>) => setSecrets((d) => ({ ...d, ...p })), []);
  const clear = useCallback(() => setSecrets({ password: null, mnemonic: null }), []);
  const draft = useMemo<OnboardingDraft>(() => ({ ...secrets, set, clear }), [secrets, set, clear]);

  return (
    <NavContext.Provider value={nav}>
      <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>
    </NavContext.Provider>
  );
}
