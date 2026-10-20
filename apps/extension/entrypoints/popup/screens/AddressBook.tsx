import type { Contact } from '@clef/wallet-core';
import { isAddress } from '@solana/kit';
import { useState } from 'react';
import { Alert, Avatar, Button, EmptyState, IconButton, PopupScreen, Tabs, tabPanelProps, TextField, Pubkey } from '../../../components';
import { call } from '../../../lib/api';
import { shortAddress } from '../../../lib/format';
import { useCall } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

type Kind = Contact['kind'];
type Draft = { address: string; name: string; note: string; existing: boolean };

const TONES = ['ok', 'info', 'warn', 'violet', 'primary'] as const;

function ContactForm({ kind, draft, onDone, onCancel }: { kind: Kind; draft: Draft; onDone: () => void; onCancel: () => void }) {
  const [address, setAddress] = useState(draft.address);
  const [name, setName] = useState(draft.name);
  const [note, setNote] = useState(draft.note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addressError = address.trim() && !isAddress(address.trim()) ? 'Not a valid Solana address' : null;

  const run = async (c: { type: string } & Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call(c);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={draft.existing ? 'Edit entry' : 'New entry'} className="mx-3 mt-3 flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3">
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Address"
        mono
        spellCheck={false}
        autoComplete="off"
        readOnly={draft.existing}
        value={address}
        error={addressError}
        onChange={(e) => setAddress(e.target.value)}
      />
      <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Alert severity="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {draft.existing && (
          <Button variant="danger-outline" size="sm" disabled={busy} onClick={() => void run({ type: 'contacts:remove', address: draft.address })}>
            Remove
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy || !name.trim() || !address.trim() || addressError !== null}
          onClick={() => void run({ type: 'contacts:upsert', address: address.trim(), name: name.trim(), kind, ...(note.trim() ? { note: note.trim() } : {}) })}
        >
          Save
        </Button>
      </div>
    </section>
  );
}

export function AddressBookScreen() {
  const nav = useNav();
  const contacts = useCall<Contact[]>('contacts:list');
  const [tab, setTab] = useState<Kind>('contact');
  const [draft, setDraft] = useState<Draft | null>(null);

  const all = contacts.data ?? [];
  const people = all.filter((c) => c.kind === 'contact');
  const labels = all.filter((c) => c.kind === 'label');
  const list = tab === 'contact' ? people : labels;
  const noun = tab === 'contact' ? 'contact' : 'label';

  return (
    <PopupScreen
      title="Address book"
      onBack={nav.back}
      scroll
      right={<IconButton label={`Add ${noun}`} icon="plus" size={40} onClick={() => setDraft({ address: '', name: '', note: '', existing: false })} />}
    >
      <div className="px-4">
        <Tabs<Kind>
          ariaLabel="Address book"
          tabs={[
            { id: 'contact', label: `Contacts · ${people.length}` },
            { id: 'label', label: `Account labels · ${labels.length}` },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setDraft(null);
          }}
          panelId="address-book-panel"
        />
      </div>
      <div {...tabPanelProps('address-book-panel', tab)}>
      {draft && (
        <ContactForm
          key={draft.address || 'new'}
          kind={tab}
          draft={draft}
          onCancel={() => setDraft(null)}
          onDone={() => {
            setDraft(null);
            contacts.reload();
          }}
        />
      )}
      {list.length === 0 ? (
        <EmptyState title={tab === 'contact' ? 'No contacts yet' : 'No labels yet'} body="Add one with the + button." />
      ) : (
        <ul aria-label={tab === 'contact' ? 'Contacts' : 'Account labels'} className="m-3 overflow-hidden rounded-2xl border border-line bg-surface">
          {list.map((c, i) => (
            <li key={c.address} className={i ? 'border-t border-line-soft' : ''}>
              <button
                type="button"
                aria-label={`Edit ${c.name}`}
                className="flex min-h-[60px] w-full items-center gap-2.5 px-3 py-2 text-left"
                onClick={() => setDraft({ address: c.address, name: c.name, note: c.note ?? '', existing: true })}
              >
                <Avatar text={c.name.charAt(0).toUpperCase()} tone={TONES[i % TONES.length]} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <Pubkey value={c.address} className="text-xs text-muted" />
                </span>
                {c.note && <span className="text-right text-xs text-muted">{c.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
      <p className="mx-5 mb-3 text-xs leading-[1.45] text-muted">Names here show up in every transaction Clef explains, so you can spot a familiar recipient at a glance.</p>
    </PopupScreen>
  );
}
