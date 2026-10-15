import type { WalletState } from '@clef/wallet-core';
import { useCallback, useEffect, useState } from 'react';
import { getState } from '../../lib/api';
import { Home } from './Home';
import { Create, Import, Unlock, Welcome } from './Onboarding';
import { Settings } from './Settings';

type View = 'home' | 'create' | 'import' | 'settings';

export function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const [view, setView] = useState<View>('home');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The wallet did not respond');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  if (error) return <p className="p-4 text-sm text-red-400">{error}</p>;
  if (!state) return null;

  const done = () => {
    setView('home');
    void refresh();
  };

  if (!state.hasVault) {
    if (view === 'create') return <Create onDone={done} onBack={() => setView('home')} />;
    if (view === 'import') return <Import onDone={done} onBack={() => setView('home')} />;
    return <Welcome onCreate={() => setView('create')} onImport={() => setView('import')} />;
  }
  if (!state.unlocked) return <Unlock onDone={done} />;
  if (view === 'settings') return <Settings state={state} refresh={refresh} onBack={() => setView('home')} />;
  return <Home state={state} refresh={refresh} onSettings={() => setView('settings')} />;
}
