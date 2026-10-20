import { useMemo, useState } from 'react';
import { Button } from '../../../components';
import { call } from '../../../lib/api';
import { useWallet } from '../../../lib/hooks';
import { useNav, useOnboardingDraft } from '../../../lib/nav';
import { OnboardingFrame, OnboardingHeader } from './CreatePassword';

const OPTIONS = 6;

function randomInt(n: number): number {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return r[0]! % n;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Three distinct 0-based positions, ascending, each with the right word and five distractors from the rest of the phrase.
function makeQuiz(words: string[]) {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(randomInt(words.length));
  return [...picked]
    .sort((a, b) => a - b)
    .map((pos) => {
      const word = words[pos]!;
      const others = shuffle([...new Set(words.filter((w) => w !== word))]).slice(0, OPTIONS - 1);
      return { pos, word, options: shuffle([word, ...others]) };
    });
}

export function ConfirmPhraseScreen() {
  const { refresh } = useWallet();
  const nav = useNav();
  const draft = useOnboardingDraft();
  const adding = nav.route.name === 'accounts/confirm-phrase';
  const words = useMemo(() => draft.mnemonic?.split(' ') ?? [], [draft.mnemonic]);
  const quiz = useMemo(() => (words.length ? makeQuiz(words) : []), [words]);
  const [done, setDone] = useState(0);
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = quiz[done];
  const complete = quiz.length > 0 && done === quiz.length;

  const pick = (w: string) => {
    if (!current) return;
    if (w === current.word) {
      setDone((d) => d + 1);
      setWrong(null);
    } else setWrong(w);
  };

  const finish = async () => {
    if (!complete || !draft.mnemonic || (!adding && !draft.password)) return;
    setBusy(true);
    setError(null);
    try {
      // Adding: the phrase joins the unlocked vault with its first account.
      if (adding) await call({ type: 'accounts:importMnemonic', mnemonic: draft.mnemonic, indexes: [0] });
      else await call({ type: 'vault:create', password: draft.password, mnemonic: draft.mnemonic });
      draft.clear();
      await refresh(); // the router must see the new vault before it routes home
      nav.reset({ name: 'home' });
    } catch (e) {
      setError(e instanceof Error ? e.message : adding ? 'Could not add the phrase' : 'Could not create the wallet');
      setBusy(false);
    }
  };

  const n = quiz.map((q) => q.pos + 1);
  return (
    <OnboardingFrame>
      {adding ? <OnboardingHeader step={2} total={2} /> : <OnboardingHeader step={3} />}
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Check your copy</h1>
      <p className="mt-2 text-[14px] leading-normal text-muted">Pick words {n[0]}, {n[1]} and {n[2]} from what you wrote down.</p>
      <div className="mt-5 flex flex-col gap-2 font-mono text-[14px]">
        {quiz.map((q, i) =>
          i < done ? (
            <div key={q.pos} className="flex h-12 items-center gap-3 rounded-[12px] border border-ok-line bg-surface px-3.5">
              <span className="text-[12px] text-muted">#{q.pos + 1}</span>
              <span className="flex-1">{q.word}</span>
              <span className="font-sans text-ok">✓</span>
            </div>
          ) : i === done ? (
            <div key={q.pos} className={`flex h-12 items-center gap-3 rounded-[12px] border-2 bg-surface px-3.5 ${wrong ? 'border-danger' : 'border-primary'}`}>
              <span className="text-[12px] text-muted">#{q.pos + 1}</span>
              <span className={`flex-1 font-sans ${wrong ? 'text-danger-text' : 'text-muted'}`}>{wrong ? `That's not word #${q.pos + 1}` : 'Choose below'}</span>
            </div>
          ) : (
            <div key={q.pos} className="flex h-12 items-center gap-3 rounded-[12px] border border-dashed border-line-strong bg-surface-2 px-3.5">
              <span className="text-[12px] text-muted">#{q.pos + 1}</span>
            </div>
          ),
        )}
      </div>
      {current && (
        <div role="group" aria-label={`Choose word ${current.pos + 1}`} className="mt-5 grid grid-cols-3 gap-2 font-mono">
          {current.options.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => pick(w)}
              className={`h-11 rounded-[10px] border bg-surface text-[14px] text-ink hover:border-primary ${wrong === w ? 'border-danger' : 'border-line-strong'}`}
            >
              {w}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-[12px] text-danger-text">{error}</p>}
      <Button block className="mt-auto" disabled={!complete || busy} onClick={finish}>{busy ? 'Encrypting…' : adding ? 'Create account' : 'Finish setup'}</Button>
    </OnboardingFrame>
  );
}
