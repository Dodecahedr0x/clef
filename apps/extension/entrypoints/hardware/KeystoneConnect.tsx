import { HardwareError, parseKeystoneSync, UrFrameDecoder, type KeystoneAccount } from '@clef/signers';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '../../components';
import { call } from '../../lib/api';
import { hardwareMessage } from './errors';
import { AddedView, CandidateList, HardwareShell, addLabel, closeTab, doneButton, useBalances, type Candidate } from './shared';

type Synced = { xfp: string; device?: string; accounts: KeystoneAccount[] };

const corner = 'absolute size-7 border-white';

export function KeystoneConnect() {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'scanning' | 'review' | 'adding' | 'added'>('scanning');
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState<Synced | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addedCount, setAddedCount] = useState(0);

  const stop = () => {
    controls.current?.stop();
    controls.current = null;
  };

  useEffect(() => {
    if (phase !== 'scanning' || !video.current) return;
    const decoder = new UrFrameDecoder();
    let live = true;
    let done = false;
    setProgress(0);
    const onText = (text: string) => {
      if (done) return;
      try {
        decoder.receive(text.trim().toLowerCase());
      } catch (e) {
        setHint(e instanceof HardwareError ? e.message : 'This QR code is not from a Keystone');
        return;
      }
      setHint(null);
      setProgress(decoder.progress());
      if (!decoder.isComplete()) return;
      done = true;
      stop();
      try {
        const s = parseKeystoneSync(decoder.result());
        setSynced(s);
        setSelected(new Set(s.accounts.map((a) => a.path)));
        setPhase('review');
      } catch (e) {
        setError(hardwareMessage(e));
      }
    };
    new BrowserQRCodeReader()
      .decodeFromVideoDevice(undefined, video.current, (result) => {
        if (live && result) onText(result.getText());
      })
      .then(
        (c) => {
          if (live && !done) controls.current = c;
          else c.stop();
        },
        (e) => live && setError(hardwareMessage(e)),
      );
    return () => {
      live = false;
      stop();
    };
  }, [phase, attempt]);

  const items: Candidate[] = (synced?.accounts ?? []).map((a, i) => ({ address: a.address, path: a.path, index: String(i) }));
  const { balances, added } = useBalances(items.map((c) => c.address));
  const chosen = (synced?.accounts ?? []).filter((a) => selected.has(a.path) && !added.has(a.address));

  async function add() {
    setError(null);
    setPhase('adding');
    try {
      for (const a of chosen) await call({ type: 'accounts:addHardware', kind: 'keystone', address: a.address, path: a.path, xfp: a.xfp });
      setAddedCount(chosen.length);
      setPhase('added');
    } catch (e) {
      setError(hardwareMessage(e));
      setPhase('review');
    }
  }

  const cancel = () => {
    stop();
    closeTab();
  };

  const retry = () => {
    setError(null);
    setHint(null);
    setSynced(null);
    setPhase('scanning');
    setAttempt((n) => n + 1);
  };

  if (phase === 'added') {
    return (
      <HardwareShell title="Connect Keystone" footer={doneButton}>
        <AddedView count={addedCount} device="Keystone" />
      </HardwareShell>
    );
  }

  if (phase === 'review' || phase === 'adding') {
    return (
      <HardwareShell
        title="Connect Keystone"
        footer={
          <Button block disabled={!chosen.length || phase === 'adding'} onClick={add}>
            {phase === 'adding' ? 'Adding…' : addLabel(chosen.length)}
          </Button>
        }
      >
        <div className="flex flex-1 flex-col gap-3 px-4 pt-3.5">
          <section className="flex items-center gap-3 rounded-2xl border border-ok-line bg-ok-bg px-3.5 py-3">
            <span aria-hidden="true" className="h-[30px] w-5 rounded-sm bg-ink" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-ok-ink">{synced?.device ?? 'Keystone'} synced</span>
              <span className="font-mono text-xs text-ok-ink-2">Fingerprint {synced?.xfp}</span>
            </div>
          </section>
          <div className="mx-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Accounts on this Keystone</div>
          <CandidateList
            items={items}
            selected={selected}
            onToggle={(c) =>
              setSelected((s) => {
                const n = new Set(s);
                if (!n.delete(c.path)) n.add(c.path);
                return n;
              })
            }
            balances={balances}
            added={added}
          />
          {error && <Alert severity="danger">{error}</Alert>}
          <p className="m-0 text-xs leading-[1.45] text-muted">Clef shows each signature as a QR code for your Keystone to sign.</p>
        </div>
      </HardwareShell>
    );
  }

  const pct = Math.round(progress * 100);
  return (
    <HardwareShell
      title="Connect Keystone"
      footer={
        <Button block variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-1 flex-col gap-3.5 p-4">
        <div
          role="img"
          aria-label="Camera preview, waiting for Keystone sync QR"
          className="relative flex h-[240px] flex-none items-center justify-center overflow-hidden rounded-4xl bg-camera"
        >
          <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" />
          <div className="relative size-40">
            <span className={`${corner} left-0 top-0 rounded-tl-lg border-l-[3px] border-t-[3px]`} />
            <span className={`${corner} right-0 top-0 rounded-tr-lg border-r-[3px] border-t-[3px]`} />
            <span className={`${corner} bottom-0 left-0 rounded-bl-lg border-b-[3px] border-l-[3px]`} />
            <span className={`${corner} bottom-0 right-0 rounded-br-lg border-b-[3px] border-r-[3px]`} />
            <span className="absolute left-3 right-3 top-[72px] h-0.5 bg-primary-line" />
          </div>
          <span className="absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 text-xs text-white">
            <span className="size-[7px] rounded-full bg-danger" />
            Camera on
          </span>
          {pct > 0 && (
            <span className="absolute bottom-2.5 right-3 text-xs font-medium text-white tabular-nums">Scanning {pct}%</span>
          )}
          {pct > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <span className="block h-full bg-primary-line" style={{ width: `${pct}%` }} />
            </span>
          )}
        </div>
        <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-[1.45]">
          <li>
            On Keystone, open <strong>Connect software wallet</strong> and choose <strong>Solana</strong>.
          </li>
          <li>Hold its QR code up to your camera.</li>
        </ol>
        {hint && <Alert severity="warn">{hint}</Alert>}
        {error && (
          <Alert severity="danger" title="Couldn't read Keystone">
            {error}{' '}
            <button type="button" className="border-0 bg-transparent p-0 font-semibold text-danger-ink underline" onClick={retry}>
              Scan again
            </button>
          </Alert>
        )}
        <p className="m-0 text-xs leading-[1.45] text-muted">Clef opened this in a full tab so it can use the camera. Only public keys are shared — never secrets.</p>
      </div>
    </HardwareShell>
  );
}
