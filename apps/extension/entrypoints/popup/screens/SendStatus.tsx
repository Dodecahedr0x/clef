import { useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Button, EmptyState, Icon, PopupScreen, Pubkey, Spinner } from '../../../components';
import { useWallet } from '../../../lib/hooks';
import { explorerUrl } from '../../../lib/network';

type Outcome = 'confirmed' | 'failed' | 'expired';
export type Phase = 'sending' | Outcome | 'unknown';

/** What tracks a sent transaction: the popup's portfolio reader (polls `getSignatureStatuses`). */
export type Confirmer = {
  confirm(signature: string, lastValidBlockHeight: bigint): Promise<Outcome>;
  getLatestBlockhash(): Promise<{ lastValidBlockHeight: bigint }>;
};

const WORDS: Record<Phase, { send: string; swap: string; body: string }> = {
  sending: { send: 'Sending…', swap: 'Swapping…', body: 'Waiting for the network to confirm it.' },
  confirmed: { send: 'Sent', swap: 'Swapped', body: 'Confirmed by the network.' },
  failed: { send: 'Send failed', swap: 'Swap failed', body: 'It reached the network but failed, so nothing moved. Only the network fee was charged.' },
  expired: { send: "Didn't go through", swap: "Didn't go through", body: 'The network never processed it, so nothing was sent and no fee was charged. Try again.' },
  unknown: { send: "Couldn't confirm", swap: "Couldn't confirm", body: 'Clef lost touch with the RPC while waiting. Check Activity before trying again.' },
};

/**
 * After Send or Swap: "Sent" only once the network confirms it. Until then the transaction is pending, and one that
 * expires unprocessed says so, rather than looking like a success that never shows up in the balance.
 * `lastValidBlockHeight` is that of the signed transaction; without it (a multisig proposal), the current one.
 */
export function SendStatus({
  kind,
  what,
  signature,
  lastValidBlockHeight,
  confirmer,
  onDone,
  onRetry,
}: {
  kind: 'send' | 'swap';
  what: ReactNode;
  signature: string;
  lastValidBlockHeight?: bigint;
  confirmer: Confirmer | null;
  onDone: () => void;
  onRetry: () => void;
}) {
  const settings = useWallet().state?.settings;
  const [phase, setPhase] = useState<Phase>(signature ? 'sending' : 'unknown');

  useEffect(() => {
    if (!signature || !confirmer) return;
    let live = true;
    (async () => {
      const until = lastValidBlockHeight ?? (await confirmer.getLatestBlockhash()).lastValidBlockHeight;
      return confirmer.confirm(signature, until);
    })().then(
      (o) => live && setPhase(o),
      () => live && setPhase('unknown'),
    );
    return () => {
      live = false;
    };
  }, [signature, confirmer]);

  const words = WORDS[phase];
  const explorer = signature && settings ? explorerUrl(settings, signature) : null;
  const icon = phase === 'confirmed' ? 'check' : phase === 'sending' ? null : 'danger';
  return (
    <PopupScreen title={kind === 'send' ? 'Send' : 'Swap'} onBack={onDone}>
      <div role="status" aria-live="polite" className="flex flex-col items-center pt-6">
        <span aria-hidden="true" className={`flex size-12 items-center justify-center rounded-full ${phase === 'confirmed' ? 'bg-ok-bg text-ok' : phase === 'sending' ? 'bg-surface-2 text-muted' : 'bg-danger-bg text-danger-text'}`}>
          {icon ? <Icon name={icon} size={24} /> : <Spinner size={24} />}
        </span>
        <EmptyState
          title={words[kind]}
          body={
            <span className="flex flex-col items-center gap-1">
              <span>{what}</span>
              <span>{words.body}</span>
              {signature && <Pubkey value={signature} className="text-[12px] text-muted" />}
            </span>
          }
          action={
            <span className="flex flex-col items-center gap-2">
              {phase === 'expired' ? <Button onClick={onRetry}>Try again</Button> : <Button onClick={onDone}>Done</Button>}
              {explorer && (
                <button type="button" onClick={() => void browser.tabs.create({ url: explorer })} className="border-0 bg-transparent p-0 text-[12px] font-semibold text-info underline">
                  View on explorer
                </button>
              )}
            </span>
          }
        />
      </div>
    </PopupScreen>
  );
}
