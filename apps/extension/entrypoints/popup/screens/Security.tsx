import { useState } from 'react';
import { Alert, Button, ListGroup, PasswordField, PopupScreen, SectionLabel, Segmented } from '../../../components';
import { call } from '../../../lib/api';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const MIN_PASSWORD = 8;

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function RevealPhrase() {
  const phrases = useWallet().state?.phrases ?? 1;
  const [phrase, setPhrase] = useState('1');
  const [password, setPassword] = useState('');
  const [words, setWords] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (words) {
    return (
      <div className="flex flex-col gap-2.5">
        <ol aria-label={phrases > 1 ? `Recovery phrase ${phrase}` : 'Recovery phrase'} className="grid grid-cols-3 gap-1.5 rounded-xl border border-line bg-surface p-2.5">
          {words.map((w, i) => (
            <li key={i} className="flex gap-1.5 rounded-lg bg-surface-3 px-2 py-1.5 font-mono text-xs">
              <span className="text-faint">{i + 1}</span>
              <span className="text-ink">{w}</span>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="md" block onClick={() => setWords(null)}>
          Hide phrase
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { mnemonic } = await call<{ mnemonic: string }>({ type: 'vault:revealMnemonic', password, ...(phrases > 1 && { phrase: Number(phrase) }) });
          setWords(mnemonic.trim().split(/\s+/));
          setPassword('');
        } catch (err) {
          setError(errorText(err, 'Could not reveal the phrase'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Alert severity="danger" label="DANGER" title="Anyone with this phrase owns your wallet">
        Never type it into a website or share it, not even with Clef support. Make sure no one can see your screen.
      </Alert>
      {phrases > 1 && (
        <Segmented
          fill
          size="md"
          ariaLabel="Which recovery phrase"
          value={phrase}
          onChange={setPhrase}
          options={Array.from({ length: phrases }, (_, i) => ({ value: String(i + 1), label: `Phrase ${i + 1}`, ariaLabel: `Recovery phrase ${i + 1}` }))}
        />
      )}
      <PasswordField label="Password" autoComplete="current-password" value={password} error={error} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" variant="danger-outline" size="md" block disabled={busy || !password}>
        Reveal recovery phrase
      </Button>
    </form>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next;

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        setDone(false);
        try {
          await call({ type: 'vault:changePassword', current, next });
          setCurrent('');
          setNext('');
          setConfirm('');
          setDone(true);
        } catch (err) {
          setError(errorText(err, 'Could not change the password'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <PasswordField
        label={`New password (at least ${MIN_PASSWORD} characters)`}
        autoComplete="new-password"
        value={next}
        error={tooShort ? 'Too short' : null}
        onChange={(e) => setNext(e.target.value)}
      />
      <PasswordField
        label="Confirm new password"
        autoComplete="new-password"
        value={confirm}
        error={mismatch ? 'Passwords do not match' : null}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error && <Alert severity="danger">{error}</Alert>}
      {done && <Alert severity="ok">Password changed.</Alert>}
      <Button type="submit" size="md" block disabled={busy || !valid}>
        Change password
      </Button>
    </form>
  );
}

export function SecurityScreen() {
  const nav = useNav();
  const phrases = useWallet().state?.phrases;
  return (
    <PopupScreen title="Password & recovery phrase" onBack={nav.back} scroll>
      <div className="flex flex-col gap-1.5 px-3 pb-3 pt-2.5">
        <SectionLabel>Recovery phrase</SectionLabel>
        <ListGroup>
          <div className="p-3">
            {phrases === 0 ? (
              <p className="m-0 text-[12px] leading-[1.45] text-muted">
                This wallet has no recovery phrase. Your imported keys are backed up only by your own copies of them. Add account → New account creates a phrase.
              </p>
            ) : (
              <RevealPhrase />
            )}
          </div>
        </ListGroup>
        <div className="mt-4">
          <SectionLabel>Password</SectionLabel>
        </div>
        <ListGroup>
          <div className="p-3">
            <ChangePassword />
          </div>
        </ListGroup>
      </div>
    </PopupScreen>
  );
}
