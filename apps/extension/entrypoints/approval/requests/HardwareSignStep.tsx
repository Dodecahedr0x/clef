import { keystoneSignRequest, LedgerDevice, parseKeystoneSignature, transactionMessageBytes, UrFrameDecoder, type HardwareErrorCode } from '@clef/signers';
import type { SignerInfo } from '@clef/wallet-core';
import { getBase58Decoder } from '@solana/kit';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatedQr } from '../../../components';
import { shortAddress } from '../../../lib/format';
import { cameraScanner, type QrScanner } from './scanner';
import { Footer, Header, Page, siteName, SiteMark, SingleFooter } from './shared';

type HardwareSigner = Exclude<SignerInfo, { kind: 'software' }>;
type Props = {
  signer: HardwareSigner;
  payloads: Uint8Array[];
  payloadKind: 'transaction' | 'message';
  origin: string;
  summary: ReactNode;
  onSigned: (signatures: Uint8Array[]) => void;
  onCancel: () => void;
  accountLabel?: string;
  scanner?: QrScanner;
};

/** What the device signs: a transaction's message bytes, or the message itself. */
const signedBytes = (payload: Uint8Array, kind: Props['payloadKind']) => (kind === 'transaction' ? transactionMessageBytes(payload) : payload);

/** base58(sha256(message)) in 4-char groups: what the Ledger shows when it blind-signs. */
export async function blindSigningHash(message: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', message as BufferSource));
  return getBase58Decoder().decode(digest).match(/.{1,4}/g)!.join(' ');
}

export function HardwareSignStep(p: Props) {
  const label = p.accountLabel ?? shortAddress(p.signer.address);
  const header = (
    <Header mark={<SiteMark text={siteName(p.origin)} size={28} />} title={p.summary} subtitle={`${siteName(p.origin)} · ${label}`} />
  );
  return (
    <Page>
      {header}
      {p.signer.kind === 'ledger' ? <LedgerSign {...p} signer={p.signer} label={label} /> : <KeystoneSign {...p} signer={p.signer} />}
    </Page>
  );
}

const LEDGER_ERRORS: Record<HardwareErrorCode, [string, string]> = {
  rejected: ['You rejected it on the Ledger', 'Nothing was signed. Retry to send it to the device again.'],
  locked: ['Unlock your Ledger', 'Enter your PIN on the device, then retry.'],
  'app-not-open': ['Open the Solana app on your Ledger', 'Then retry.'],
  'blind-signing-required': ['Turn on blind signing', 'In the Solana app on your Ledger, open Settings and enable Blind signing, then retry.'],
  'wrong-address': ['This Ledger holds a different account', 'Connect the Ledger this account was added from, then retry.'],
  'no-device': ['Ledger not connected', 'Plug in and unlock your Ledger, then retry.'],
  disconnected: ['Ledger disconnected', 'Plug it back in and unlock it, then retry.'],
  timeout: ['The Ledger did not answer in time', 'Check the device and retry.'],
  unsupported: ['This browser cannot reach USB devices', 'Clef needs WebHID (Chrome 137 or later).'],
  unknown: ['Something went wrong talking to the Ledger', 'Retry, or reconnect the device.'],
};

const codeOf = (e: unknown): HardwareErrorCode => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code in LEDGER_ERRORS ? (code as HardwareErrorCode) : 'unknown';
};

type Mark = 'done' | 'active' | 'todo' | 'failed';

function StepMark({ mark }: { mark: Mark }) {
  if (mark === 'done') return <span className="w-[14px] font-semibold text-ok">✓</span>;
  if (mark === 'failed') return <span className="w-[14px] font-semibold text-danger-text">✕</span>;
  if (mark === 'active')
    return (
      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
    );
  return <span aria-hidden="true" className="h-[14px] w-[14px] rounded-full border-2 border-line-strong" />;
}

function Step({ mark, children, right, first }: { mark: Mark; children: ReactNode; right?: ReactNode; first?: boolean }) {
  return (
    <li className={`flex min-h-10 items-center gap-[10px] ${first ? '' : 'border-t border-line-soft'}`}>
      <StepMark mark={mark} />
      <span className={`flex-1 ${mark === 'active' ? 'font-semibold' : ''}`}>{children}</span>
      {right}
    </li>
  );
}

function LedgerSign({ signer, label, payloads, payloadKind, onSigned, onCancel }: Props & { signer: Extract<HardwareSigner, { kind: 'ledger' }>; label: string }) {
  const device = useRef<LedgerDevice | null>(null);
  const signatures = useRef<Uint8Array[]>([]);
  const started = useRef(false);
  const [connected, setConnected] = useState(false);
  const [app, setApp] = useState<string | null>(null);
  const [addressOk, setAddressOk] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [needDevice, setNeedDevice] = useState(false);
  const [error, setError] = useState<HardwareErrorCode | null>(null);
  const [done, setDone] = useState(false);

  const flow = useCallback(
    async (obtain: () => Promise<LedgerDevice | null>) => {
      setError(null);
      setNeedDevice(false);
      try {
        const dev = device.current ?? (await obtain());
        if (!dev) return setNeedDevice(true);
        device.current = dev;
        setConnected(true);
        const cfg = await dev.getAppConfig();
        setApp(cfg.version);
        const address = await dev.getAddress(signer.path);
        if (address !== signer.address) {
          device.current = null;
          await dev.close().catch(() => {});
          throw Object.assign(new Error('wrong address'), { code: 'wrong-address' });
        }
        setAddressOk(true);
        for (let i = signatures.current.length; i < payloads.length; i++) {
          setIndex(i);
          const bytes = signedBytes(payloads[i]!, payloadKind);
          if (payloadKind === 'transaction') setHash(await blindSigningHash(bytes));
          const sig = payloadKind === 'transaction' ? await dev.signTransaction(signer.path, bytes) : await dev.signMessage(signer.path, bytes);
          signatures.current.push(sig);
        }
        setDone(true);
        await dev.close().catch(() => {});
        device.current = null;
        onSigned([...signatures.current]);
      } catch (e) {
        const code = codeOf(e);
        if (code === 'no-device' || code === 'disconnected') device.current = null;
        setError(code);
      }
    },
    [signer, payloads, payloadKind, onSigned],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void flow(() => LedgerDevice.reconnect());
  }, [flow]);

  const cancel = () => {
    void device.current?.close().catch(() => {});
    device.current = null;
    onCancel();
  };

  const multiple = payloads.length > 1;
  const signing = index !== null && !done;
  const failedAt = error === null ? null : !connected ? 0 : app === null ? 1 : !addressOk ? 2 : 3;
  const mark = (step: number, ok: boolean): Mark => (failedAt === step ? 'failed' : ok ? 'done' : failedAt === null && step === [connected, app !== null, addressOk].indexOf(false) ? 'active' : 'todo');
  const [title, detail] = error ? LEDGER_ERRORS[error] : [null, null];

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-6">
        <div aria-hidden="true" className="box-border flex h-16 w-[220px] items-center gap-[14px] self-center rounded-3xl bg-ink px-[14px]">
          <div className="flex h-9 flex-1 items-center justify-center rounded-sm bg-[#2A2F3A] font-mono text-xs text-white">
            {payloadKind === 'transaction' ? 'Review transaction' : 'Sign message'}
          </div>
          <span className="h-[18px] w-[18px] rounded-full border-2 border-faint" />
        </div>
        <h1 className="m-0 text-center text-xl font-semibold">Confirm on your Ledger</h1>

        {needDevice && (
          <button type="button" className="h-12 cursor-pointer rounded-2xl border-0 bg-primary text-sm font-semibold text-white" onClick={() => void flow(() => LedgerDevice.request())}>
            Connect Ledger
          </button>
        )}

        <ol className="m-0 flex list-none flex-col rounded-2xl border border-line bg-surface px-[14px] py-1 text-sm">
          <Step first mark={mark(0, connected)}>
            Connected over USB
          </Step>
          <Step mark={mark(1, app !== null)} right={app && <span className="text-xs text-muted">{`v${app}`}</span>}>
            Solana app open
          </Step>
          <Step mark={mark(2, addressOk)} right={<span className="font-mono text-xs text-muted">{signer.path}</span>}>
            {`Address matches ${label}`}
          </Step>
          {addressOk && (
            <Step mark={done ? 'done' : failedAt === 3 ? 'failed' : 'active'} right={multiple && index !== null && <span className="text-xs text-muted">{`${index + 1} of ${payloads.length}`}</span>}>
              {done ? 'Signed' : 'Waiting for approval on device…'}
            </Step>
          )}
        </ol>

        {error && title && (
          <section role="alert" className="flex flex-col gap-2 rounded-2xl border border-danger-line bg-danger-bg px-[14px] py-3 text-xs leading-[1.45] text-danger-ink">
            <strong className="text-sm text-danger-ink-2">{title}</strong>
            <span>{error === 'wrong-address' ? `${detail} Expected ${shortAddress(signer.address)}.` : detail}</span>
            <button
              type="button"
              className="h-9 cursor-pointer self-start rounded-xl border border-line-strong bg-surface px-4 text-sm font-medium text-ink"
              onClick={() => void flow(() => LedgerDevice.reconnect())}
            >
              Retry
            </button>
          </section>
        )}

        {signing && payloadKind === 'transaction' && hash && (
          <section className="flex flex-col gap-1.5 rounded-2xl border border-warn-line bg-warn-bg px-[14px] py-3 text-xs leading-[1.45] text-warn-ink">
            <strong className="text-sm">Your Ledger may show a hash, not the details</strong>
            <span>If the Ledger can’t decode this transaction, blind signing must be on. Check the device shows this hash:</span>
            <span className="font-mono text-sm tracking-[0.02em] text-ink">{hash}</span>
          </section>
        )}
      </div>
      <SingleFooter label="Cancel" onClick={cancel} />
    </>
  );
}

function KeystoneSign({ signer, payloads, payloadKind, origin, onSigned, onCancel, scanner = cameraScanner }: Props & { signer: Extract<HardwareSigner, { kind: 'keystone' }> }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'show' | 'scan'>('show');
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const signatures = useRef<Uint8Array[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const signed = useRef(onSigned);
  signed.current = onSigned;

  const request = useMemo(
    () => keystoneSignRequest({ data: signedBytes(payloads[index]!, payloadKind), kind: payloadKind, path: signer.path, xfp: signer.xfp, address: signer.address, origin }),
    [payloads, index, payloadKind, signer, origin],
  );

  useEffect(() => {
    if (phase !== 'scan' || error || !video.current) return;
    let stop: (() => void) | null = null;
    let finished = false;
    let cancelled = false;
    const decoder = new UrFrameDecoder();
    const finish = () => {
      finished = true;
      stop?.();
    };
    scanner
      .start(video.current, (text) => {
        if (finished) return;
        try {
          decoder.receive(text);
        } catch {
          return; // not a UR frame; keep scanning
        }
        setProgress(decoder.progress());
        if (!decoder.isComplete()) return;
        finish();
        try {
          signatures.current.push(parseKeystoneSignature(decoder.result(), request.requestId));
        } catch {
          setError('That QR is not the signature for this request. On your Keystone, sign this request, then scan the signature it shows.');
          return;
        }
        if (signatures.current.length === payloads.length) signed.current([...signatures.current]);
        else {
          setIndex(signatures.current.length);
          setPhase('show');
          setProgress(0);
        }
      })
      .then((s) => {
        stop = s;
        if (finished || cancelled) s();
      })
      .catch((e: unknown) => setError(`Camera unavailable: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [phase, attempt, error, scanner, request, payloads.length]);

  const stepClass = (active: boolean) => `rounded-xl px-[10px] py-2 ${active ? 'bg-ink font-semibold text-white' : 'border border-line bg-surface text-muted'}`;

  return (
    <>
      <ol className="m-0 grid list-none grid-cols-2 gap-2 px-4 pt-[14px] text-xs">
        <li aria-current={phase === 'show' ? 'step' : undefined} className={stepClass(phase === 'show')}>
          1 · Keystone scans this
        </li>
        <li aria-current={phase === 'scan' ? 'step' : undefined} className={stepClass(phase === 'scan')}>
          2 · Clef scans the signature
        </li>
      </ol>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-5 pt-5">
        {payloads.length > 1 && <span className="text-xs text-muted">{`${payloadKind === 'transaction' ? 'Transaction' : 'Message'} ${index + 1} of ${payloads.length}`}</span>}
        {phase === 'show' ? (
          <>
            <div className="rounded-4xl border border-line bg-surface p-[14px]">
              <AnimatedQr frames={request.frames} size={232} />
            </div>
            <p className="mb-0 mt-1 text-center text-sm leading-normal">
              On your Keystone, open the Solana wallet and tap <strong>Scan</strong>. Check what it shows matches this request.
            </p>
            <p className="m-0 text-center text-xs leading-normal text-muted">
              Clef then checks the returned signature against this {payloadKind} and your Keystone’s public key before using it.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-4xl border border-line bg-surface p-[14px]">
              <video ref={video} aria-label="Camera preview" muted playsInline className="block h-[232px] w-[232px] rounded-lg bg-ink object-cover" />
            </div>
            {error ? (
              <section role="alert" className="flex w-full flex-col gap-2 rounded-2xl border border-danger-line bg-danger-bg px-[14px] py-3 text-xs leading-[1.45] text-danger-ink">
                <span>{error}</span>
                <button
                  type="button"
                  className="h-9 cursor-pointer self-start rounded-xl border border-line-strong bg-surface px-4 text-sm font-medium text-ink"
                  onClick={() => {
                    setProgress(0);
                    setError(null);
                    setAttempt((a) => a + 1);
                  }}
                >
                  Scan again
                </button>
              </section>
            ) : (
              <p className="m-0 text-center text-sm leading-normal">
                {progress > 0 ? `Scanning… ${Math.round(progress * 100)}%` : 'Hold the signature QR on your Keystone up to the camera.'}
              </p>
            )}
          </>
        )}
      </div>

      {phase === 'show' ? (
        <Footer
          rejectLabel="Cancel"
          approveLabel="Scan signature"
          onReject={onCancel}
          onApprove={() => setPhase('scan')}
          approveIcon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
            </svg>
          }
        />
      ) : (
        <Footer
          rejectLabel="Cancel"
          approveLabel="Show QR again"
          onReject={onCancel}
          onApprove={() => {
            setError(null);
            setProgress(0);
            setPhase('show');
          }}
        />
      )}
    </>
  );
}
