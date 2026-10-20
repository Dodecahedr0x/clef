import { useState } from 'react';
import { Alert, Button, Logo, PasswordField } from '../../../components';
import { call } from '../../../lib/api';
import { useWallet } from '../../../lib/hooks';
import { EraseWallet } from './EraseWallet';

export function UnlockScreen() {
  const { state, refresh } = useWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [erasing, setErasing] = useState(false);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'vault:unlock', password });
      setPassword('');
      // The guard (App) leaves the lock screen once the state says unlocked: back to where auto-lock interrupted.
      await refresh();
    } catch (e) {
      // The background never echoes inputs; anything but a transport failure means the password was wrong.
      const msg = e instanceof Error ? e.message : '';
      setError(/did not respond/i.test(msg) ? msg : 'Wrong password');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-y-auto bg-bg px-6 pb-6 font-sans text-ink">
      <div className={`-mx-6 flex flex-none items-center justify-center ${erasing ? 'h-[120px]' : 'h-[260px]'}`}>
        <div className="w-full"><Logo size={96} staff /></div>
      </div>
      <h1 className="m-0 font-mono text-[28px] font-semibold tracking-[-0.03em]">clef</h1>
      <p className="mt-1.5 text-[14px] leading-normal text-muted">Know what you sign.</p>
      {erasing ? (
        <div className="mt-auto flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold">Erase this wallet?</h2>
          <EraseWallet />
          <Button variant="ghost" block onClick={() => setErasing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
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
            You can erase this wallet and restore it from your recovery phrase with a new password. Private keys you imported separately are lost unless you have them
            elsewhere.
            {!erasing && (
              <button type="button" onClick={() => setErasing(true)} className="mt-1.5 block border-0 bg-transparent p-0 text-[12px] font-semibold text-info underline">
                Erase wallet…
              </button>
            )}
          </Alert>
        )}
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>Auto-locks after {state?.settings.autoLockMinutes ?? 15} min</span>
          <button type="button" onClick={() => setForgot((f) => !f)} className="border-0 bg-transparent p-0 text-[12px] text-info hover:text-info-ink">Forgot password?</button>
        </div>
      </form>
      )}
    </div>
  );
}
