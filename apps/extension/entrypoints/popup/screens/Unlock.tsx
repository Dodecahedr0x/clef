import { useState } from 'react';
import { Alert, Button, Logo, PasswordField } from '../../../components';
import { call } from '../../../lib/api';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

export function UnlockScreen() {
  const nav = useNav();
  const { state, refresh } = useWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'vault:unlock', password });
      setPassword('');
      await refresh();
      nav.reset({ name: 'home' });
    } catch (e) {
      // The background never echoes inputs; anything but a transport failure means the password was wrong.
      const msg = e instanceof Error ? e.message : '';
      setError(/did not respond/i.test(msg) ? msg : 'Wrong password');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg px-6 pb-6 font-sans text-ink">
      <div className="-mx-6 flex h-[260px] items-center justify-center">
        <div className="w-full"><Logo size={96} staff /></div>
      </div>
      <h1 className="m-0 font-mono text-[28px] font-semibold tracking-[-0.03em]">clef</h1>
      <p className="mt-1.5 text-[14px] leading-normal text-muted">Know what you sign.</p>
      <form
        className="mt-auto flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} autoFocus />
        <Button type="submit" block disabled={!password || busy}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        {forgot && (
          <Alert severity="info" title="Clef can’t reset your password">
            Remove and reinstall Clef, then import your recovery phrase with a new password.
          </Alert>
        )}
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>Auto-locks after {state?.settings.autoLockMinutes ?? 15} min</span>
          <button type="button" onClick={() => setForgot((f) => !f)} className="border-0 bg-transparent p-0 text-[12px] text-info hover:text-info-ink">Forgot password?</button>
        </div>
      </form>
    </div>
  );
}
