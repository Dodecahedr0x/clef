import { normalizeMnemonic, validateMnemonic } from '@clef/vault';
import { isAddress, type Address } from '@solana/kit';
import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Icon, IconButton, Segmented, TextField, Pubkey } from '../../../components';
import { call } from '../../../lib/api';
import { createClients } from '../../../lib/clients';
import { formatToken, shortAddress } from '../../../lib/format';
import { useWallet } from '../../../lib/hooks';
import { readKeyFile } from '../../../lib/key-file';
import { useNav, useOnboardingDraft } from '../../../lib/nav';
import { inSidePanel } from '../../../lib/side-panel';

type Tab = 'phrase' | 'key' | 'watch';
type Scheme = 'standard' | 'legacy';
type Found = { index: number; address: Address };
type Balance = { sol: bigint; tokens: number } | 'error';

const PAGE = 3;
const SCHEME_LABEL: Record<Scheme, string> = { standard: "44'/501'/n'/0'", legacy: "44'/501'/n'" };

function balanceText(b: Balance | undefined): string {
  if (b === undefined) return '…';
  if (b === 'error') return '—';
  if (b.sol === 0n && b.tokens === 0) return 'empty';
  const sol = `${formatToken(b.sol, 9, 2)} SOL`;
  return b.tokens ? `${sol} · ${b.tokens} token${b.tokens === 1 ? '' : 's'}` : sol;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function ImportScreen() {
  const nav = useNav();
  const draft = useOnboardingDraft();
  const { state, refresh } = useWallet();
  const hasVault = state?.hasVault ?? false;
  const [tab, setTab] = useState<Tab>(location.hash === '#import-key' ? 'key' : 'phrase');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state && !state.hasVault && !draft.password) nav.replace({ name: 'create-password', next: 'import' });
  }, [state, draft.password, nav]);

  // Without a vault yet, the password from the previous step creates one; key and watch-only imports get a fresh phrase.
  const ensureVault = async (mnemonic?: string, indexes: number[] = []) => {
    if (hasVault) return;
    if (!draft.password) throw new Error('Set a password first');
    const phrase = mnemonic ?? (await call<{ mnemonic: string }>({ type: 'mnemonic:generate' })).mnemonic;
    await call({ type: 'vault:create', password: draft.password, mnemonic: phrase, indexes });
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      draft.clear();
      await refresh(); // the router must see the new vault before it routes home
      nav.reset({ name: 'home' });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 pl-1.5 pr-3">
        <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 text-[18px] font-semibold">Import a wallet</h1>
      </header>
      <div className="mx-4">
        <Segmented
          fill
          size="md"
          ariaLabel="Import type"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setError(null);
          }}
          options={[
            { value: 'phrase', label: 'Phrase' },
            { value: 'key', label: 'Private key' },
            { value: 'watch', label: 'Watch-only' },
          ]}
        />
      </div>
      {tab === 'phrase' && <PhraseTab hasVault={hasVault} busy={busy} error={error} run={run} ensureVault={ensureVault} rpc={state?.settings ?? null} />}
      {tab === 'key' && <KeyTab busy={busy} error={error} onImport={(secretKey) => run(async () => {
        await ensureVault();
        await call({ type: 'accounts:import', secretKey });
      })} />}
      {tab === 'watch' && <WatchTab busy={busy} error={error} onWatch={(address, label) => run(async () => {
        await ensureVault();
        await call({ type: 'accounts:watch', address, label });
      })} />}
    </div>
  );
}

type Settings = NonNullable<ReturnType<typeof useWallet>['state']>['settings'];

function PhraseTab({ hasVault, busy, error, run, ensureVault, rpc }: {
  hasVault: boolean;
  busy: boolean;
  error: string | null;
  run: (work: () => Promise<void>) => Promise<void>;
  ensureVault: (mnemonic?: string, indexes?: number[]) => Promise<void>;
  rpc: Settings | null;
}) {
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [scheme, setScheme] = useState<Scheme>('standard');
  const [count, setCount] = useState(PAGE);
  const [scan, setScan] = useState<{ key: string; found: Found[]; error: string | null }>({ key: '', found: [], error: null });
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const mnemonic = normalizeMnemonic(text);
  const wordCount = mnemonic ? mnemonic.split(' ').length : 0;
  const valid = (wordCount === 12 || wordCount === 24) && validateMnemonic(mnemonic);
  const clients = useMemo(() => (rpc ? createClients(rpc) : null), [rpc?.rpcUrl, rpc?.jupiterApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = `${scheme}|${mnemonic}`;
  const found = scan.key === key ? scan.found : [];
  const scanError = scan.key === key ? scan.error : null;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const from = found.length;
    if (from >= count) return;
    call<{ accounts: Found[] }>({ type: 'accounts:scan', mnemonic, from, count: count - from, ...(scheme === 'legacy' && { scheme }) })
      .then(({ accounts }) => live && setScan((s) => ({ key, found: s.key === key ? [...s.found, ...accounts] : accounts, error: null })))
      .catch((e: unknown) => live && setScan({ key, found: [], error: errorText(e) }));
    return () => {
      live = false;
    };
  }, [valid, key, count, found.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clients) return;
    let live = true;
    for (const a of found) {
      if (balances[a.address] !== undefined) continue;
      Promise.all([clients.portfolio.getBalance(a.address), clients.portfolio.getTokenAccounts(a.address)])
        .then(([sol, tokens]): Balance => ({ sol, tokens: tokens.filter((t) => t.amount > 0n).length }))
        .catch((): Balance => 'error')
        .then((b) => {
          if (!live) return;
          setBalances((m) => ({ ...m, [a.address]: b }));
          const used = b !== 'error' && (b.sol > 0n || b.tokens > 0);
          setChecked((c) => (a.address in c ? c : { ...c, [a.address]: a.index === 0 || used }));
        });
    }
    return () => {
      live = false;
    };
  }, [found, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = found.filter((a) => checked[a.address] ?? a.index === 0).map((a) => a.index).sort((x, y) => x - y);

  const submit = () =>
    run(async () => {
      if (!hasVault && scheme === 'standard') return ensureVault(mnemonic, selected);
      await ensureVault(mnemonic, []);
      await call({ type: 'accounts:importMnemonic', mnemonic, indexes: selected, ...(scheme === 'legacy' && { scheme }) });
    });

  let status: { text: string; tone: string } | null = null;
  if (wordCount > 0) {
    if (valid) status = { text: `✓ ${wordCount} words · valid checksum`, tone: 'text-ok' };
    else if (wordCount === 12 || wordCount === 24) status = { text: 'Checksum doesn’t match — check each word', tone: 'text-danger-text' };
    else status = { text: `${wordCount} word${wordCount === 1 ? '' : 's'}`, tone: 'text-muted' };
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4">
        <label htmlFor="import-phrase" className="text-[12px] text-muted">Recovery phrase (12 or 24 words)</label>
        <textarea
          id="import-phrase"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={`resize-none rounded-[12px] border bg-surface p-3 font-mono text-[14px] leading-normal text-ink outline-none ${valid ? 'border-primary' : 'border-line-strong focus:border-primary'} ${shown ? '' : 'blur-[3px] focus:blur-none'}`}
        />
        <div className="flex items-center text-[12px]">
          {status && <span className={status.tone}>{status.text}</span>}
          <button type="button" onClick={() => setShown((s) => !s)} className="ml-auto min-h-8 border-0 bg-transparent text-[12px] text-info">
            {shown ? 'Hide' : 'Show'}
          </button>
        </div>

        {valid && (
          <>
            <div className="mt-1.5 flex items-center text-[12px] text-muted">
              <span className="font-semibold uppercase tracking-[0.06em]">Accounts found</span>
              <span className="ml-auto font-mono">{SCHEME_LABEL[scheme]}</span>
            </div>
            {scanError ? (
              <p className="text-[12px] text-danger-text">{scanError}</p>
            ) : (
              <ul className="m-0 list-none overflow-hidden rounded-[12px] border border-line bg-surface p-0">
                {found.map((a, i) => {
                  const b = balances[a.address];
                  const empty = b !== undefined && b !== 'error' && b.sol === 0n && b.tokens === 0;
                  return (
                    <li key={a.address} className={i ? 'border-t border-line-soft' : ''}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={checked[a.address] ?? a.index === 0}
                          onChange={(e) => setChecked((c) => ({ ...c, [a.address]: e.target.checked }))}
                          className="m-0 size-[18px] accent-primary"
                        />
                        <span className="font-mono text-[12px] text-muted">#{a.index}</span>
                        <span className={`flex-1 text-[14px] ${empty ? 'text-muted' : ''}`}><Pubkey value={a.address} /></span>
                        <span className={`text-[12px] ${empty ? 'text-muted' : ''}`}>{balanceText(b)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setScheme((s) => (s === 'standard' ? 'legacy' : 'standard'))} className="min-h-8 border-0 bg-transparent p-0 text-[12px] text-info">
                {scheme === 'standard' ? 'Use a different derivation path' : 'Use the standard derivation path'}
              </button>
              <button type="button" onClick={() => setCount((c) => c + PAGE)} className="ml-auto min-h-8 border-0 bg-transparent p-0 text-[12px] text-info">Show more</button>
            </div>
          </>
        )}
        {error && <p className="text-[12px] text-danger-text">{error}</p>}
      </div>
      <div className="px-4 pb-4 pt-3">
        <Button block disabled={!valid || selected.length === 0 || busy} onClick={submit}>
          {busy ? 'Importing…' : `Import ${selected.length} account${selected.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </>
  );
}

function KeyTab({ busy, error, onImport }: { busy: boolean; error: string | null; onImport: (secretKey: string) => void }) {
  const [key, setKey] = useState('');
  const [file, setFile] = useState<{ name: string; address: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // The toolbar popup closes as soon as Finder or a file dialog takes focus; the side panel and tabs keep files.
  const popup = !inSidePanel() && !location.hash;

  const load = async (f: File | undefined) => {
    setOver(false);
    if (!f) return;
    const r = await readKeyFile(f);
    if (!r.ok) {
      setFile(null);
      setFileError(r.error);
      return;
    }
    setFileError(null);
    setKey(r.secret);
    setFile({ name: f.name, address: r.address });
  };

  return (
    <>
      <div
        className="flex flex-1 flex-col gap-3 px-4 pt-4"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          void load(e.dataTransfer.files[0]);
        }}
      >
        <TextField
          label="Private key"
          type="password"
          mono
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setFile(null);
          }}
          placeholder="Base58 or [12, 34, …]"
          error={error}
        />
        <label
          data-testid="key-drop"
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border border-dashed px-3 py-3.5 text-center text-[12px] ${over ? 'border-primary bg-primary-bg text-primary' : 'border-line-strong bg-surface text-muted'}`}
        >
          <Icon name="key" size={18} />
          <span className="font-medium text-ink">{file ? `Loaded ${file.name}` : 'Drop a keypair file here, or choose one'}</span>
          <span>{file ? <>Address <Pubkey value={file.address} /></> : 'Solana CLI keypair .json, or a text file with a base58 key'}</span>
          <input type="file" accept=".json,.txt,application/json,text/plain" className="sr-only" onChange={(e) => void load(e.target.files?.[0])} aria-label="Choose a keypair file" />
        </label>
        {fileError && <p role="alert" className="m-0 text-[12px] text-danger-text">{fileError}</p>}
        {popup && (
          <p className="m-0 text-[12px] leading-[1.45] text-muted">
            The toolbar popup closes when you switch to Finder.{' '}
            <button type="button" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/popup.html#import-key' as '/popup.html') })} className="border-0 bg-transparent p-0 text-[12px] text-info underline">
              Open in a tab
            </button>{' '}
            to drop a file, or use the side panel.
          </p>
        )}
        <p className="text-[12px] leading-[1.45] text-muted">A 64-byte secret key, as exported by Phantom or the Solana CLI. It is encrypted with your password and never leaves this device.</p>
      </div>
      <div className="px-4 pb-4 pt-3">
        <Button block disabled={!key.trim() || busy} onClick={() => onImport(key.trim())}>{busy ? 'Importing…' : 'Import account'}</Button>
      </div>
    </>
  );
}

function WatchTab({ busy, error, onWatch }: { busy: boolean; error: string | null; onWatch: (address: string, label: string) => void }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const a = address.trim();
  const bad = a.length > 0 && !isAddress(a);
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 px-4 pt-4">
        <TextField label="Address" mono value={address} onChange={(e) => setAddress(e.target.value)} error={bad ? 'Not a Solana address' : null} />
        <TextField label="Name" value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} placeholder="Watch" />
        <p className="text-[12px] leading-[1.45] text-muted">See balances and preview requests. Clef can’t sign for this address.</p>
        {error && <p className="text-[12px] text-danger-text">{error}</p>}
      </div>
      <div className="px-4 pb-4 pt-3">
        <Button block disabled={!a || bad || busy} onClick={() => onWatch(a, label.trim() || 'Watch')}>{busy ? 'Adding…' : 'Watch address'}</Button>
      </div>
    </>
  );
}
