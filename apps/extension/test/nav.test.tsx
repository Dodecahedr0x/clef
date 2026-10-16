// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NavProvider, useNav, useOnboardingDraft } from '../lib/nav';

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => <NavProvider initial={{ name: 'home' }}>{children}</NavProvider>;

describe('nav', () => {
  it('pushes, pops, replaces and resets the route stack', () => {
    const { result } = renderHook(() => useNav(), { wrapper });
    expect(result.current.route).toEqual({ name: 'home' });

    act(() => result.current.go({ name: 'token', mint: 'M' }));
    act(() => result.current.go({ name: 'send', mint: 'M' }));
    expect(result.current.route).toEqual({ name: 'send', mint: 'M' });

    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: 'token', mint: 'M' });

    act(() => result.current.replace({ name: 'receive' }));
    expect(result.current.route).toEqual({ name: 'receive' });
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: 'home' });

    act(() => result.current.go({ name: 'settings' }));
    act(() => result.current.go({ name: 'settings/sites' }));
    act(() => result.current.reset({ name: 'unlock' }));
    expect(result.current.route).toEqual({ name: 'unlock' });
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: 'unlock' });
  });

  it('back at the root is a no-op', () => {
    const { result } = renderHook(() => useNav(), { wrapper });
    act(() => result.current.back());
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: 'home' });
    act(() => result.current.go({ name: 'history' }));
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: 'home' });
  });

  it('renders the current route to consumers', () => {
    function Screen() {
      const nav = useNav();
      return <button onClick={() => nav.go({ name: 'receive' })}>{nav.route.name}</button>;
    }
    render(
      <NavProvider initial={{ name: 'welcome' }}>
        <Screen />
      </NavProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('welcome');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('receive');
  });

  it('useNav throws outside a provider', () => {
    expect(() => renderHook(() => useNav())).toThrow(/NavProvider/);
  });
});

describe('useOnboardingDraft', () => {
  it('holds password and mnemonic in memory and clears them', () => {
    const { result } = renderHook(() => ({ draft: useOnboardingDraft(), nav: useNav() }), { wrapper });
    expect(result.current.draft).toMatchObject({ password: null, mnemonic: null });

    act(() => result.current.draft.set({ password: 'hunter22' }));
    act(() => result.current.nav.go({ name: 'recovery-phrase' }));
    act(() => result.current.draft.set({ mnemonic: 'a b c' }));
    expect(result.current.draft).toMatchObject({ password: 'hunter22', mnemonic: 'a b c' });

    act(() => result.current.draft.clear());
    expect(result.current.draft).toMatchObject({ password: null, mnemonic: null });
  });

  it('is not shared between providers and never touches storage', () => {
    const a = renderHook(() => useOnboardingDraft(), { wrapper });
    act(() => a.result.current.set({ password: 'pw' }));
    const b = renderHook(() => useOnboardingDraft(), { wrapper });
    expect(b.result.current.password).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
