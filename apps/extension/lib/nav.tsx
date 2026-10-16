import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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

export function NavProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(() => [initial]);
  const [secrets, setSecrets] = useState<{ password: string | null; mnemonic: string | null }>({ password: null, mnemonic: null });

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const reset = useCallback((r: Route) => setStack([r]), []);
  const route = stack[stack.length - 1] ?? initial;
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
