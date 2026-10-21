import { buildExecuteTransaction, buildVoteTransaction, fetchMultisig, listProposals, type MultisigInfo, type ProposalInfo } from '@clef/squads';
import type { Address } from '@solana/kit';
import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, IconButton, Spinner, Tabs, tabPanelProps, ScreenActionsSlot } from '../../../components';
import { call } from '../../../lib/api';
import { useClients, useWallet } from '../../../lib/hooks';
import { useNav } from '../../../lib/nav';

const LIMIT = 20;
const ACTIVE = new Set(['draft', 'active', 'approved']);

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function ProposalsScreen() {
  const nav = useNav();
  const { state } = useWallet();
  const clients = useClients();
  const multisig = (nav.route.name === 'proposals' ? nav.route.multisig : '') as Address;
  const account = state?.accounts.find((a) => a.kind === 'squads' && a.multisig === multisig) ?? null;
  const member = account?.member ?? null;
  const [tab, setTab] = useState<'active' | 'executed'>('active');
  const [info, setInfo] = useState<MultisigInfo | null>(null);
  const [proposals, setProposals] = useState<ProposalInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clients || !multisig) return;
    try {
      const [ms, list] = await Promise.all([fetchMultisig(clients.chain, multisig), listProposals(clients.chain, multisig, { limit: LIMIT })]);
      setInfo(ms);
      setProposals(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load proposals');
      setProposals((p) => p ?? []);
    }
  }, [clients, multisig]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (p: ProposalInfo, action: 'approve' | 'reject' | 'execute') => {
    if (!clients || !member) return;
    setBusy(`${p.index}:${action}`);
    setError(null);
    try {
      const { blockhash } = await clients.portfolio.getLatestBlockhash();
      const wire =
        action === 'execute'
          ? await buildExecuteTransaction(clients.chain, { multisig, member, transactionIndex: p.index, blockhash })
          : await buildVoteTransaction({ multisig, member, transactionIndex: p.index, vote: action, blockhash });
      await call({ type: 'wallet:submit', account: member, transactions: [base64(wire)], send: true, purpose: action === 'execute' ? 'squads-execute' : 'squads-vote' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(null);
    }
  };

  const threshold = info?.threshold ?? 0;
  const active = (proposals ?? []).filter((p) => ACTIVE.has(p.status));
  const executed = (proposals ?? []).filter((p) => p.status === 'executed');
  const shown = tab === 'active' ? active : executed;
  const label = (a: Address) => state?.accounts.find((x) => x.address === a)?.label;

  return (
    <div className="flex h-(--popup-h) w-(--popup-w) flex-col overflow-hidden bg-bg font-sans text-ink">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-line-soft pl-1.5 pr-3">
        <IconButton label="Back" icon="back" onClick={nav.back} className="text-ink" />
        <h1 className="m-0 truncate text-lg font-semibold">{account?.label ?? 'Multisig'}</h1>
        {info && <span className="ml-auto rounded-md border border-line-strong px-2 py-0.5 text-xs text-muted">Squads {info.threshold} of {info.members.length}</span>}
        <ScreenActionsSlot className={info ? 'ml-2' : 'ml-auto'} />
      </header>
      <div className="px-4">
        <Tabs
          ariaLabel="Proposals"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'active', label: proposals ? `Active · ${active.length}` : 'Active' },
            { id: 'executed', label: 'Executed' },
          ]}
          panelId="proposals-panel"
        />
      </div>
      <div {...tabPanelProps('proposals-panel', tab)} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {error && <p className="text-xs text-danger-text">{error}</p>}
        {!account && <EmptyState title="Multisig not found" body="Add it from Accounts first." />}
        {account && proposals === null && <div className="flex justify-center py-8"><Spinner /></div>}
        {account && proposals && shown.length === 0 && <EmptyState title={tab === 'active' ? 'No active proposals' : 'Nothing executed yet'} />}
        {shown.map((p) => {
          const n = p.approved.length;
          const mine = member !== null && p.approved.includes(member);
          const voted = mine || (member !== null && p.rejected.includes(member));
          const ready = p.status === 'approved' || (threshold > 0 && n >= threshold);
          const needsVote = p.status !== 'executed' && !voted && !ready;
          const waiting = (info?.members ?? []).filter((m) => m.vote && !p.approved.includes(m.key) && m.key !== member).map((m) => label(m.key) ?? `${m.key.slice(0, 4)}…`);
          let line = `${n} of ${threshold}`;
          if (p.status === 'executed') line += ' · executed';
          else if (ready) line += ' · ready';
          else if (needsVote) line += ' · needs your vote';
          else if (mine) line += ` · you approved${waiting.length ? ` · waiting for ${waiting.join(' or ')}` : ''}`;
          else line += ' · you rejected';
          return (
            <article key={String(p.index)} className={`flex flex-col gap-2 rounded-2xl border bg-surface p-3 ${needsVote ? 'border-warn-line' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">#{String(p.index)}</span>
                <span className="text-sm font-semibold">Vault transaction</span>
              </div>
              {!needsVote && threshold > 0 && (
                <div aria-hidden="true" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${threshold}, minmax(0, 1fr))` }}>
                  {Array.from({ length: threshold }, (_, i) => <span key={i} className={`h-[5px] rounded-xs ${i < n ? 'bg-primary' : 'bg-line'}`} />)}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-xs ${ready && p.status !== 'executed' ? 'text-ok' : 'text-muted'}`}>{line}</span>
                {needsVote && (
                  <>
                    <Button size="sm" variant="secondary" className="ml-auto font-normal" disabled={busy !== null} onClick={() => void submit(p, 'reject')}>Reject</Button>
                    <Button size="sm" variant="secondary" className="font-semibold" disabled={busy !== null} onClick={() => void submit(p, 'approve')}>Review</Button>
                  </>
                )}
                {ready && p.status !== 'executed' && (
                  <Button size="sm" className="ml-auto" disabled={busy !== null} onClick={() => void submit(p, 'execute')}>Execute</Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
