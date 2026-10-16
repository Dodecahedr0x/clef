import type { ApprovalDecision, ApprovalRequest, SignerInfo } from '@clef/wallet-core';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Spinner } from '../../components';
import { decide, getApproval, type FullState } from '../../lib/api';
import { useWallet } from '../../lib/hooks';
import { NavProvider, useNav } from '../../lib/nav';
import { deserializeApproval } from '../../lib/serialize';
import { UnlockScreen } from '../popup/screens/Unlock';
import { ConnectApproval, HardwareSignStep, MessageApproval, SignInApproval, SquadsApproval } from './requests';
import { siteName } from './requests/shared';
import { TxApproval } from './tx/TxApproval';


type HardwareSigner = Exclude<SignerInfo, { kind: 'software' }>;
type Signing = {
  signer: HardwareSigner;
  payloads: Uint8Array[];
  payloadKind: 'transaction' | 'message';
  resolve: (signatures: Uint8Array[]) => void;
  reject: (e: Error) => void;
};

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg p-6">{children}</div>;
}

/** Unlock inside the approval window; the request shows once the wallet is unlocked. */
function UnlockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const nav = useNav();
  useEffect(() => {
    if (nav.route.name !== 'unlock') onUnlocked();
  }, [nav.route.name, onUnlocked]);
  return <UnlockScreen />;
}

function Dispatch({ request, state, requestId }: { request: ApprovalRequest; state: FullState; requestId: string }) {
  const [signing, setSigning] = useState<Signing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDecide = useCallback(
    (d: ApprovalDecision) => {
      decide(requestId, d).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Clef did not accept the decision'));
    },
    [requestId],
  );

  // Hardware signers sign here, in the page (WebHID and the camera need a page); the background verifies every signature.
  const signWith = useCallback(
    (signer: SignerInfo | null, payloadKind: Signing['payloadKind']) =>
      signer && signer.kind !== 'software'
        ? (payloads: Uint8Array[]) =>
            new Promise<Uint8Array[]>((resolve, reject) => setSigning({ signer, payloads, payloadKind, resolve, reject }))
        : undefined,
    [],
  );

  if (error) {
    return (
      <Centered>
        <Alert severity="danger" title="Something went wrong">
          {error}
        </Alert>
      </Centered>
    );
  }

  const view = (() => {
  switch (request.kind) {
    case 'connect':
      return <ConnectApproval request={request} state={state} onDecide={onDecide} />;
    case 'signTransactions':
      return <TxApproval request={request} state={state} onDecide={onDecide} onSign={signWith(request.signer, 'transaction')} />;
    case 'signMessage':
      return <MessageApproval request={request} state={state} onDecide={onDecide} onSign={signWith(request.signer, 'message')} />;
    case 'signIn':
      return (
        <SignInApproval
          request={request}
          state={state}
          onDecide={onDecide}
          onSign={(payloads, signer) => {
            const sign = signWith(signer, 'message');
            return sign ? sign(payloads) : Promise.reject(new Error('This account signs without a hardware wallet'));
          }}
        />
      );
    case 'squadsPropose':
      return <SquadsApproval request={request} state={state} onDecide={onDecide} onSign={signWith(request.signer, 'transaction')} />;
  }
  })();

  // The request view stays mounted (hidden) while the device signs: its state, acknowledgement and any error from a
  // cancelled signing survive, and it cannot be approved twice.
  return (
    <>
      <div hidden={signing !== null}>{view}</div>
      {signing && (
        <HardwareSignStep
          signer={signing.signer}
          payloads={signing.payloads}
          payloadKind={signing.payloadKind}
          origin={request.origin}
          summary={signingSummary(request, signing.payloads.length)}
          accountLabel={state.accounts.find((a) => a.address === signing.signer.address)?.label}
          onSigned={(sigs) => {
            setSigning(null);
            signing.resolve(sigs);
          }}
          onCancel={() => {
            setSigning(null);
            signing.reject(new Error('Signing was cancelled. Nothing was signed.'));
          }}
        />
      )}
    </>
  );
}

/** What the hardware step says is being signed, so the user can match it against the device. */
function signingSummary(request: ApprovalRequest, count: number): string {
  const host = siteName(request.origin);
  switch (request.kind) {
    case 'signTransactions':
      return count === 1 ? `Sign a transaction for ${host}` : `Sign ${count} transactions for ${host}`;
    case 'squadsPropose':
      return `Propose and approve a multisig transaction for ${host}`;
    case 'signIn':
      return `Sign in to ${host}`;
    default:
      return `Sign a message for ${host}`;
  }
}

/** One approval request: in its own window (id from the URL) or in the side panel (id given, onClose returns to the wallet). */
export function Approval({ id, onClose }: { id?: string; onClose?: () => void } = {}) {
  const requestId = id ?? new URLSearchParams(location.search).get('id') ?? '';
  const { state, error, refresh } = useWallet();
  const [request, setRequest] = useState<ApprovalRequest | null | undefined>(undefined);

  useEffect(() => {
    setRequest(undefined);
    getApproval(requestId).then(
      (s) => setRequest(s ? deserializeApproval(s) : null),
      () => setRequest(null),
    );
  }, [requestId]);

  if (error) {
    return (
      <Centered>
        <Alert severity="danger" title="Clef did not respond">
          {error}
        </Alert>
      </Centered>
    );
  }
  if (!state || request === undefined) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (request === null) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-[14px] text-muted">This request is no longer available. It may have been answered or the site closed it.</p>
          <Button variant="secondary" onClick={() => (onClose ? onClose() : window.close())}>
            Close
          </Button>
        </div>
      </Centered>
    );
  }
  if (!state.unlocked) {
    return (
      <NavProvider initial={{ name: 'unlock' }}>
        <UnlockGate onUnlocked={() => void refresh()} />
      </NavProvider>
    );
  }
  return <Dispatch request={request} state={state} requestId={requestId} />;
}
