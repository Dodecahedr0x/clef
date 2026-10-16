import { useState } from 'react';
import { Alert, EmptyState, Icon, PopupScreen, QrCode } from '../../../components';
import { useActiveAccount, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const NETWORK_NAME = { mainnet: 'Mainnet', devnet: 'Devnet', localnet: 'Localnet', custom: 'your custom network' } as const;

/** 4-character groups; the first and last group are what people compare. */
export function addressGroups(a: string): string[] {
  return a.match(/.{1,4}/g) ?? [];
}

export function ReceiveScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const account = useActiveAccount();
  const [copied, setCopied] = useState(false);

  if (!account) {
    return (
      <PopupScreen title="Receive" onBack={nav.back}>
        <EmptyState title="No account selected" />
      </PopupScreen>
    );
  }

  const groups = addressGroups(account.address);
  const network = state ? NETWORK_NAME[state.settings.network] : 'Mainnet';

  const copy = async () => {
    await navigator.clipboard.writeText(account.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const share = async () => {
    if (typeof navigator.share === 'function') await navigator.share({ text: account.address }).catch(() => undefined);
    else await copy();
  };

  return (
    <PopupScreen
      title="Receive"
      onBack={nav.back}
      right={
        <button
          type="button"
          aria-label="Switch account"
          onClick={() => nav.go({ name: 'accounts' })}
          className="h-9 flex items-center gap-2 px-2.5 bg-surface border border-line rounded-full text-ink text-[12px]"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-info-dot" />
          <span className="font-semibold">{account.label}</span>
          <span className="text-muted"><Icon name="chevron-down" size={12} /></span>
        </button>
      }
      footer={
        <div className="px-4 pb-3 flex flex-col gap-3">
          <Alert severity="info">
            Accepts SOL and any Solana token on <strong>{network}</strong>. Don’t send from other chains.
          </Alert>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => void copy()} className="h-12 flex items-center justify-center gap-2 bg-primary text-white border-0 rounded-[12px] text-[14px] font-semibold">
              <Icon name={copied ? 'check' : 'copy'} size={16} />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => void share()} className="h-12 flex items-center justify-center gap-2 bg-surface text-ink border border-line-strong rounded-[12px] text-[14px] font-medium">
              <Icon name="share" size={16} />
              Share
            </button>
          </div>
        </div>
      }
    >
      <div className="px-6 pt-4 flex flex-col items-center gap-4">
        <div className="p-4 bg-surface border border-line rounded-[20px]" role="img" aria-label={`QR code of your ${account.label} account address`}>
          <QrCode value={account.address} size={168} logo />
        </div>
        <div className="w-full flex flex-col gap-2">
          <span className="text-[12px] text-muted text-center">Your Solana address</span>
          <p data-testid="address-groups" className="m-0 px-3.5 py-3 bg-surface border border-line rounded-[12px] font-mono text-[14px] leading-[1.6] text-center [word-spacing:0.2em] break-words">
            {groups.map((g, i) => {
              const edge = i === 0 || i === groups.length - 1;
              return (
                <span key={i}>
                  {i > 0 && ' '}
                  {edge ? <strong className="font-semibold">{g}</strong> : g}
                </span>
              );
            })}
          </p>
          <span className="text-[12px] text-muted text-center">Check the first and last 4 characters match where you paste it.</span>
        </div>
      </div>
    </PopupScreen>
  );
}
