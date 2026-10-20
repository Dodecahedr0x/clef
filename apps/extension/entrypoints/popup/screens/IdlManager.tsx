import { PROGRAM_NAMES } from '@clef/explain';
import { BUNDLED_PROGRAM_IDS, MAX_IDL_BYTES } from '@clef/idl';
import type { Network, UserIdl } from '@clef/wallet-core';
import { isAddress } from '@solana/kit';
import { useMemo, useState } from 'react';
import { Alert, Button, Chips, EmptyState, PopupScreen, Segmented, TextField, Pubkey } from '../../../components';
import { call } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { useCall, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

type Tier = 'yours' | 'curated' | 'published' | 'chain';
type IdlNetwork = Exclude<Network, 'custom'>;
type Row = { name: string; programId: string; network: string; tier: Tier; user?: UserIdl };

const TIER: Record<Tier, { label: string; className: string }> = {
  yours: { label: 'Yours', className: 'bg-info-bg text-info-ink' },
  curated: { label: 'Curated', className: 'bg-primary-bg text-primary' },
  published: { label: 'Published', className: 'bg-ok-tint text-ok-ink' },
  chain: { label: 'On-chain', className: 'bg-surface-2 text-ink-2' },
};

// Named programs without a bundled IDL whose IDL is published by the program authors (Program Metadata);
// other named programs decode from their on-chain Anchor IDL.
const PUBLISHED = new Set(['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA']);

function knownRows(): Row[] {
  const rows: Row[] = [];
  for (const id of BUNDLED_PROGRAM_IDS) rows.push({ name: PROGRAM_NAMES[id] ?? shortAddress(id), programId: id, network: 'all networks', tier: 'curated' });
  for (const [id, name] of Object.entries(PROGRAM_NAMES)) {
    if (BUNDLED_PROGRAM_IDS.has(id)) continue;
    rows.push({ name, programId: id, network: 'mainnet', tier: PUBLISHED.has(id) ? 'published' : 'chain' });
  }
  return rows;
}

/** Program id embedded in an Anchor (address / metadata.address) or Codama (program.publicKey) IDL. */
function embeddedProgramId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { address?: unknown; metadata?: { address?: unknown }; program?: { publicKey?: unknown } };
  const id = o.address ?? o.metadata?.address ?? o.program?.publicKey;
  return typeof id === 'string' && isAddress(id) ? id : null;
}

function AddIdlForm({
  defaultNetwork,
  defaultProgramId = '',
  editing,
  onDone,
  onCancel,
}: {
  defaultNetwork: IdlNetwork;
  defaultProgramId?: string;
  /** One of your IDLs: the form starts from it and saving replaces it (program or network may change). */
  editing?: UserIdl;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [programId, setProgramId] = useState<string>(editing?.programId ?? defaultProgramId);
  const [network, setNetwork] = useState<IdlNetwork>((editing?.network as IdlNetwork | undefined) ?? defaultNetwork);
  const [name, setName] = useState(editing?.name ?? '');
  const [json, setJson] = useState(editing?.json ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IDL_BYTES) return setError('That file is too large to be an IDL');
    const text = await file.text();
    setJson(text);
    setError(null);
    try {
      const id = embeddedProgramId(JSON.parse(text));
      if (id && !programId) setProgramId(id);
    } catch {
      // reported on submit
    }
  };

  const submit = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return setError('The IDL is not valid JSON');
    }
    const id = programId.trim() || embeddedProgramId(parsed) || '';
    if (!isAddress(id)) return setError('Enter a valid program ID');
    setBusy(true);
    try {
      const fields = { programId: id, network, ...(name.trim() ? { name: name.trim() } : {}), json };
      await call(editing ? { type: 'idls:update', oldProgramId: editing.programId, oldNetwork: editing.network, ...fields } : { type: 'idls:add', ...fields });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the IDL');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={editing ? `Edit ${editing.name}` : 'Add IDL'} className="mx-3 mt-2.5 flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3">
      <TextField label="Program ID" mono spellCheck={false} autoComplete="off" value={programId} onChange={(e) => setProgramId(e.target.value)} />
      <Segmented<IdlNetwork>
        ariaLabel="IDL network"
        size="sm"
        fill
        options={[
          { value: 'mainnet', label: 'Mainnet' },
          { value: 'devnet', label: 'Devnet' },
          { value: 'localnet', label: 'Local' },
        ]}
        value={network}
        onChange={setNetwork}
      />
      <TextField label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        IDL JSON
        <textarea
          className={`${editing ? 'h-56' : 'h-24'} resize-y rounded-xl border border-field-line bg-surface p-2 font-mono text-xs text-ink`}
          spellCheck={false}
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      <label className="text-xs text-info">
        Load from file
        <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {error && <Alert severity="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !json.trim()} onClick={() => void submit()}>
          {editing ? 'Save changes' : 'Add IDL'}
        </Button>
      </div>
    </section>
  );
}

export function IdlManagerScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const idls = useCall<UserIdl[]>('idls:list');
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  // Opened from an undecodable instruction: the form is ready for that program, and saving goes back to it.
  const addFor = (nav.route as { addFor?: string }).addFor;
  const [adding, setAdding] = useState(Boolean(addFor));
  const [editing, setEditing] = useState<UserIdl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useMemo(knownRows, []);

  const s = state?.settings;
  // Bundled, published and on-chain IDLs are read from the current RPC.
  const viewNetwork = s?.network ?? 'mainnet';
  const defaultNetwork: IdlNetwork = !s ? 'mainnet' : s.network === 'custom' ? s.customCluster : s.network;

  const rows: Row[] = [
    ...(idls.data ?? []).map((u): Row => ({ name: u.name, programId: u.programId, network: u.network, tier: 'yours', user: u })),
    ...known,
  ];
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (tier === 'all' || r.tier === tier) && (!q || r.name.toLowerCase().includes(q) || r.programId.toLowerCase().includes(q)));

  const remove = async (u: UserIdl) => {
    setError(null);
    try {
      await call({ type: 'idls:remove', programId: u.programId, network: u.network });
      idls.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the IDL');
    }
  };

  return (
    <PopupScreen
      title="Program IDLs"
      onBack={nav.back}
      scroll
      right={
        !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add IDL
          </Button>
        )
      }
    >
      {editing && (
        <AddIdlForm
          key={`${editing.programId}:${editing.network}`}
          defaultNetwork={defaultNetwork}
          editing={editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            idls.reload();
          }}
        />
      )}
      {adding && (
        <AddIdlForm
          defaultNetwork={defaultNetwork}
          defaultProgramId={addFor}
          onCancel={() => (addFor ? nav.back() : setAdding(false))}
          onDone={() => {
            if (addFor) return nav.back(); // back to the transaction, which explains again with the new IDL
            setAdding(false);
            idls.reload();
          }}
        />
      )}
      <div className="flex flex-col gap-2.5 px-4 pt-3">
        <label htmlFor="idl-q" className="sr-only">
          Search programs
        </label>
        <input
          id="idl-q"
          placeholder="Search by name or program ID"
          className="h-10 rounded-xl border border-field-line bg-surface px-3 text-sm text-ink outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Chips<Tier | 'all'>
          ariaLabel="IDL source"
          chips={[
            { id: 'all', label: 'All' },
            { id: 'yours', label: 'Yours' },
            { id: 'curated', label: 'Curated' },
            { id: 'published', label: 'Published' },
            { id: 'chain', label: 'On-chain' },
          ]}
          value={tier}
          onChange={setTier}
        />
        <p className="m-0 text-xs leading-[1.45] text-muted">
          Clef uses the first that decodes: <strong className="text-ink">yours → curated → published → on-chain Anchor</strong>.
        </p>
        {error && <Alert severity="danger">{error}</Alert>}
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No programs match" />
      ) : (
        <ul aria-label="Programs" className="mx-3 mb-3 mt-2.5 overflow-hidden rounded-2xl border border-line bg-surface">
          {visible.map((r, i) => (
            <li key={`${r.tier}:${r.programId}:${r.network}`} className={`flex min-h-14 items-center gap-2.5 px-3 py-2 ${i ? 'border-t border-line-soft' : ''}`}>
              <button
                type="button"
                aria-label={`View ${r.name}`}
                onClick={() => nav.go({ name: 'settings/idls/view', programId: r.programId, network: r.tier === 'yours' ? r.network : viewNetwork, tier: r.tier })}
                className="flex min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-left text-ink"
              >
                <span className="truncate text-sm font-medium">{r.name}</span>
                <span className="font-mono text-xs text-muted">
                  <Pubkey value={r.programId} /> · {r.network}
                </span>
              </button>
              <span className={`rounded-full px-2 py-px text-xs font-semibold ${TIER[r.tier].className}`}>{TIER[r.tier].label}</span>
              {r.user && (
                <Button variant="ghost" size="xs" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.user!)}>
                  Edit
                </Button>
              )}
              {r.user && (
                <Button variant="ghost" size="xs" aria-label={`Remove ${r.name}`} onClick={() => void remove(r.user!)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PopupScreen>
  );
}
