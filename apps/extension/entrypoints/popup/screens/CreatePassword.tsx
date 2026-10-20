import { useState, type ReactNode } from 'react';
import { Button, IconButton, PasswordField, StepDots } from '../../../components';
import { useNav, useOnboardingDraft } from '../../../lib/nav';

export const MIN_PASSWORD = 8;

/** What `passwordScore(p) >= 2` asks for, said up front: the same rule for a new wallet and a changed password. */
export const PASSWORD_RULE = 'Use 12 or more characters, or 8 or more that mix three of: lowercase, uppercase, numbers, symbols.';
export const passwordOk = (p: string) => passwordScore(p) >= 2;

export function OnboardingHeader({ step, total = 3 }: { step: number; total?: number }) {
  const nav = useNav();
  return (
    <header className="-mx-3.5 flex h-14 flex-none items-center gap-1">
      <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
      <div className="ml-auto mr-3.5"><StepDots total={total} current={step} /></div>
    </header>
  );
}

export function OnboardingFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg px-5 pb-5 font-sans text-ink">{children}</div>;
}

// 0..4: length carries most of the weight; character variety adds one step.
export function passwordScore(p: string): number {
  if (p.length < MIN_PASSWORD) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const common = /^(password|12345678|qwerty|letmein|iloveyou)/i.test(p) || /^(.)\1+$/.test(p);
  if (common) return 1;
  let score = 1;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  if (classes >= 3) score++;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: 'Too short', color: 'bg-danger', text: 'text-danger-text' },
  { label: 'Weak', color: 'bg-danger', text: 'text-danger-text' },
  { label: 'Fair', color: 'bg-warn', text: 'text-warn' },
  { label: 'Strong', color: 'bg-ok', text: 'text-ok' },
  { label: 'Very strong', color: 'bg-ok', text: 'text-ok' },
] as const;

/** Four bars and a word; says nothing until something is typed. */
export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password);
  const s = STRENGTH[score]!;
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 rounded-[2px] ${i <= Math.max(score, 1) ? s.color : 'bg-line-strong'}`} />)}
      </div>
      <span className={`text-[12px] ${s.text}`}>{s.label}</span>
    </div>
  );
}

export function CreatePasswordScreen() {
  const nav = useNav();
  const draft = useOnboardingDraft();
  const next = nav.route.name === 'create-password' ? nav.route.next : 'create';
  const tab = nav.route.name === 'create-password' ? nav.route.tab : undefined;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const match = confirm.length > 0 && confirm === password;
  const valid = passwordOk(password) && match;

  const submit = () => {
    if (!valid) return;
    draft.set({ password });
    nav.go(next === 'create' ? { name: 'recovery-phrase' } : { name: 'import', ...(tab && { tab }) });
  };

  return (
    <OnboardingFrame>
      <OnboardingHeader step={1} />
      <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">Set a password</h1>
      <p className="mt-2 text-[14px] leading-normal text-muted">It unlocks Clef on this device. It can’t be recovered — your recovery phrase can.</p>
      <form
        className="mt-6 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} hint={PASSWORD_RULE} autoFocus />
        <StrengthMeter password={password} />
        <div className="mt-2.5">
          <PasswordField label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {confirm.length > 0 &&
          (match ? <span className="text-[12px] text-ok">✓ Passwords match</span> : <span className="text-[12px] text-danger-text">Passwords don’t match</span>)}
        <button type="submit" hidden />
      </form>
      <Button block className="mt-auto" disabled={!valid} onClick={submit}>Continue</Button>
    </OnboardingFrame>
  );
}
