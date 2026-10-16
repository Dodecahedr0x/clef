import { fetchMultisig, vaultPda, type MultisigInfo } from '@clef/squads';
import { isAddress, type Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { Button, IconButton, TextField } from '../../../components';
import { call } from '../../../lib/api';
import { formatToken, shortAddress } from '../../../lib/format';
import { useClients, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const SIGNING_KINDS = ['hd', 'imported', 'ledger', 'keystone'];

type Lookup = { status: 'idle' } | { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ok'; info: MultisigInfo };

export function SquadsAddScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const clients = useClients();
  const [input, setInput] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  const [vaultSol, setVaultSol] = useState<bigint | null>(null);
  const [member, setMember] = useState<Address | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = input.trim();
  const valid = isAddress(address);

  useEffect(() => {
    setVaultSol(null);
    setMember(null);
    if (!valid || !clients) return setLookup({ status: 'idle' });
    let live = true;
    setLookup({ status: 'loading' });
    fetchMultisig(clients.chain, address)
      .then((info) => live && setLookup(info ? { status: 'ok', info } : { status: 'missing' }))
      .catch((e: unknown) => live && setLookup({ status: 'error', message: e instanceof Error ? e.message : 'Could not read the account' }));
    vaultPda(address, 0)
      .then((v) => clients.portfolio.getBalance(v))
      .then((b) => live && setVaultSol(b))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address, valid, clients]);

  const candidates = (state?.accounts ?? []).filter((a) => SIGNING_KINDS.includes(a.kind));
  const info = lookup.status === 'ok' ? lookup.info : null;
  const canVote = (a: Address) => !!info?.members.some((m) => m.key === a && m.vote);
  const voters = candidates.filter((a) => canVote(a.address));
  const chosen = member && canVote(member) ? member : (voters[0]?.address ?? null);

  const add = async () => {
    if (!info || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await call({ type: 'accounts:addSquads', multisig: address, vaultIndex: 0, member: chosen, label: label.trim() || 'Multisig' });
      nav.reset({ name: 'home' });
      nav.go({ name: 'accounts' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the multisig');
      setBusy(false);
    }
  };

  let fieldError: string | null = null;
  if (address && !valid) fieldError = 'Not a Solana address';
  else if (lookup.status === 'missing') fieldError = 'Not a Squads v4 multisig';
  else if (lookup.status === 'error') fieldError = lookup.message;

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-line-soft pl-1.5 pr-3">
        <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 text-[18px] font-semibold">Add Squads multisig</h1>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-3.5">
        <TextField label="Multisig address" mono value={input} onChange={(e) => setInput(e.target.value)} error={fieldError} />
        {lookup.status === 'loading' && <p className="text-[12px] text-muted">Reading the multisig…</p>}
        {info && (
          <>
            <section className="mt-1 flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">Squads v4</span>
                <span className="text-[12px] text-ok">✓ verified program account</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12px] text-muted">
                <span><strong className="block text-[14px] text-ink">{info.threshold} of {info.members.length}</strong>threshold</span>
                <span><strong className="block text-[14px] text-ink">{info.members.length}</strong>members</span>
                <span><strong className="block text-[14px] text-ink">{vaultSol === null ? '…' : `${formatToken(vaultSol, 9, 2)} SOL`}</strong>vault 0</span>
              </div>
            </section>
            <fieldset className="m-0 mt-1.5 flex flex-col gap-1.5 border-0 p-0">
              <legend className="pb-1.5 text-[12px] text-muted">Vote with</legend>
              {candidates.map((a) => {
                const ok = canVote(a.address);
                const on = ok && chosen === a.address;
                return (
                  <label
                    key={a.address}
                    className={`flex min-h-12 items-center gap-2.5 rounded-[12px] px-3 ${on ? 'border-[1.5px] border-primary bg-surface' : ok ? 'cursor-pointer border border-line bg-surface' : 'border border-line bg-surface-2 text-muted'}`}
                  >
                    <input type="radio" name="squads-member" checked={on} disabled={!ok} onChange={() => setMember(a.address)} className="m-0 size-[18px] accent-primary" />
                    <span className="flex-1 text-[14px]">
                      {a.label} <span className="font-mono text-[12px] text-muted">{shortAddress(a.address)}</span>
                    </span>
                    <span className={`text-[12px] ${ok ? 'text-ok' : ''}`}>{ok ? 'member' : 'not a member'}</span>
                  </label>
                );
              })}
            </fieldset>
            {voters.length === 0 && <p className="text-[12px] text-warn">None of your accounts can vote in this multisig</p>}
            <div className="mt-1.5">
              <TextField label="Name" value={label} maxLength={32} placeholder="Multisig" onChange={(e) => setLabel(e.target.value)} />
            </div>
          </>
        )}
        {error && <p className="text-[12px] text-danger-text">{error}</p>}
      </div>
      <div className="px-4 pb-4 pt-3">
        <Button block disabled={!info || !chosen || busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add multisig'}</Button>
      </div>
    </div>
  );
}
