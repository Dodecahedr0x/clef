import type { ApprovalDecision, ApprovalRequest, SignerInfo } from '@clef/wallet-core';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, ErrorNote, NetworkEdge, Spinner } from '../../components';
import { decide, getApproval, pingApproval, type FullState } from '../../lib/api';
import type { ErrorText } from '../../lib/error-text';
import { useWallet } from '../../lib/hooks';
import { NavProvider, useNav } from '../../lib/nav';
import { clusterOf, clusterOfChain } from '../../lib/network';
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

/** How often an open approval tells the background it is still there (Chrome stops an idle worker after ~30 s). */
export const APPROVAL_PING_MS = 20_000;

/** The answer did not reach Clef: say what that means for the site, and what to check. */
export function decisionErrorText(d: ApprovalDecision, e: unknown): ErrorText {
  const detail = e instanceof Error && e.message ? e.message : undefined;
  return d.approved
    ? { tone: 'danger', title: "Clef couldn't complete your approval", body: 'Close this window, then check the site and Activity before trying again.', detail }
    : { tone: 'danger', title: "Clef couldn't record your rejection", body: 'Nothing was signed. Close this window; the site may still show the request as waiting.', detail };
}

function Dispatch({ request, state, requestId, onClose }: { request: ApprovalRequest; state: FullState; requestId: string; onClose?: () => void }) {
  const [signing, setSigning] = useState<Signing | null>(null);
  const [error, setError] = useState<ErrorText | null>(null);
  const [gone, setGone] = useState(false);

  // Keeps the service worker, which holds the pending request, alive while the user is in another window; and
  // checks right away when they come back, so a request lost meanwhile never leaves a window that ignores clicks.
  useEffect(() => {
    const check = () => {
      pingApproval(requestId).then(
        (r) => !r.pending && setGone(true),
        () => {},
      );
    };
    const timer = setInterval(check, APPROVAL_PING_MS);
    const onBack = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [requestId]);

  const onDecide = useCallback(
    (d: ApprovalDecision) => {
      decide(requestId, d).then(
        (r) => r?.gone && setGone(true),
        (e: unknown) => setError(decisionErrorText(d, e)),
      );
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

  if (gone) {
    return (
      <Centered>
        <div className="flex max-w-[320px] flex-col items-center gap-4 text-center">
          <Alert severity="warn" title="This request expired">
            Clef was restarted while it waited, so the site no longer listens for an answer. Nothing was signed. Go back to the site and try again.
          </Alert>
          <Button variant="secondary" onClick={() => (onClose ? onClose() : window.close())}>
            Close
          </Button>
        </div>
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <div className="flex max-w-[320px] flex-col items-center gap-4">
          <ErrorNote text={error} />
          <Button variant="secondary" onClick={() => (onClose ? onClose() : window.close())}>
            Close
          </Button>
        </div>
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
      <NetworkEdge cluster={'chain' in request ? clusterOfChain(request.chain) : clusterOf(state.settings)} tint={state.settings.devnetTint} />
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
          <p className="text-sm text-muted">This request is no longer available. It may have been answered or the site closed it.</p>
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
  return <Dispatch request={request} state={state} requestId={requestId} {...(onClose && { onClose })} />;
}
