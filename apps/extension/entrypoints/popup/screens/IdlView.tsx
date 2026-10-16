import { AnchorOnchainIdlSource, createBundledSource, ProgramMetadataIdlSource, resolveIdl, type ResolvedIdl } from '@clef/idl';
import type { UserIdl } from '@clef/wallet-core';
import { address } from '@solana/kit';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, PopupScreen, Spinner } from '../../../components';
import { shortAddress } from '../../../lib/format';
import { useCall, useClients } from '../../../lib/hooks';
import { outlineIdl, type IdlOutline } from '../../../lib/idl-view';
import { useNav } from '../../../lib/nav';
import type { Route } from '../routes';

type ViewRoute = Extract<Route, { name: 'settings/idls/view' }>;

const SOURCE: Record<ViewRoute['tier'], string> = { yours: 'Yours', curated: 'Curated (bundled with Clef)', published: 'Published (Program Metadata)', chain: 'On-chain Anchor IDL' };

/** The IDL as Clef uses it: the same source the list row names, read from that source only. */
async function loadIdl(r: ViewRoute, userIdls: UserIdl[], chain: NonNullable<ReturnType<typeof useClients>>['chain']): Promise<ResolvedIdl | null> {
  const id = address(r.programId);
  switch (r.tier) {
    case 'yours': {
      const mine = userIdls.find((u) => u.programId === r.programId && u.network === r.network);
      return mine ? resolveIdl(id, 'user', 'user', JSON.parse(mine.json)) : null;
    }
    case 'curated':
      return createBundledSource().load(id);
    case 'published':
      return new ProgramMetadataIdlSource(chain).load(id);
    case 'chain':
      return new AnchorOnchainIdlSource(chain).load(id);
  }
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className="m-0 px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
        {title} · {count}
      </h2>
      {count === 0 ? <p className="m-0 px-1 text-xs text-muted">None declared.</p> : <div className="overflow-hidden rounded-xl border border-line bg-surface">{children}</div>}
    </section>
  );
}

function Item({ title, meta, children, first }: { title: string; meta?: string; children?: ReactNode; first: boolean }) {
  const head = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-mono text-[13px] font-semibold text-ink">{title}</span>
      {meta && <span className="ml-auto flex-none font-mono text-[11px] text-muted">{meta}</span>}
    </span>
  );
  if (!children) return <div className={`px-3 py-2 ${first ? '' : 'border-t border-line-soft'}`}>{head}</div>;
  return (
    <details className={`group ${first ? '' : 'border-t border-line-soft'}`}>
      <summary className="cursor-pointer list-none px-3 py-2 marker:hidden">{head}</summary>
      <div className="flex flex-col gap-1.5 px-3 pb-3 text-xs">{children}</div>
    </details>
  );
}

const Rows = ({ label, rows }: { label: string; rows: { k: string; v: string }[] }) =>
  rows.length ? (
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold text-muted">{label}</span>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 font-mono">
          <span className="truncate">{r.k}</span>
          <span className="break-words text-muted [overflow-wrap:anywhere]">{r.v}</span>
        </div>
      ))}
    </div>
  ) : null;

function Outline({ o }: { o: IdlOutline }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Instructions" count={o.instructions.length}>
        {o.instructions.map((ix, i) => (
          <Item key={ix.name + i} first={i === 0} title={ix.name} meta={`${ix.args.length} args · ${ix.accounts.length} accounts`}>
            {ix.docs && <p className="m-0 text-muted">{ix.docs}</p>}
            {ix.discriminator && <Rows label="Discriminator" rows={[{ k: 'bytes', v: ix.discriminator }]} />}
            <Rows label="Arguments" rows={ix.args.map((a) => ({ k: a.name, v: a.type }))} />
            <Rows label="Accounts" rows={ix.accounts.map((a) => ({ k: a.name, v: a.flags.join(', ') || 'read-only' }))} />
          </Item>
        ))}
      </Section>
      <Section title="Accounts" count={o.accounts.length}>
        {o.accounts.map((a, i) => (
          <Item key={a.name + i} first={i === 0} title={a.name} meta={`${a.fields.length} fields`}>
            {a.docs && <p className="m-0 text-muted">{a.docs}</p>}
            <Rows label="Fields" rows={a.fields.map((f) => ({ k: f.name, v: f.type }))} />
          </Item>
        ))}
      </Section>
      <Section title="Types" count={o.types.length}>
        {o.types.map((t, i) => (
          <Item key={t.name + i} first={i === 0} title={t.name}>
            {t.docs && <p className="m-0 text-muted">{t.docs}</p>}
            <p className="m-0 font-mono break-words [overflow-wrap:anywhere]">{t.type}</p>
          </Item>
        ))}
      </Section>
      <Section title="PDAs" count={o.pdas.length}>
        {o.pdas.map((d, i) => (
          <Item key={d.name + i} first={i === 0} title={d.name} meta={`${d.seeds.length} seeds`}>
            <Rows label="Seeds" rows={d.seeds.map((s, j) => ({ k: String(j + 1), v: s }))} />
          </Item>
        ))}
      </Section>
      <Section title="Errors" count={o.errors.length}>
        {o.errors.map((e, i) => (
          <Item key={`${e.code}-${i}`} first={i === 0} title={e.name} meta={String(e.code)}>
            {e.message && <p className="m-0 text-muted">{e.message}</p>}
          </Item>
        ))}
      </Section>
    </div>
  );
}

/** Everything a program's IDL declares: instructions (args, accounts), account types, defined types, PDAs, errors. */
export function IdlViewScreen() {
  const nav = useNav();
  const route = nav.route as ViewRoute;
  const clients = useClients();
  const userIdls = useCall<UserIdl[]>('idls:list');
  const [state, setState] = useState<{ outline: IdlOutline; idl: ResolvedIdl } | { error: string } | null>(null);

  useEffect(() => {
    if (!clients || userIdls.loading) return;
    let live = true;
    loadIdl(route, userIdls.data ?? [], clients.chain).then(
      (idl) => live && setState(idl ? { idl, outline: outlineIdl(idl.root) } : { error: 'This source has no IDL for the program on the current network.' }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [clients, userIdls.loading, userIdls.data, route.programId, route.network, route.tier]);

  const title = state && 'outline' in state ? state.outline.name : 'Program IDL';
  return (
    <PopupScreen title={title} onBack={nav.back} scroll>
      <div className="flex flex-col gap-4 px-4 py-3">
        <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs">
          <dt className="text-muted">Program</dt>
          <dd className="m-0 font-mono break-all">{route.programId}</dd>
          <dt className="text-muted">Source</dt>
          <dd className="m-0">{SOURCE[route.tier]}</dd>
          <dt className="text-muted">Network</dt>
          <dd className="m-0">{route.network}</dd>
          {state && 'outline' in state && state.outline.version && (
            <>
              <dt className="text-muted">Version</dt>
              <dd className="m-0 font-mono">{state.outline.version}</dd>
            </>
          )}
          {state && 'idl' in state && (
            <>
              <dt className="text-muted">Hash</dt>
              <dd className="m-0 font-mono" title={state.idl.hash}>{shortAddress(state.idl.hash)}</dd>
            </>
          )}
        </dl>
        {!state ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : 'error' in state ? (
          <Alert severity="warn">{state.error}</Alert>
        ) : (
          <Outline o={state.outline} />
        )}
      </div>
    </PopupScreen>
  );
}
