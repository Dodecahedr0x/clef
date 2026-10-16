import type { ApprovalDecision, ApprovalRequest, SignerInfo } from '@clef/wallet-core';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Spinner } from '../../components';
import { decide, getApproval, type FullState } from '../../lib/api';
import { useWallet } from '../../lib/hooks';
import { NavProvider, useNav } from '../../lib/nav';
import { deserializeApproval } from '../../lib/serialize';
import { UnlockScreen } from '../popup/screens/Unlock';
import { ConnectApproval, HardwareSignStep, MessageApproval, SignInApproval, SquadsApproval } from './requests';
import { TxApproval } from './tx/TxApproval';

const requestId = new URLSearchParams(location.search).get('id') ?? '';

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

function Dispatch({ request, state }: { request: ApprovalRequest; state: FullState }) {
  const [signing, setSigning] = useState<Signing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDecide = useCallback((d: ApprovalDecision) => {
    decide(requestId, d).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Clef did not accept the decision'));
  }, []);

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

  if (signing) {
    const done = () => setSigning(null);
    return (
      <HardwareSignStep
        signer={signing.signer}
        payloads={signing.payloads}
        payloadKind={signing.payloadKind}
        origin={request.origin}
        summary={null}
        onSigned={(sigs) => {
          done();
          signing.resolve(sigs);
        }}
        onCancel={() => {
          done();
          signing.reject(new Error('Signing cancelled on the hardware wallet step'));
        }}
      />
    );
  }

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
}

export function Approval() {
  const { state, error, refresh } = useWallet();
  const [request, setRequest] = useState<ApprovalRequest | null | undefined>(undefined);

  useEffect(() => {
    getApproval(requestId).then(
      (s) => setRequest(s ? deserializeApproval(s) : null),
      () => setRequest(null),
    );
  }, []);

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
          <Button variant="secondary" onClick={() => window.close()}>
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
  return <Dispatch request={request} state={state} />;
}
