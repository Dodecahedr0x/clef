import { ERASE_CONFIRMATION } from '@clef/wallet-core';
import { useState } from 'react';
import { Alert, Button, TextField } from '../../../components';
import { call } from '../../../lib/api';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

/** Deletes everything Clef holds in this browser, after the user types the confirmation word. */
export function EraseWallet() {
  const nav = useNav();
  const { refresh } = useWallet();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toLowerCase() === ERASE_CONFIRMATION;

  const erase = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'wallet:erase', confirm: typed });
      await refresh();
      nav.reset({ name: 'welcome' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not erase the wallet');
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Erase wallet"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void erase();
      }}
    >
      <p className="m-0 text-xs leading-[1.45] text-muted">
        Erasing deletes this wallet from this browser: recovery phrases, imported keys, accounts, contacts, IDLs, connected sites and settings. Your funds stay on chain:
        restore the accounts afterwards from your recovery phrase. Private keys you imported separately are lost unless you have them elsewhere.
      </p>
      <TextField label={`Type “${ERASE_CONFIRMATION}” to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      {error && <Alert severity="danger">{error}</Alert>}
      <Button type="submit" variant="danger-outline" block disabled={!ready || busy}>
        {busy ? 'Erasing…' : 'Erase this wallet'}
      </Button>
    </form>
  );
}
