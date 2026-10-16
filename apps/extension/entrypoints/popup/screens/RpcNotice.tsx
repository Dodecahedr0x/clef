import { DEFAULT_RPC } from '@clef/wallet-core';
import { useState } from 'react';
import { useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const DISMISSED = 'clef.rpcNoticeDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * The default mainnet RPC is free and accepts browsers but blocks token-account scans and keeps little history.
 * Offers to add a provider URL; dismissible, except when tokens actually failed to load.
 */
export function RpcNotice({ tokensUnavailable = false, className = '' }: { tokensUnavailable?: boolean; className?: string }) {
  const nav = useNav();
  const { state } = useWallet();
  const [dismissed, setDismissed] = useState(readDismissed);
  const s = state?.settings;
  const onDefault = s?.network === 'mainnet' && s.rpcUrl === DEFAULT_RPC.mainnet;
  if (!tokensUnavailable && (!onDefault || dismissed)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* per-viewer convenience only */
    }
  };
  return (
    <div role="note" className={`${className} mx-4 mb-3 rounded-[12px] border border-info-bg bg-info-bg px-3 py-2.5 text-[12px] leading-normal text-info-ink`}>
      <p className="m-0">
        {tokensUnavailable
          ? 'This RPC would not list your tokens, so only SOL is shown.'
          : 'You are on a free public RPC: token holdings and history can be missing.'}{' '}
        Add your own provider URL (a free Helius or QuickNode key works) for the full picture.
      </p>
      <div className="mt-1.5 flex gap-3">
        <button type="button" onClick={() => nav.go({ name: 'settings/network' })} className="border-0 bg-transparent p-0 text-[12px] font-semibold text-info-ink underline">
          Add a provider
        </button>
        {!tokensUnavailable && (
          <button type="button" onClick={dismiss} className="border-0 bg-transparent p-0 text-[12px] text-info-ink">
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
