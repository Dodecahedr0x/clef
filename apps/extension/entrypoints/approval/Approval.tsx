import type { ApprovalDecision, ApprovalRequest, WalletState } from '@clef/wallet-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui';
import { decide, getApproval, getState, shortAddress } from '../../lib/api';
import { deserializeApproval } from '../../lib/serialize';
import { Unlock } from '../popup/Onboarding';
import { MessageReview, messageDanger } from './MessageReview';
import { hasDanger, TxReview, useExplanations } from './TxReview';

const requestId = new URLSearchParams(location.search).get('id') ?? '';

const TITLES: Record<ApprovalRequest['kind'], string> = {
  connect: 'Connect to this site?',
  signTransactions: 'Review transaction',
  signMessage: 'Sign message?',
  signIn: 'Sign in with Solana?',
};

function Origin({ origin }: { origin: string }) {
  const url = new URL(origin);
  return (
    <div className="rounded-lg bg-gray-900 px-3 py-2">
      <div className="text-xs text-gray-500">Request from</div>
      <div className="font-mono text-sm">
        <span className={url.protocol === 'https:' ? 'text-gray-500' : 'text-amber-300'}>{url.protocol}//</span>
        <span className="font-semibold text-gray-100">{url.host}</span>
      </div>
    </div>
  );
}

function AccountPicker({ state, multiple, selected, onChange }: { state: WalletState; multiple: boolean; selected: string[]; onChange: (s: string[]) => void }) {
  const signable = state.accounts.filter((a) => a.kind !== 'watch');
  return (
    <ul className="space-y-2">
      {signable.map((a) => (
        <li key={a.address}>
          <label className="flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm">
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name="account"
              checked={selected.includes(a.address)}
              onChange={(e) =>
                onChange(multiple ? (e.target.checked ? [...selected, a.address] : selected.filter((s) => s !== a.address)) : [a.address])
              }
            />
            <span>{a.label}</span>
            <span className="font-mono text-xs text-gray-400">{shortAddress(a.address)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function Review({ request, state }: { request: ApprovalRequest; state: WalletState }) {
  const firstSignable = state.accounts.find((a) => a.kind !== 'watch')?.address;
  const [selected, setSelected] = useState<string[]>(firstSignable ? [firstSignable] : []);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const transactions = useMemo(() => (request.kind === 'signTransactions' ? request.transactions : []), [request]);
  const explanations = useExplanations(transactions, state);

  const accountLabel = (address: string | null) => {
    if (!address) return null;
    const a = state.accounts.find((x) => x.address === address);
    return `${a?.label ?? 'Unknown account'} (${shortAddress(address)})`;
  };

  let danger = false;
  let ready = true;
  if (request.kind === 'signTransactions') {
    danger = explanations.some(hasDanger);
    ready = explanations.every((r) => r.status !== 'loading');
  } else if (request.kind === 'signMessage') {
    danger = messageDanger(request.message, request.origin);
  }
  const needsAccount = request.kind === 'connect' || (request.kind === 'signIn' && request.account === null);
  const canApprove = ready && (!danger || acknowledged) && (!needsAccount || selected.length > 0) && !busy;

  const finish = async (decision: ApprovalDecision) => {
    setBusy(true);
    try {
      await decide(requestId, decision);
    } finally {
      window.close();
    }
  };

  const approve = () => {
    if (request.kind === 'connect') return finish({ approved: true, accounts: selected });
    if (request.kind === 'signIn' && request.account === null) return finish({ approved: true, account: selected[0] });
    return finish({ approved: true });
  };

  return (
    <div className="flex min-h-screen flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">{TITLES[request.kind]}</h1>
      <Origin origin={request.origin} />
      {'account' in request && request.account && <div className="text-sm text-gray-400">Account: {accountLabel(request.account)}</div>}

      {request.kind === 'connect' && (
        <>
          <p className="text-sm text-gray-400">The site will see the selected addresses and can ask you to sign. It cannot move funds without your approval.</p>
          <AccountPicker state={state} multiple selected={selected} onChange={setSelected} />
        </>
      )}
      {request.kind === 'signTransactions' && (
        <div className="space-y-3">
          {explanations.map((r, i) => (
            <TxReview key={i} index={i} total={explanations.length} result={r} />
          ))}
        </div>
      )}
      {request.kind === 'signMessage' && <MessageReview message={request.message} origin={request.origin} />}
      {request.kind === 'signIn' && (
        <div className="space-y-2 text-sm">
          <p>
            Sign in to <span className="font-semibold">{request.input.domain}</span>
          </p>
          {request.input.statement && <p className="rounded-lg bg-gray-900 p-3">{request.input.statement}</p>}
          {request.account === null && <AccountPicker state={state} multiple={false} selected={selected} onChange={setSelected} />}
        </div>
      )}

      <div className="mt-auto space-y-3 pt-2">
        {danger && (
          <label className="flex items-start gap-2 rounded-lg border border-red-500 p-3 text-sm text-red-200">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            I understand the risks and want to continue anyway.
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => finish({ approved: false })}>
            Reject
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!canApprove} onClick={approve}>
            {request.kind === 'signTransactions' && request.send ? 'Approve and send' : request.kind === 'connect' ? 'Connect' : 'Approve'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Approval() {
  const [request, setRequest] = useState<ApprovalRequest | null | undefined>(undefined);
  const [state, setState] = useState<WalletState | null>(null);

  const load = useCallback(async () => {
    const [serialized, s] = await Promise.all([getApproval(requestId), getState()]);
    setRequest(serialized ? deserializeApproval(serialized) : null);
    setState(s);
  }, []);

  useEffect(() => {
    void load().catch(() => setRequest(null));
  }, [load]);

  if (request === undefined || (request && !state)) return null;
  if (request === null || !state) {
    return (
      <div className="flex min-h-screen flex-col justify-center gap-4 p-6 text-center">
        <p className="text-sm text-gray-400">This request is no longer pending.</p>
        <Button variant="secondary" onClick={() => window.close()}>
          Close
        </Button>
      </div>
    );
  }
  if (!state.unlocked) return <Unlock onDone={() => void load()} />;
  return <Review request={request} state={state} />;
}
