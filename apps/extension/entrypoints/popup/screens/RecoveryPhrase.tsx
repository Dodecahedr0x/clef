import { useEffect, useState } from 'react';
import { Button, Icon, Spinner } from '../../../components';
import { call } from '../../../lib/api';
import { useNav, useOnboardingDraft } from '../../../lib/nav';
import { OnboardingFrame, OnboardingHeader } from './CreatePassword';

export function RecoveryPhraseScreen() {
  const nav = useNav();
  const draft = useOnboardingDraft();
  // Adding a first phrase to a wallet started from a private key or watch-only, rather than onboarding.
  const adding = nav.route.name === 'accounts/new-phrase';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft.mnemonic) return;
    let live = true;
    call<{ mnemonic: string }>({ type: 'mnemonic:generate' })
      .then((r) => live && draft.set({ mnemonic: r.mnemonic }))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not create a phrase'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mnemonic]);

  const words = draft.mnemonic?.split(' ') ?? [];
  return (
    <OnboardingFrame>
      {adding ? <OnboardingHeader step={1} total={2} /> : <OnboardingHeader step={2} />}
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Your recovery phrase</h1>
      <p className="mt-2 text-[14px] leading-normal text-muted">
        {adding
          ? `New accounts come from this phrase. Write these ${words.length || 12} words on paper, in order: they’re the only way to recover those accounts if you lose this device.`
          : `Write these ${words.length || 12} words on paper, in order. They’re the only way back in if you lose this device.`}
      </p>
      {words.length === 0 ? (
        <div className="mt-[18px] flex h-[236px] items-center justify-center rounded-[14px] border border-line bg-surface">
          {error ? <span className="text-[12px] text-danger-text">{error}</span> : <Spinner />}
        </div>
      ) : (
        <ol className="m-0 mt-[18px] grid list-none grid-cols-2 gap-x-3 gap-y-2 rounded-[14px] border border-line bg-surface p-3 font-mono text-[14px]">
          {words.map((w, i) => (
            <li key={i} className="flex h-8 items-center gap-2.5 rounded-[8px] bg-surface-3 px-2.5">
              <span className="w-[18px] text-right text-[12px] text-faint">{i + 1}</span>
              {w}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex gap-2.5 rounded-[12px] border border-danger-line bg-danger-bg px-3 py-2.5 text-[12px] leading-[1.45] text-danger-ink">
        <span className="mt-px flex-none text-danger"><Icon name="danger" size={16} /></span>
        <span>Anyone with these words owns your funds. Clef will never ask for them — not in a site, popup or message.</span>
      </div>
      <Button block className="mt-auto" disabled={words.length === 0} onClick={() => nav.go({ name: adding ? 'accounts/confirm-phrase' : 'confirm-phrase' })}>I wrote them down</Button>
    </OnboardingFrame>
  );
}
