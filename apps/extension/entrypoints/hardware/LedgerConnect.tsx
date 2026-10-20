import { LEDGER_PATH, LedgerDevice } from '@clef/signers';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Icon, SectionLabel, Segmented, Spinner } from '../../components';
import { call } from '../../lib/api';
import { hardwareMessage } from './errors';
import { AddedView, CandidateList, HardwareShell, addLabel, doneButton, useBalances, type Candidate } from './shared';

type Scheme = 'legacy' | 'standard';
const PAGE = 3;
const SCHEMES: { value: Scheme; label: string }[] = [
  { value: 'legacy', label: "44'/501'/n'" },
  { value: 'standard', label: "44'/501'/n'/0'" },
];

export function LedgerConnect() {
  const device = useRef<LedgerDevice | null>(null);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected' | 'adding' | 'added'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<Scheme>('legacy');
  const [count, setCount] = useState<Record<Scheme, number>>({ legacy: PAGE, standard: PAGE });
  const [found, setFound] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [addedCount, setAddedCount] = useState(0);

  useEffect(
    () => () => {
      void device.current?.close().catch(() => {});
    },
    [],
  );

  const paths = Array.from({ length: count[scheme] }, (_, i) => LEDGER_PATH[scheme](i));
  const items: Candidate[] = paths.flatMap((path, i) => (found[path] ? [{ address: found[path], path, index: String(i) }] : []));
  const { balances, added } = useBalances(items.map((c) => c.address));

  // The device answers one APDU at a time, so lookups run through a single queue.
  const requested = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  useEffect(() => {
    const dev = device.current;
    if (phase !== 'connected' || !dev) return;
    const missing = paths.filter((p) => !requested.current.has(p));
    if (!missing.length) return;
    for (const p of missing) requested.current.add(p);
    pending.current++;
    setError(null);
    setLoading(true);
    queue.current = queue.current.then(async () => {
      try {
        for (const [i, path] of missing.entries()) {
          try {
            const a = await dev.getAddress(path);
            setFound((m) => ({ ...m, [path]: a }));
            if (path === LEDGER_PATH.legacy(0)) setSelected((s) => (s.length ? s : [{ address: a, path, index: '0' }]));
          } catch (e) {
            for (const p of missing.slice(i)) requested.current.delete(p);
            setError(hardwareMessage(e));
            return;
          }
        }
      } finally {
        if (--pending.current === 0) setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scheme, count[scheme]]);

  async function connect() {
    setError(null);
    setPhase('connecting');
    try {
      const dev = await LedgerDevice.request();
      try {
        await dev.getAppConfig();
      } catch (e) {
        await dev.close().catch(() => {});
        throw e;
      }
      device.current = dev;
      setPhase('connected');
    } catch (e) {
      setError(hardwareMessage(e));
      setPhase('idle');
    }
  }

  const chosen = selected.filter((c) => !added.has(c.address));

  async function add() {
    setError(null);
    setPhase('adding');
    try {
      for (const c of chosen) await call({ type: 'accounts:addHardware', kind: 'ledger', address: c.address, path: c.path });
      setAddedCount(chosen.length);
      setPhase('added');
      await device.current?.close().catch(() => {});
      device.current = null;
    } catch (e) {
      setError(hardwareMessage(e));
      setPhase('connected');
    }
  }

  const toggle = (c: Candidate) =>
    setSelected((s) => (s.some((x) => x.path === c.path) ? s.filter((x) => x.path !== c.path) : [...s, c]));

  if (phase === 'added') {
    return (
      <HardwareShell title="Connect Ledger" footer={doneButton}>
        <AddedView count={addedCount} device="Ledger" />
      </HardwareShell>
    );
  }

  if (phase === 'idle' || phase === 'connecting') {
    return (
      <HardwareShell
        title="Connect Ledger"
        footer={
          <Button block icon={phase === 'connecting' ? undefined : 'usb'} disabled={phase === 'connecting'} onClick={connect}>
            {phase === 'connecting' ? 'Waiting for Ledger…' : 'Connect Ledger'}
          </Button>
        }
      >
        <div className="flex flex-1 flex-col gap-3.5 px-4 pt-4">
          <div className="flex h-[160px] items-center justify-center rounded-4xl border border-line bg-surface text-muted">
            {phase === 'connecting' ? <Spinner size={28} /> : <Icon name="usb" size={40} />}
          </div>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-[1.45]">
            <li>Plug in your Ledger and unlock it with your PIN.</li>
            <li>
              Open the <strong>Solana</strong> app.
            </li>
            <li>Press Connect Ledger and choose your device.</li>
          </ol>
          {error && (
            <Alert severity="danger" title="Couldn't connect">
              {error}
            </Alert>
          )}
          <p className="m-0 text-xs leading-[1.45] text-muted">Clef opened this in a full tab so the browser can ask for USB access. Only public keys are shared.</p>
        </div>
      </HardwareShell>
    );
  }

  return (
    <HardwareShell
      title="Connect Ledger"
      footer={
        <Button block disabled={!chosen.length || phase === 'adding'} onClick={add}>
          {phase === 'adding' ? 'Adding…' : addLabel(chosen.length)}
        </Button>
      }
    >
      <div className="flex flex-1 flex-col gap-3 px-4 pt-3.5">
        <section className="flex items-center gap-3 rounded-2xl border border-ok-line bg-ok-bg px-3.5 py-3">
          <span aria-hidden="true" className="h-[18px] w-11 rounded-sm bg-ink" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ok-ink">Ledger connected</span>
            <span className="text-xs text-ok-ink-2">USB · Solana app open</span>
          </div>
        </section>
        <div className="[&_button]:font-mono">
          <Segmented ariaLabel="Derivation path" options={SCHEMES} value={scheme} onChange={setScheme} fill />
        </div>
        <SectionLabel right={loading ? <Spinner size={12} /> : undefined}>Addresses on this Ledger</SectionLabel>
        {items.length > 0 && <CandidateList items={items} selected={new Set(selected.map((c) => c.path))} onToggle={toggle} balances={balances} added={added} />}
        <Button variant="ghost" size="sm" onClick={() => setCount((c) => ({ ...c, [scheme]: c[scheme] + PAGE }))}>
          Show more
        </Button>
        {error && <Alert severity="danger">{error}</Alert>}
        <p className="m-0 text-xs leading-[1.45] text-muted">Clef re-checks each address on the device before every signature.</p>
      </div>
    </HardwareShell>
  );
}
