import { generateMnemonic, validateMnemonic } from '@clef/vault';
import { useMemo, useState } from 'react';
import { Button, ErrorText, Field, Screen } from '../../components/ui';
import { call } from '../../lib/api';

const MIN_PASSWORD = 8;

function PasswordStep({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_PASSWORD && confirm === password;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(password);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Password (at least 8 characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={tooShort ? 'Too short' : null} />
      <Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Passwords do not match' : null} />
      <ErrorText error={error} />
      <Button type="submit" className="w-full" disabled={!valid || busy}>
        {busy ? 'Encrypting...' : submitLabel}
      </Button>
    </form>
  );
}

/** Three distinct random word positions the user must type back. */
function pickPositions(count: number, total: number): number[] {
  const picked = new Set<number>();
  const rand = new Uint32Array(1);
  while (picked.size < count) {
    crypto.getRandomValues(rand);
    picked.add(rand[0]! % total);
  }
  return [...picked].sort((a, b) => a - b);
}

export function Create({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mnemonic, setMnemonic] = useState(() => generateMnemonic(12));
  const words = mnemonic.split(' ');
  const [step, setStep] = useState<'show' | 'confirm' | 'password'>('show');
  const [written, setWritten] = useState(false);
  const positions = useMemo(() => pickPositions(3, words.length), [mnemonic]);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const confirmed = positions.every((p, i) => answers[i]!.trim().toLowerCase() === words[p]);

  if (step === 'show') {
    return (
      <Screen title="Your recovery phrase" onBack={onBack}>
        <p className="text-sm text-gray-400">Write these 12 words down, in order, and keep them offline. Anyone with them controls your funds.</p>
        <ol className="grid grid-cols-3 gap-2 font-mono text-sm">
          {words.map((w, i) => (
            <li key={i} className="rounded bg-gray-900 px-2 py-1">
              <span className="text-gray-500">{i + 1}.</span> {w}
            </li>
          ))}
        </ol>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} /> I have written it down
        </label>
        <Button disabled={!written} onClick={() => setStep('confirm')}>
          Continue
        </Button>
      </Screen>
    );
  }
  if (step === 'confirm') {
    return (
      <Screen title="Confirm your phrase" onBack={() => setStep('show')}>
        {positions.map((p, i) => (
          <Field
            key={p}
            label={`Word #${p + 1}`}
            value={answers[i]}
            onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
        <Button disabled={!confirmed} onClick={() => setStep('password')}>
          Continue
        </Button>
      </Screen>
    );
  }
  return (
    <Screen title="Set a password" onBack={() => setStep('confirm')}>
      <p className="text-sm text-gray-400">The password unlocks Clef on this device. It cannot recover your wallet; the phrase can.</p>
      <PasswordStep
        submitLabel="Create wallet"
        onSubmit={async (password) => {
          await call({ type: 'vault:create', password, mnemonic });
          setMnemonic(''); // drop the phrase from memory as soon as it is stored
          onDone();
        }}
      />
    </Screen>
  );
}

export function Import({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [phrase, setPhrase] = useState('');
  const valid = validateMnemonic(phrase);
  return (
    <Screen title="Import a recovery phrase" onBack={onBack}>
      <label className="block space-y-1 text-sm">
        <span className="text-gray-400">Recovery phrase (12 or 24 words)</span>
        <textarea
          className="h-28 w-full rounded-lg border border-gray-700 bg-gray-900 p-3 font-mono text-sm outline-none focus:border-violet-400"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {phrase.trim() && !valid && <span className="text-red-400">Not a valid recovery phrase</span>}
      </label>
      {valid && (
        <PasswordStep
          submitLabel="Import wallet"
          onSubmit={async (password) => {
            await call({ type: 'vault:create', password, mnemonic: phrase });
            setPhrase('');
            onDone();
          }}
        />
      )}
    </Screen>
  );
}

export function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="flex h-full flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold text-violet-300">Clef</h1>
      <p className="text-sm text-gray-400">A Solana wallet that explains what you sign.</p>
      <Button onClick={onCreate}>Create a new wallet</Button>
      <Button variant="secondary" onClick={onImport}>
        Import a recovery phrase
      </Button>
    </div>
  );
}

export function Unlock({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex h-full flex-col justify-center gap-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await call({ type: 'vault:unlock', password });
          setPassword('');
          onDone();
        } catch (err) {
          setError(err instanceof Error && err.message === 'Wrong password' ? 'Wrong password' : 'Could not unlock');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-center text-2xl font-bold text-violet-300">Clef</h1>
      <Field label="Password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      <ErrorText error={error} />
      <Button type="submit" disabled={!password || busy}>
        {busy ? 'Unlocking...' : 'Unlock'}
      </Button>
    </form>
  );
}
